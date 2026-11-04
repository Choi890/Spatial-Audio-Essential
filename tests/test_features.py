import unittest

import numpy as np

from backend.features import AnalysisFrames, estimate_tempo, normalize_curve


class FeatureWorkspaceTests(unittest.TestCase):
    def test_tempo_matches_full_autocorrelation(self):
        rng = np.random.default_rng(17)
        for length in (0, 7, 25, 900, 10000):
            onset = rng.random(length, dtype=np.float32)
            normalized = normalize_curve(onset)
            if length < 8 or np.max(normalized) <= 0:
                expected = 0.0
            else:
                centered = normalized - np.mean(normalized)
                corr = np.correlate(centered, centered, mode="full")[length - 1:]
                min_lag = max(1, int(round(60 * 22050 / (190 * 512))))
                max_lag = min(length - 1, int(round(60 * 22050 / (50 * 512))))
                lag = int(np.argmax(corr[min_lag:max_lag + 1]) + min_lag) if max_lag > min_lag else 0
                expected = round(float(60 * 22050 / (lag * 512)), 1) if lag else 0.0
            self.assertEqual(estimate_tempo(onset, 22050, 512), expected)

    def test_direct_band_contraction_matches_weighted_spectrogram(self):
        rng = np.random.default_rng(23)
        for order in ("C", "F"):
            power = np.array(rng.random((2049, 250), dtype=np.float32), order=order)
            weights = rng.random(2049, dtype=np.float32)
            expected = np.sum(power * weights[:, None], axis=0)
            actual = np.einsum("ij,i->j", power, weights, optimize=False)
            np.testing.assert_allclose(actual, expected, rtol=2e-6, atol=1e-6)

    def test_blocked_features_equal_independent_scalar_frames(self):
        rng = np.random.default_rng(641)
        for size, n_fft, hop in [(0, 15, 4), (3, 16, 5), (9000, 32, 7), (5000, 31, 9)]:
            with self.subTest(size=size, n_fft=n_fft):
                samples = rng.normal(size=size).astype(np.float32)
                workspace = AnalysisFrames(samples, n_fft, hop)
                padded = np.pad(samples, (n_fft // 2, n_fft // 2))
                if len(padded) < n_fft:
                    padded = np.pad(padded, (0, n_fft - len(padded)))
                frames = [padded[i:i + n_fft] for i in range(0, len(padded) - n_fft + 1, hop)]
                spectra = np.stack([np.abs(np.fft.rfft(frame * np.hanning(n_fft).astype(np.float32)))
                                    for frame in frames], axis=1).astype(np.float32)
                rms = np.array([np.sqrt(np.mean(frame * frame) + 1e-12) for frame in frames], dtype=np.float32)
                zcr = np.array([np.mean(np.signbit(frame[1:]) != np.signbit(frame[:-1]))
                                for frame in frames], dtype=np.float32)
                np.testing.assert_array_equal(workspace.magnitude(), spectra)
                np.testing.assert_array_equal(workspace.rms(), rms)
                np.testing.assert_array_equal(workspace.zero_crossings(), zcr)
                self.assertTrue(np.shares_memory(workspace.frames, workspace.padded))
                self.assertFalse(workspace.frames.flags.writeable)

    def test_single_sample_windows_have_no_zero_crossings(self):
        workspace = AnalysisFrames(np.array([-1, 1], dtype=np.float32), 1, 1)
        np.testing.assert_array_equal(workspace.zero_crossings(), [0, 0])


if __name__ == "__main__":
    unittest.main()
