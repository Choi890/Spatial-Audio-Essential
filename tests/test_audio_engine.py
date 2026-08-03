from __future__ import annotations

import tempfile
import sys
import threading
import time
import unittest
from pathlib import Path

import numpy as np
import soundfile as sf

from backend.audio_engine import (
    AudioChannelLayoutError,
    analyze_audio,
    enhance_demucs_stems,
    estimate_true_peak_8x,
    integrated_loudness_bs1770,
    load_audio,
    measure_master_output,
    read_stem_quality,
    run_cancellable_command,
    AnalysisCancelledError,
)


class AudioEngineRegressionTests(unittest.TestCase):
    def test_multichannel_input_is_rejected_explicitly(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "surround.wav"
            sf.write(path, np.zeros((480, 6), dtype=np.float32), 48000, subtype="FLOAT")
            with self.assertRaises(AudioChannelLayoutError):
                load_audio(path)

    def test_final_master_meter_reports_production_metrics(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "master.wav"
            timeline = np.arange(48000, dtype=np.float64) / 48000
            tone = (0.2 * np.sin(2 * np.pi * 1000 * timeline)).astype(np.float32)
            sf.write(path, np.column_stack([tone, tone]), 48000, subtype="FLOAT")
            result = measure_master_output(path)
        self.assertEqual(result["channels"], 2)
        self.assertEqual(result["truePeakOversampling"], 8)
        self.assertIn("integratedLufs", result)
        self.assertLess(result["estimatedTruePeakDb"], 0)

    def test_true_peak_detects_inter_sample_overshoot(self) -> None:
        sample_rate = 48000
        timeline = np.arange(4096, dtype=np.float64) / sample_rate
        signal = (0.8 * np.sin(2 * np.pi * 11025 * timeline)).astype(np.float32)
        self.assertGreater(estimate_true_peak_8x(signal), float(np.max(np.abs(signal))) + 0.02)

    def test_bs1770_silence_floor(self) -> None:
        self.assertEqual(integrated_loudness_bs1770(np.zeros(48000), 48000), -120.0)

    def test_subprocess_cancellation_stops_work_promptly(self) -> None:
        cancel_event = threading.Event()
        timer = threading.Timer(0.25, cancel_event.set)
        started = time.monotonic()
        timer.start()
        try:
            with self.assertRaises(AnalysisCancelledError):
                run_cancellable_command(
                    [sys.executable, "-c", "import time; time.sleep(30)"],
                    cancel_event=cancel_event,
                    timeout_seconds=10,
                )
        finally:
            timer.cancel()
        self.assertLess(time.monotonic() - started, 4.0)

    def test_eight_times_peak_estimator_is_bounded_and_channel_aware(self) -> None:
        stereo = np.array(
            [[0.0, 0.0], [0.8, -0.4], [-0.8, 0.95], [0.2, -0.2]],
            dtype=np.float32,
        )
        estimated = estimate_true_peak_8x(stereo)
        self.assertGreaterEqual(estimated, 0.95 - 1e-6)
        self.assertLessEqual(estimated, 1.2)

    def test_bs1770_integrated_loudness_is_gated_and_channel_aware(self) -> None:
        sample_rate = 48000
        time = np.arange(sample_rate * 2, dtype=np.float64) / sample_rate
        tone = (10 ** (-23 / 20) * np.sin(2 * np.pi * 1000 * time)).astype(np.float32)
        stereo = np.column_stack([tone, tone])
        measured = integrated_loudness_bs1770(stereo, sample_rate)
        self.assertGreater(measured, -24.5)
        self.assertLess(measured, -21.0)

        gated = np.vstack([np.zeros_like(stereo), stereo])
        gated_measured = integrated_loudness_bs1770(gated, sample_rate)
        self.assertAlmostEqual(gated_measured, measured, delta=0.7)

    def test_stereo_pan_and_demucs_model_are_stable(self) -> None:
        sample_rate = 22050
        duration = 1.25
        time = np.linspace(0.0, duration, int(sample_rate * duration), endpoint=False)
        tone = np.sin(2 * np.pi * 440 * time).astype(np.float32)
        stereo = np.stack([tone * 0.24, tone * 0.86], axis=1)

        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            audio_path = root / "right_weighted.wav"
            output_dir = root / "outputs"
            output_dir.mkdir()
            sf.write(audio_path, stereo, sample_rate)

            result = analyze_audio(
                audio_path,
                job_id="rightpan",
                output_dir=output_dir,
                request_demucs=False,
                demucs_model="htdemucs_6s",
                cache_key="fixture",
            )

        separator = result["models"]["deepSeparator"]
        image = result["stereoImage"]
        self.assertEqual(separator["model"], "htdemucs_ft")
        self.assertEqual(separator["qualityProfile"], "spatial-q2")
        self.assertEqual(separator["postprocess"], "softmask-v1")
        self.assertIn("shifts", separator["settings"])
        self.assertGreater(image["pan"], 0.2)
        self.assertGreater(image["width"], 0.05)
        self.assertGreaterEqual(image["correlation"], 0.95)
        self.assertGreater(result["mix"]["spectralBalance"]["lowMid"], 0.4)

    def test_demucs_stem_enhancement_writes_quality_metadata(self) -> None:
        sample_rate = 22050
        duration = 0.4
        time = np.linspace(0.0, duration, int(sample_rate * duration), endpoint=False)
        stems = {
            "vocals": np.sin(2 * np.pi * 440 * time) * 0.28,
            "other": np.sin(2 * np.pi * 880 * time) * 0.22,
            "drums": (np.sin(2 * np.pi * 120 * time) * (np.sin(2 * np.pi * 8 * time) > 0.92)) * 0.7,
            "bass": np.sin(2 * np.pi * 80 * time) * 0.34,
        }

        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            paths = []
            for stem_id, mono in stems.items():
                data = np.stack([mono, mono * 0.98], axis=1).astype(np.float32)
                path = root / f"{stem_id}.wav"
                sf.write(path, data, sample_rate, subtype="FLOAT")
                paths.append(path)

            quality = enhance_demucs_stems(paths, root)
            cached = read_stem_quality(root)

            self.assertEqual(set(quality), {"vocals", "other", "drums", "bass"})
            self.assertEqual(set(cached), set(quality))
            for stem_id, metrics in quality.items():
                self.assertGreater(metrics["separation"], 0.0, stem_id)
                self.assertGreater(metrics["spatialWeight"], 0.6, stem_id)
                data, _ = sf.read(root / f"{stem_id}.wav", always_2d=True, dtype="float32")
                self.assertTrue(np.all(np.isfinite(data)))


if __name__ == "__main__":
    unittest.main()
