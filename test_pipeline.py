import json
from pathlib import Path
import tempfile
import threading
import unittest

import numpy as np
import tifffile

from pipeline import Cancelled, process


def fixture(path, data):
    n, h, w = data.shape
    gap = 16
    header = (f'PlainText_Header_Bytes 512\nImage_Type Single\nWidth {w}\nHeight {h}\n'
              f'Offset_To_First_Image 528\nNr_of_images {n}\n'
              f'Gap_between_iamges_in_bytes {gap}\nEndianness Little-endian byte order\n'
              f'Frame_Bytes {h*w*4+gap}\n').encode()
    with path.open('wb') as f:
        f.write(header.ljust(512, b'\x00'))
        for frame in data:
            f.write(b'X' * gap)
            f.write(frame.astype('<f4').tobytes())


class PipelineTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.obj = self.root / '物体.EVI'
        self.air = self.root / '空气.EVI'
        self.mask = self.root / 'mask.raw'
        obj = np.zeros((3, 8, 10), np.float32)
        obj[1,2:-2] = 2
        obj[2,2:-2] = 8
        obj[1:,3,4] = 999  # masked outlier, must be repaired before output
        air = np.zeros((4, 8, 10), np.float32)
        air[1,2:-2], air[2,2:-2], air[3,2:-2] = 8, 10, 12
        air[1:,3,4] = 999
        fixture(self.obj, obj)
        fixture(self.air, air)
        mask = np.zeros((4,10), '<f4')
        mask[1,4] = 1
        mask.tofile(self.mask)

    def run_mode(self, mode, **kw):
        return process(self.obj, self.air, self.mask, self.root/'out', mode, **kw)

    def test_volume_shape_air_average_and_repair(self):
        output, report = self.run_mode('volume')
        obj = tifffile.imread(output/'object_corrected.tif')
        self.assertEqual(obj.shape, (2,4,10))
        np.testing.assert_array_equal(obj[0], 2)
        np.testing.assert_array_equal(obj[1], 8)
        np.testing.assert_array_equal(tifffile.imread(output/'air_mean_corrected.tif'), 10)
        log = tifffile.imread(output/'postlog.tif')
        np.testing.assert_allclose(log[0], -np.log(.2), rtol=1e-6)
        np.testing.assert_allclose(log[1], -np.log(.8), rtol=1e-6)
        self.assertEqual(report['status'], 'complete')

    def test_mean_before_log_not_mean_of_log(self):
        output, _ = self.run_mode('mean')
        obj = tifffile.imread(output/'object_corrected.tif')
        self.assertEqual(obj.shape, (4,10))
        np.testing.assert_array_equal(obj, 5)
        log = tifffile.imread(output/'postlog.tif')
        np.testing.assert_allclose(log, np.log(2), rtol=1e-6)
        self.assertFalse(np.isclose(log[0,0], (-np.log(.2)-np.log(.8))/2))

    def test_repeat_keeps_prior_output(self):
        first, _ = self.run_mode('mean')
        second, _ = self.run_mode('mean')
        self.assertNotEqual(first, second)
        self.assertTrue((first/'postlog.tif').is_file())

    def test_raw_is_optional_in_both_modes(self):
        for mode in ('volume', 'mean'):
            with self.subTest(mode=mode):
                default, report = self.run_mode(mode)
                self.assertEqual(report['image_formats'], ['tif'])
                self.assertEqual(len(list(default.glob('*.tif'))), 3)
                self.assertEqual(list(default.glob('*.raw')), [])
                enabled, report = self.run_mode(mode, export_raw=True)
                self.assertEqual(report['image_formats'], ['tif', 'raw'])
                self.assertEqual(len(list(enabled.glob('*.raw'))), 3)
                for stem, info in report['outputs'].items():
                    tif = tifffile.imread(enabled / (stem + '.tif'))
                    raw = np.fromfile(enabled / (stem + '.raw'), '<f4').reshape(info['shape'])
                    np.testing.assert_array_equal(tif, raw)
                    np.testing.assert_array_equal(tif, tifffile.imread(default / (stem + '.tif')))

    def test_cancel_is_marked_incomplete(self):
        event = threading.Event()
        def progress(percent, message):
            if percent > 0:
                event.set()
        with self.assertRaises(Cancelled):
            self.run_mode('volume', progress=progress, cancel=event)
        folders = list((self.root/'out').iterdir())
        self.assertEqual(len(folders), 1)
        self.assertTrue(folders[0].name.endswith('.incomplete'))
        report = json.loads((folders[0]/'report.json').read_text(encoding='utf-8'))
        self.assertEqual(report['status'], 'cancelled')

    def test_mismatched_input_and_invalid_mask(self):
        fixture(self.air, np.ones((3,8,11)))
        with self.assertRaises(ValueError):
            self.run_mode('mean')
        fixture(self.air, np.ones((3,8,10)))
        np.full((4,10), 2, '<f4').tofile(self.mask)
        with self.assertRaises(ValueError):
            self.run_mode('mean')


if __name__ == '__main__':
    unittest.main()
