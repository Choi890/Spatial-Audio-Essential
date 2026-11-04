import importlib.util
import random
import unittest
from types import SimpleNamespace


@unittest.skipUnless(importlib.util.find_spec("demucs") and importlib.util.find_spec("torch"),
                     "Optional Demucs dependencies are not installed")
class BatchedSeparationTests(unittest.TestCase):
    def test_batching_keeps_shift_rng_overlap_and_short_final_chunk(self):
        import torch
        from demucs.apply import apply_model
        from backend.demucs_worker import apply_batched

        class TestModel(torch.nn.Module):
            sources = ["one", "two"]
            samplerate = 100
            audio_channels = 2
            segment = 1

            def __init__(self, simulate_oom=False):
                super().__init__()
                self.crosstransformer = SimpleNamespace(emb="sin", sin_random_shift=0)
                self.simulate_oom = simulate_oom

            def forward(self, value):
                random.randrange(1)
                if self.simulate_oom and value.shape[0] > 1:
                    raise torch.cuda.OutOfMemoryError("test VRAM pressure")
                return torch.stack([value * 0.7, value * 0.3], dim=1)

        mix = torch.randn(1, 2, 437, generator=torch.Generator().manual_seed(7))
        random.seed(13)
        expected = apply_model(TestModel(), mix, shifts=2, overlap=0.36, segment=1, device="cpu")
        expected_rng = random.getstate()
        for batch, oom in [(1, False), (4, False), (4, True)]:
            random.seed(13)
            actual = apply_batched(TestModel(oom), mix, shifts=2, overlap=0.36,
                                   segment=1, batch_size=batch, device="cpu")
            torch.testing.assert_close(actual, expected, atol=2e-7, rtol=1e-6)
            self.assertEqual(random.getstate(), expected_rng)


if __name__ == "__main__":
    unittest.main()
