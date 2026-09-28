"""EVI detector preprocessing. Array order: frame, row, column."""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
from scipy.spatial import cKDTree
import tifffile


def read_evi(path: Path):
    """Read the self-described Single EVI layout, including per-frame gaps."""
    with path.open('rb') as f:
        first = f.readline(256).decode('ascii').split()
        if len(first) != 2 or first[0] != 'PlainText_Header_Bytes':
            raise ValueError(f'{path}: unsupported EVI header')
        size = int(first[1])
        if not 256 <= size <= 1048576:
            raise ValueError('Invalid EVI header size')
        f.seek(0)
        text = f.read(size).decode('ascii').rstrip('\x00 \r\n')
    fields = dict(line.split(None, 1) for line in text.splitlines()
                  if len(line.split(None, 1)) == 2)
    if fields['Image_Type'] != 'Single':
        raise ValueError('Only Image_Type Single (float32) is supported')
    byte_order = fields['Endianness']
    if byte_order.startswith('Little-endian'):
        dtype = np.dtype('<f4')
    elif byte_order.startswith('Big-endian'):
        dtype = np.dtype('>f4')
    else:
        raise ValueError(f'Unknown byte order: {byte_order}')
    n, h, w = (int(fields[k]) for k in ('Nr_of_images', 'Height', 'Width'))
    offset = int(fields['Offset_To_First_Image'])
    gap = int(fields['Gap_between_iamges_in_bytes'])
    payload = h * w * dtype.itemsize
    stride = payload + gap
    if min(n, h, w) <= 0 or gap < 0 or offset < size:
        raise ValueError('Invalid dimensions, offset, or frame gap')
    if int(fields.get('Frame_Bytes', stride)) != stride:
        raise ValueError('Inconsistent Frame_Bytes and pixel/frame-gap sizes')
    expected = offset + (n - 1) * stride + payload
    if path.stat().st_size != expected:
        raise ValueError(f'EVI size mismatch: expected {expected}, got {path.stat().st_size}')
    backing = np.memmap(path, dtype='u1', mode='r')
    array = np.ndarray((n, h, w), dtype=dtype, buffer=backing,
                       offset=offset, strides=(stride, w * dtype.itemsize, dtype.itemsize))
    return array, fields


def load_mask(path: Path, height: int, width: int):
    """RAW little-endian float32; accept original or already cropped mask."""
    if path.stat().st_size not in (height * width * 4, (height - 4) * width * 4):
        raise ValueError('Mask must be float32 with shape (H,W) or (H-4,W)')
    mask = np.fromfile(path, dtype='<f4').reshape(-1, width)
    if not np.all((mask == 0) | (mask == 1)):
        raise ValueError('Mask must contain only 0 (good) and 1 (bad)')
    if mask.shape[0] == height:
        mask = mask[2:-2]
    return mask.astype(bool)


class BadPixelPlan:
    """Cache the reference algorithm's four nearest good pixels and 1/d² weights.

    Equal-distance ties follow SciPy KD-tree order, which may differ from
    np.argsort in the original loop. Repaired pixels are never used as donors.
    """

    def __init__(self, mask):
        mask = np.asarray(mask, dtype=bool)
        if mask.ndim != 2:
            raise ValueError('Mask must be 2D')
        self.mask = mask
        self.bad = np.flatnonzero(mask)
        self.neighbors = np.empty((0, 4), dtype=np.int64)
        self.weights = np.empty((0, 4))
        if not self.bad.size:
            return
        good = np.argwhere(~mask)
        if len(good) < 4:
            raise ValueError('At least four good pixels are needed')
        distances, indices = cKDTree(good).query(np.argwhere(mask), k=4)
        coords = good[indices]
        self.neighbors = np.ravel_multi_index((coords[..., 0], coords[..., 1]), mask.shape)
        weights = 1.0 / (distances ** 2 + 1e-10)
        self.weights = weights / weights.sum(axis=1, keepdims=True)

    def apply(self, frame):
        if frame.shape != self.mask.shape:
            raise ValueError('Frame/mask shape mismatch')
        if not np.all(np.isfinite(frame[~self.mask])):
            raise ValueError('Unmasked NaN/Inf found; review the mask before processing')
        out = np.array(frame, dtype='<f4', order='C', copy=True)
        flat = out.reshape(-1)
        if self.bad.size:
            flat[self.bad] = (flat[self.neighbors] * self.weights).sum(axis=1)
        return out


