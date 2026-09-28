import tempfile
import unittest
from pathlib import Path

import numpy as np

from preprocess import BadPixelPlan, load_mask, process_file, read_evi


class PreprocessTests(unittest.TestCase):
    def test_four_neighbors_and_unchanged_good_pixels(self):
        frame = np.arange(81, dtype=np.float32).reshape(9, 9) ** 2
        mask = np.zeros((9, 9), bool)
        mask[4, 4] = True
        frame[4, 4] = np.nan
        out = BadPixelPlan(mask).apply(frame)
        expected = np.mean(frame[[3, 4, 4, 5], [4, 3, 5, 4]])
        self.assertEqual(out[4, 4], expected)
        np.testing.assert_array_equal(out[~mask], frame[~mask])

    def test_cluster_and_boundary_use_only_good_donors(self):
        mask = np.zeros((10, 12), bool)
        mask[:3, :3] = True
        plan = BadPixelPlan(mask)
        self.assertFalse(mask.ravel()[plan.neighbors].any())
        frame = np.full(mask.shape, 13, dtype=np.float32)
        frame[mask] = -9999
        np.testing.assert_allclose(plan.apply(frame), 13)
        # Independently verify the selected distance multiset by exhaustive sorting.
        good = np.argwhere(~mask)
        for i, bad in enumerate(np.argwhere(mask)):
            expected = np.sort(np.sum((good - bad) ** 2, axis=1))[:4]
            coords = np.column_stack(np.unravel_index(plan.neighbors[i], mask.shape))
            np.testing.assert_array_equal(np.sum((coords-bad)**2, axis=1), expected)

    def test_invalid_and_empty_mask(self):
        with self.assertRaises(ValueError):
            BadPixelPlan(np.ones((3, 3), bool))
        a = np.zeros((3, 3), np.float32)
        np.testing.assert_array_equal(BadPixelPlan(a).apply(a), a)
        a[0, 0] = np.nan
        with self.assertRaises(ValueError):
            BadPixelPlan(np.zeros((3, 3), bool)).apply(a)

    def test_evi_gap_crop_and_output_roundtrip(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            path = root / 'sample.EVI'
            a = np.arange(3*8*10, dtype='<f4').reshape(3, 8, 10)
            header = ('PlainText_Header_Bytes 512\nImage_Type Single\nWidth 10\nHeight 8\n'
                      'Offset_To_First_Image 528\nNr_of_images 3\n'
                      'Gap_between_iamges_in_bytes 16\nEndianness Little-endian byte order\n'
                      'Frame_Bytes 336\n').encode()
            with path.open('wb') as f:
                f.write(header.ljust(512, b'\x00'))
                for frame in a:
                    f.write(b'X'*16)
                    f.write(frame.tobytes())
            read, _ = read_evi(path)
            np.testing.assert_array_equal(read, a)
            del read
            mask_path = root / 'mask.raw'
            mask = np.zeros((8, 10), '<f4')
            mask[3, 4] = 1
            mask.tofile(mask_path)
            self.assertEqual(load_mask(mask_path, 8, 10).shape, (4, 10))
            result = process_file(path, mask_path, root / 'out')
            self.assertEqual(result['output_shape_NHW'], [2, 4, 10])
            actual = np.fromfile(root/'out/sample_preprocessed.raw', '<f4').reshape(2,4,10)
            np.testing.assert_array_equal(actual, a[1:,2:-2])
            with self.assertRaises(FileExistsError):
                process_file(path, mask_path, root / 'out')
            with path.open('ab') as f:
                f.write(b'junk')
            with self.assertRaises(ValueError):
                read_evi(path)


if __name__ == '__main__':
    unittest.main()
