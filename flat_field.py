"""Average preprocessed air frames, then compute -ln(sample / mean_air)."""
import argparse
import json
from pathlib import Path

import numpy as np
import tifffile


def flatDarkFieldCorrection(proj, air, epsilon=1e-10):
    numerator = np.maximum(proj + epsilon, epsilon)
    denominator = np.maximum(air + epsilon, epsilon)
    ratio = np.maximum(numerator / denominator, epsilon)
    return -np.log(ratio).astype(np.float32)


def correct(sample, mean_air, epsilon=1e-10):
    sample = np.asarray(sample)
    mean_air = np.asarray(mean_air)
    if sample.ndim != 3 or mean_air.ndim != 2 or sample.shape[1:] != mean_air.shape:
        raise ValueError('Expected sample (N,H,W) and mean_air (H,W)')
    if not np.isfinite(epsilon) or epsilon <= 0:
        raise ValueError('epsilon must be finite and positive')
    if not np.isfinite(sample).all() or not np.isfinite(mean_air).all():
        raise ValueError('Input contains NaN/Inf')
    result = flatDarkFieldCorrection(sample, mean_air, epsilon)
    if not np.isfinite(result).all():
        raise ValueError('Correction produced nonfinite values')
    return result


def save_verified(base, array, report):
    paths = [base.with_suffix(suffix) for suffix in ('.tif', '.raw', '.json')]
    if any(p.exists() for p in paths):
        raise FileExistsError(f'Output already exists: {base}')
    array = np.asarray(array, dtype='<f4', order='C')
    tifffile.imwrite(paths[0], array, photometric='minisblack', metadata={'axes': 'YX' if array.ndim == 2 else 'ZYX'})
    array.tofile(paths[1])
    np.testing.assert_array_equal(tifffile.imread(paths[0]), array)
    np.testing.assert_array_equal(np.fromfile(paths[1], '<f4').reshape(array.shape), array)
    report.update(shape=list(array.shape), dtype='float32', raw_byte_order='little',
                  raw_offset=0, raw_order='C; column fastest',
                  min=float(array.min()), max=float(array.max()),
                  validation='TIFF and RAW round-trip exactly equal; all values finite')
    paths[2].write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--air', type=Path, required=True)
    parser.add_argument('--samples', type=Path, nargs='+', required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--epsilon', type=float, default=1e-10)
    args = parser.parse_args()
    air = tifffile.imread(args.air)
    if air.ndim != 3 or not len(air) or not np.isfinite(air).all():
        raise ValueError('Air must be a finite (N,H,W) stack')
    # Float64 accumulation; use the saved float32 mean consistently for correction.
    mean_air = air.mean(axis=0, dtype=np.float64).astype('<f4')
    stems = [p.stem.removesuffix('_preprocessed') + '_flatfield_log' for p in args.samples]
    if len(set(stems)) != len(stems):
        raise ValueError('Sample output names collide')
    for stem in ['air_mean', *stems]:
        for suffix in ('.tif', '.raw', '.json'):
            if (args.output / (stem + suffix)).exists():
                raise FileExistsError('Choose a new output directory; existing results will not be overwritten')
    args.output.mkdir(parents=True, exist_ok=True)
    save_verified(args.output / 'air_mean', mean_air, {
        'source': str(args.air.resolve()), 'operation': 'arithmetic mean over frame axis',
        'frames_averaged': len(air), 'accumulator_dtype': 'float64',
    })
    for path, stem in zip(args.samples, stems):
        sample = tifffile.imread(path)
        result = correct(sample, mean_air, args.epsilon)
        report = {
            'source': str(path.resolve()), 'air_source': str(args.air.resolve()),
            'mean_air_file': str((args.output / 'air_mean.tif').resolve()),
            'formula': '-ln(max(max(I+epsilon,epsilon) / max(mean_air+epsilon,epsilon),epsilon))',
            'log_base': 'e', 'epsilon': args.epsilon,
            'zero_values_replaced': int(np.count_nonzero(sample == 0)),
            'ratio_values_clipped': int(np.count_nonzero(
                np.maximum(sample + args.epsilon, args.epsilon) /
                np.maximum(mean_air + args.epsilon, args.epsilon) < args.epsilon)),
            'negative_output_values_preserved': int(np.count_nonzero(result < 0)),
            'dark_subtraction': False,
        }
        save_verified(args.output / stem, result, report)
        print(f'{path.name}: {result.shape}, zeros replaced={report["zero_values_replaced"]}, verified')


if __name__ == '__main__':
    main()