def process_file(source: Path, mask_path: Path, output: Path):
    data, header = read_evi(source)
    n, h, w = data.shape
    if n < 2 or h <= 4:
        raise ValueError('Need at least two frames and more than four rows')
    mask = load_mask(mask_path, h, w)
    plan = BadPixelPlan(mask)
    stem = source.stem + '_preprocessed'
    paths = {ext: output / (stem + '.' + ext) for ext in ('raw', 'tif', 'json')}
    if any(p.exists() for p in paths.values()):
        raise FileExistsError(f'Output already exists for {source.name}; choose another output folder')
    output.mkdir(parents=True, exist_ok=True)
    out_shape = (n - 1, h - 4, w)
    persistent_zero = np.ones(mask.shape, dtype=bool)
    unmasked_zeros = 0
    corrected_min, corrected_max = float('inf'), float('-inf')
    try:
        with paths['raw'].open('xb') as raw, tifffile.TiffWriter(
            paths['tif'], bigtiff=np.prod(out_shape) * 4 > 4_000_000_000
        ) as tif:
            for frame in data[1:]:
                cropped = frame[2:-2]
                persistent_zero &= cropped == 0
                unmasked_zeros += int(np.count_nonzero(cropped[~mask] == 0))
                corrected = plan.apply(cropped)
                if not np.array_equal(corrected[~mask], cropped[~mask]):
                    raise AssertionError('Unmasked values changed')
                if not np.isfinite(corrected).all():
                    raise ValueError('Nonfinite output')
                corrected_min = min(corrected_min, float(corrected.min()))
                corrected_max = max(corrected_max, float(corrected.max()))
                corrected.tofile(raw)
                tif.write(corrected, photometric='minisblack', contiguous=True, metadata=None)
        # Reopen both outputs and compare every value after serialization.
        raw_check = np.memmap(paths['raw'], mode='r', dtype='<f4', shape=out_shape)
        tif_check = tifffile.memmap(paths['tif'])
        if tif_check.shape != out_shape or not np.array_equal(raw_check, tif_check):
            raise AssertionError('TIFF/RAW round-trip verification failed')
        del raw_check, tif_check
        report = {
            'source': str(source.resolve()), 'mask': str(mask_path.resolve()),
            'input_shape_NHW': list(data.shape), 'output_shape_NHW': list(out_shape),
            'dtype': 'float32', 'raw_byte_order': 'little', 'raw_offset': 0,
            'raw_order': 'C; column fastest, then row, then frame',
            'operations': ['drop frame 0', 'crop rows [2:H-2]', 'masked 4-neighbor inverse-square interpolation'],
            'mask_bad_value': 1, 'bad_pixels_per_frame': int(mask.sum()),
            'total_interpolated_values': int(mask.sum()) * (n - 1),
            'first_frame_min_max': [float(data[0].min()), float(data[0].max())],
            'first_frame_nonzero': int(np.count_nonzero(data[0])),
            'removed_border_nonzero': int(np.count_nonzero(data[:, [0, 1, h-2, h-1], :])),
            'persistent_zero_unmasked': int(np.count_nonzero(persistent_zero & ~mask)),
            'unmasked_zero_values_preserved': unmasked_zeros,
            'output_min_max': [corrected_min, corrected_max],
            'validation': 'All unmasked pixels unchanged; all output finite; TIFF and RAW exactly equal',
            'tie_policy': 'SciPy cKDTree k=4; equidistant ties may differ from original np.argsort',
            'evi_header': header,
        }
        paths['json'].write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    except Exception:
        # Remove only these newly created incomplete outputs.
        for p in paths.values():
            p.unlink(missing_ok=True)
        raise
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', type=Path, required=True, help='EVI file or directory')
    parser.add_argument('--mask', type=Path, required=True, help='float32 RAW mask, 1=bad')
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    files = (sorted(p for p in args.input.iterdir() if p.suffix.lower() == '.evi')
             if args.input.is_dir() else [args.input])
    if not files:
        parser.error('No EVI files found')
    for path in files:
        report = process_file(path, args.mask, args.output)
        print(f'{path.name}: {report["input_shape_NHW"]} -> {report["output_shape_NHW"]}; '
              f'{report["bad_pixels_per_frame"]} bad pixels/frame; verified', flush=True)


if __name__ == '__main__':
    main()
