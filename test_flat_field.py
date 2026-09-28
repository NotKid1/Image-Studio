import unittest
import numpy as np
from flat_field import correct


class FlatFieldTests(unittest.TestCase):
    def test_known_transmission_and_negative_log(self):
        air = np.array([[10., 20., 30.]])
        sample = np.array([[[10., 10., 60.]], [[5., 20., 30.]]])
        expected = np.array([[[0., np.log(2), -np.log(2)]], [[np.log(2), 0., 0.]]])
        np.testing.assert_allclose(correct(sample, air), expected, atol=1e-7)

    def test_zero_and_tiny_ratio_are_capped(self):
        sample = np.array([[[0., 1e-12]]], dtype=np.float32)
        result = correct(sample, np.full((1, 2), 2700, dtype=np.float32))
        np.testing.assert_allclose(result, -np.log(1e-10), rtol=1e-7)
        self.assertEqual(sample[0, 0, 0], 0)

    def test_denominator_and_numerator_protection(self):
        sample = np.array([[[-1., 0., 1.]]], dtype=np.float32)
        air = np.array([[2700., 0., -1.]], dtype=np.float32)
        np.testing.assert_allclose(correct(sample, air),
                                   [[[np.log(1e10), 0., -np.log(1e10)]]], rtol=1e-7)

    def test_invalid_air_and_sample(self):
        for sample, air in [(np.ones((1,1,1)), np.full((1,1), np.inf)),
                            (np.ones((1,1,1)), np.ones((2,1))),
                            (np.full((1,1,1), np.nan), np.ones((1,1)))]:
            with self.assertRaises(ValueError):
                correct(sample, air)


if __name__ == '__main__':
    unittest.main()
