"""Streaming desktop processing backend; original data is always read-only."""
from contextlib import ExitStack
from datetime import datetime
import hashlib
import json
from pathlib import Path
from uuid import uuid4

import numpy as np
import tifffile

from preprocess import BadPixelPlan, load_mask, read_evi
from flat_field import flatDarkFieldCorrection


class Cancelled(Exception):
    pass


def process(object_path, air_path, mask_path, output_root, mode='volume',
            progress=lambda percent, message: None, cancel=None, export_raw=False):
    """mode=volume retains frames; mode=mean averages repaired object frames.

    Both inputs always discard frame 0 and rows 0,1,H-2,H-1 before repair.
    Air is always averaged after per-frame repair using float64 accumulation.
    Each result is float32 TIFF, optionally also little-endian headerless RAW. The job folder
    is marked incomplete until all files have been verified and committed.
    """
    def check_cancel():
        if cancel is not None and cancel.is_set():
            raise Cancelled('已取消；未完成文件保存在 incomplete 目录中。')

    if mode not in ('volume', 'mean'):
        raise ValueError('未知处理模式')
    object_path, air_path, mask_path = map(Path, (object_path, air_path, mask_path))
    if object_path.resolve() == air_path.resolve():
        raise ValueError('物体与空气不能选择同一个文件。')
    check_cancel()
    progress(0, '检查 EVI 文件头、尺寸和 mask…')
    obj, obj_header = read_evi(object_path)
    air, air_header = read_evi(air_path)
    if obj.shape[1:] != air.shape[1:]:
        raise ValueError('物体与空气的探测器尺寸不一致。')
    if min(obj.shape[0], air.shape[0]) < 2 or obj.shape[1] <= 4:
        raise ValueError('输入至少需要两帧，且每帧高度必须大于四行。')
    mask = load_mask(mask_path, *obj.shape[1:])
    plan = BadPixelPlan(mask)
    check_cancel()
    root = Path(output_root)
    root.mkdir(parents=True, exist_ok=True)
    name = f'{object_path.stem}_{mode}_{datetime.now():%Y%m%d_%H%M%S}_{uuid4().hex[:6]}'
    staging = root / (name + '.incomplete')
    final = root / name
    staging.mkdir()
    epsilon = 1e-10
    n_obj, n_air = obj.shape[0] - 1, air.shape[0] - 1
    total = n_obj + n_air
    report = {
        'status': 'incomplete', 'mode': mode,
        'image_formats': ['tif', 'raw'] if export_raw else ['tif'],
        'sources': {'object': str(object_path.resolve()), 'air': str(air_path.resolve()),
                    'mask': str(mask_path.resolve())},
        'mask_sha256': hashlib.sha256(mask_path.read_bytes()).hexdigest(),
        'mask_bad_value': 1, 'bad_pixels_per_frame': int(mask.sum()),
        'input_shapes_NHW': {'object': list(obj.shape), 'air': list(air.shape)},
        'frames_after_drop': {'object': n_obj, 'air': n_air},
        'operations': ['drop frame 0 from each input', 'crop top/bottom two rows',
                       'repair each frame using 4 nearest good pixels and inverse-square weights',
                       'average repaired air frames',
                       'keep object frames' if mode == 'volume' else 'average repaired object frames',
                       'postlog against averaged air'],
        'formula': '-ln(max(max(object+eps,eps)/max(air_mean+eps,eps),eps))',
        'epsilon': epsilon, 'log_base': 'e', 'dark_subtraction': False,
        'output_dtype': 'float32', 'raw_byte_order': 'little', 'raw_offset': 0,
        'raw_order': 'C: column fastest, then row, then frame',
        'average_accumulator': 'float64',
        'interpolation_ties': 'SciPy cKDTree order; equidistant ties may differ from original argsort',
        'evi_headers': {'object': obj_header, 'air': air_header},
        'outputs': {}, 'warnings': [],
    }

    expected_hashes = {}

    def write_report():
        (staging / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')

    def stat_start():
        return {'min': float('inf'), 'max': float('-inf'), 'zero_count': 0, 'negative_count': 0}

    def update_stats(stats, frame):
        if not np.isfinite(frame).all():
            raise ValueError('结果中出现 NaN 或 Inf。')
        stats['min'] = min(stats['min'], float(frame.min()))
        stats['max'] = max(stats['max'], float(frame.max()))
        stats['zero_count'] += int(np.count_nonzero(frame == 0))
        stats['negative_count'] += int(np.count_nonzero(frame < 0))

    def write_single(stem, frame):
        frame = np.asarray(frame, dtype='<f4')
        tifffile.imwrite(staging / (stem + '.tif'), frame, photometric='minisblack', metadata={'axes': 'YX'})
        if export_raw:
            frame.tofile(staging / (stem + '.raw'))
        expected_hashes[stem] = hashlib.sha256(frame.tobytes()).hexdigest()
        stats = stat_start()
        update_stats(stats, frame)
        report['outputs'][stem] = {'shape': list(frame.shape), **stats}

    try:
        write_report()
        accumulator = np.zeros(mask.shape, dtype=np.float64)
        for i, frame in enumerate(air[1:]):
            check_cancel()
            accumulator += plan.apply(frame[2:-2])
            progress(80 * (i + 1) / total, f'空气：修复并累加 {i+1}/{n_air} 帧')
        mean_air = (accumulator / n_air).astype('<f4')
        write_single('air_mean_corrected', mean_air)
        if np.any(mean_air <= 0):
            report['warnings'].append('平均空气包含非正值；按 epsilon 保护计算，请检查空气采集。')
        if mode == 'mean':
            accumulator.fill(0)
            for i, frame in enumerate(obj[1:]):
                check_cancel()
                accumulator += plan.apply(frame[2:-2])
                progress(80 * (n_air + i + 1) / total, f'物体：修复并累加 {i+1}/{n_obj} 帧')
            mean_obj = (accumulator / n_obj).astype('<f4')
            write_single('object_corrected', mean_obj)
            write_single('postlog', flatDarkFieldCorrection(mean_obj, mean_air))
        else:
            out_shape = (n_obj, *mask.shape)
            bigtiff = np.prod(out_shape) * 4 > 4_000_000_000
            object_stats, log_stats = stat_start(), stat_start()
            with ExitStack() as stack:
                writers = [stack.enter_context(tifffile.TiffWriter(staging / (stem + '.tif'), bigtiff=bigtiff))
                           for stem in ('object_corrected', 'postlog')]
                raws = [stack.enter_context((staging / (stem + '.raw')).open('xb'))
                        for stem in ('object_corrected', 'postlog')] if export_raw else [None, None]
                digests = [hashlib.sha256(), hashlib.sha256()]
                for i, frame in enumerate(obj[1:]):
                    check_cancel()
                    corrected = plan.apply(frame[2:-2])
                    postlog = flatDarkFieldCorrection(corrected, mean_air)
                    for data, writer, raw, stats, digest in zip((corrected, postlog), writers, raws, (object_stats, log_stats), digests):
                        update_stats(stats, data)
                        if raw is not None:
                            data.tofile(raw)
                        digest.update(data.tobytes())
                        writer.write(data, photometric='minisblack', contiguous=True, metadata=None)
                    progress(80 * (n_air + i + 1) / total, f'物体：修复并计算 postlog {i+1}/{n_obj} 帧')
            for stem, stats, digest in zip(('object_corrected', 'postlog'), (object_stats, log_stats), digests):
                expected_hashes[stem] = digest.hexdigest()
                report['outputs'][stem] = {'shape': list(out_shape), **stats}
        # Verify disk files in bounded memory, including per-pixel formula checks.
        progress(82, '回读输出文件并验证 postlog 公式…')
        for stem, stats in report['outputs'].items():
            check_cancel()
            shape = tuple(stats['shape'])
            with ExitStack() as handles:
                disk = tifffile.memmap(staging / (stem + '.tif'))
                handles.callback(disk._mmap.close)
                if disk.size != np.prod(shape):
                    raise ValueError('TIFF 数据大小不符合预期。')
                disk = disk.reshape(shape)
                raw = None
                if export_raw:
                    raw_path = staging / (stem + '.raw')
                    if raw_path.stat().st_size != np.prod(shape) * 4:
                        raise ValueError('RAW 文件大小不符合预期。')
                    raw = np.memmap(raw_path, dtype='<f4', mode='r', shape=shape)
                    handles.callback(raw._mmap.close)
                    raw = raw.reshape(-1, *mask.shape)
                digest = hashlib.sha256()
                for i, frame in enumerate(disk.reshape(-1, *mask.shape)):
                    check_cancel()
                    if not np.isfinite(frame).all():
                        raise ValueError('TIFF 回读包含非有限值。')
                    if raw is not None and not np.array_equal(frame, raw[i]):
                        raise ValueError('TIFF / RAW 回读验证失败。')
                    digest.update(frame.astype('<f4', copy=False).tobytes())
                if digest.hexdigest() != expected_hashes[stem]:
                    raise ValueError('TIFF 回读与原始计算结果不一致。')
        shape = tuple(report['outputs']['object_corrected']['shape'])
        with ExitStack() as handles:
            disk_obj = tifffile.memmap(staging / 'object_corrected.tif')
            handles.callback(disk_obj._mmap.close)
            disk_log = tifffile.memmap(staging / 'postlog.tif')
            handles.callback(disk_log._mmap.close)
            for i, (frame, actual) in enumerate(zip(disk_obj.reshape(-1, *mask.shape), disk_log.reshape(-1, *mask.shape))):
                check_cancel()
                if not np.array_equal(flatDarkFieldCorrection(frame, mean_air), actual):
                    raise ValueError('postlog 公式验证失败。')
                progress(85 + 14 * (i+1) / (shape[0] if len(shape) == 3 else 1), '验证输出公式…')
        report['status'] = 'complete'
        report['validation'] = ('TIFF hashes match computed data; all values finite; every postlog pixel matches specified formula'
                                + ('; RAW equals TIFF' if export_raw else ''))
        write_report()
        check_cancel()
        staging.rename(final)
        progress(100, '处理完成，输出及公式均已验证。')
        return final, report
    except Exception as exc:
        report['status'] = 'cancelled' if isinstance(exc, Cancelled) else 'failed'
        report['error'] = str(exc)
        write_report()
        raise
