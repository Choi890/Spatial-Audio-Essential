from __future__ import annotations

import tempfile
import sys
import threading
import time
import unittest
from pathlib import Path
from unittest.mock import patch

import numpy as np
import soundfile as sf

from backend.audio_engine import (
    AudioChannelLayoutError,
    DEMUCS_SHIFTS,
    analyze_audio,
    analyze_audio_optimized,
    build_adaptive_hybrid_stems,
    build_demucs_cache_id,
    cached_demucs_stems_match_source,
    enhance_demucs_stems,
    estimate_true_peak_8x,
    integrated_loudness_bs1770,
    load_audio,
    measure_master_output,
    read_stem_quality,
    resample_linear,
    run_cancellable_command,
    run_demucs_model,
    AnalysisCancelledError,
)


class AudioEngineRegressionTests(unittest.TestCase):
    def test_cuda_analysis_overlaps_features_and_demucs_without_changing_results(self) -> None:
        feature_result = {
            "models": {"deepSeparator": {"status": "ready"}},
            "activeIds": [],
            "mix": {},
            "recommendations": [],
        }
        separator = {"status": "completed", "stems": ["vocals.wav"]}
        with (
            patch("backend.audio_engine.detect_demucs_device", return_value="cuda"),
            patch("backend.audio_engine.analyze_audio", return_value=feature_result),
            patch("backend.audio_engine.inspect_demucs", return_value=separator),
            patch("backend.audio_engine.build_clean_recommendations", return_value=[]),
        ):
            result = analyze_audio_optimized(
                Path("song.flac"),
                job_id="parallel",
                output_dir=Path("outputs"),
                request_demucs=True,
                cache_key="analysis",
                demucs_cache_key="content",
            )
        self.assertIs(result["models"]["deepSeparator"], separator)
        self.assertEqual(result["analysisExecution"], "parallel-cpu-features-cuda-demucs")

    def test_demucs_uses_single_shift_and_pcm24_intermediates(self) -> None:
        with patch("backend.audio_engine.run_cancellable_command") as runner:
            run_demucs_model(
                Path("song.flac"),
                Path("outputs"),
                "htdemucs_ft",
                "cuda",
                cancel_event=None,
            )
        command = runner.call_args.args[0]
        self.assertEqual(command[command.index("--shifts") + 1], str(DEMUCS_SHIFTS))
        self.assertIn("--int24", command)
        self.assertNotIn("--float32", command)

    def test_demucs_cache_id_keeps_each_song_isolated(self) -> None:
        first = build_demucs_cache_id("a" * 64, "htdemucs_ft")
        second = build_demucs_cache_id("a" * 63 + "b", "htdemucs_ft")
        self.assertNotEqual(first, second)
        self.assertEqual(first, build_demucs_cache_id("a" * 64, "htdemucs_ft"))
        self.assertNotEqual(first, build_demucs_cache_id("a" * 64, "htdemucs_6s"))
        with patch("backend.audio_engine.DEMUCS_OVERLAP", 0.3601):
            self.assertNotEqual(first, build_demucs_cache_id("a" * 64, "htdemucs_ft"))
        self.assertNotEqual(build_demucs_cache_id("song-x", "model"),
                            build_demucs_cache_id("song-y", "model"))
        self.assertEqual(build_demucs_cache_id(None, "model"), "")

    def test_analysis_resampling_rejects_alias_and_preserves_passband(self) -> None:
        timeline = np.arange(48_000) / 48_000
        for frequency, minimum, maximum in [(1000, 0.99, 1.01), (16000, 0, 0.001)]:
            source = np.sin(2 * np.pi * frequency * timeline).astype(np.float32)
            result = resample_linear(source, 48_000, 22_050)
            amplitude = np.sqrt(2 * np.mean(result[500:-500] ** 2))
            self.assertEqual(len(result), 22_050)
            self.assertEqual(result.dtype, np.float32)
            self.assertGreaterEqual(amplitude, minimum)
            self.assertLess(amplitude, maximum)

    def test_analysis_resampling_handles_empty_short_and_stereo_inputs(self) -> None:
        for count in (0, 1, 17, 480):
            source = np.ones((count, 2), dtype=np.float32)
            result = resample_linear(source, 48_000, 22_050)
            self.assertEqual(result.shape, (int(np.ceil(count * 22050 / 48000)), 2))
            self.assertTrue(np.all(np.isfinite(result)))
        source = np.arange(10, dtype=np.float32)
        np.testing.assert_array_equal(resample_linear(source, 48000, 48000), source)

    def test_cached_demucs_stems_must_match_source_duration(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            source = root / "source.wav"
            stem = root / "vocals.wav"
            sf.write(source, np.zeros((48_000, 2), dtype=np.float32), 48_000)
            sf.write(stem, np.zeros((24_000, 2), dtype=np.float32), 48_000)
            self.assertFalse(cached_demucs_stems_match_source([stem], source))

            # Demucs는 원본과 다른 모델 샘플레이트로 출력할 수 있지만 시간축은 같아야 한다.
            sf.write(stem, np.zeros((44_100, 2), dtype=np.float32), 44_100)
            self.assertTrue(cached_demucs_stems_match_source([stem], source))

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
        self.assertEqual(separator["qualityProfile"], "spatial-q3-adaptive6")
        self.assertEqual(separator["postprocess"], "softmask-v2-hybrid")
        self.assertEqual(separator["auxiliaryModel"], "htdemucs_6s")
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
                self.assertEqual(sf.info(root / f"{stem_id}.wav").subtype, "PCM_24")

    def test_adaptive_hybrid_promotes_clean_candidates_and_preserves_the_sum(self) -> None:
        sample_rate = 24000
        timeline = np.arange(sample_rate, dtype=np.float64) / sample_rate
        components = {
            "vocals": np.sin(2 * np.pi * 330 * timeline) * 0.12,
            "drums": np.sin(2 * np.pi * 120 * timeline) * 0.08,
            "bass": np.sin(2 * np.pi * 70 * timeline) * 0.1,
            "guitar": np.sin(2 * np.pi * 710 * timeline) * 0.09,
            "piano": np.sin(2 * np.pi * 1040 * timeline) * 0.065,
            "bed": np.sin(2 * np.pi * 1510 * timeline) * 0.07,
        }
        core = {
            "vocals": components["vocals"],
            "drums": components["drums"],
            "bass": components["bass"],
            "other": components["guitar"] + components["piano"] + components["bed"],
        }

        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            primary_root = root / "primary"
            auxiliary_root = root / "auxiliary"
            final_root = root / "final"
            primary_root.mkdir()
            auxiliary_root.mkdir()
            primary_paths = []
            for stem_id, mono in core.items():
                path = primary_root / f"{stem_id}.wav"
                sf.write(path, np.column_stack([mono, mono]), sample_rate, subtype="FLOAT")
                primary_paths.append(path)
            auxiliary_paths = []
            for stem_id in ("guitar", "piano"):
                mono = components[stem_id]
                path = auxiliary_root / f"{stem_id}.wav"
                sf.write(path, np.column_stack([mono, mono]), sample_rate, subtype="FLOAT")
                auxiliary_paths.append(path)

            final_paths, profile = build_adaptive_hybrid_stems(
                primary_paths,
                auxiliary_paths,
                final_root,
            )
            final_sum = None
            for path in final_paths:
                self.assertEqual(sf.info(path).subtype, "PCM_24")
                data, _ = sf.read(path, always_2d=True, dtype="float32")
                final_sum = data if final_sum is None else final_sum + data
            primary_sum = sum(
                np.column_stack([mono, mono]).astype(np.float32)
                for mono in core.values()
            )

        self.assertEqual(profile["accepted"], ["guitar", "piano"])
        self.assertEqual({path.stem for path in final_paths}, {"vocals", "guitar", "piano", "other", "drums", "bass"})
        self.assertLess(float(np.max(np.abs(final_sum - primary_sum))), 2e-6)

    def test_adaptive_hybrid_rejects_a_candidate_that_leaks_from_the_vocal(self) -> None:
        sample_rate = 16000
        timeline = np.arange(sample_rate, dtype=np.float64) / sample_rate
        vocals = np.sin(2 * np.pi * 310 * timeline) * 0.12
        core = {
            "vocals": vocals,
            "other": np.sin(2 * np.pi * 820 * timeline) * 0.11,
            "drums": np.sin(2 * np.pi * 125 * timeline) * 0.07,
            "bass": np.sin(2 * np.pi * 65 * timeline) * 0.09,
        }
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            primary_root = root / "primary"
            auxiliary_root = root / "auxiliary"
            primary_root.mkdir()
            auxiliary_root.mkdir()
            primary_paths = []
            for stem_id, mono in core.items():
                path = primary_root / f"{stem_id}.wav"
                sf.write(path, np.column_stack([mono, mono]), sample_rate, subtype="FLOAT")
                primary_paths.append(path)
            leaked = auxiliary_root / "guitar.wav"
            sf.write(leaked, np.column_stack([vocals, vocals]), sample_rate, subtype="FLOAT")
            final_paths, profile = build_adaptive_hybrid_stems(
                primary_paths,
                [leaked],
                root / "final",
            )

        self.assertNotIn("guitar", profile["accepted"])
        self.assertIn("guitar", profile["rejected"])
        self.assertEqual({path.stem for path in final_paths}, {"vocals", "other", "drums", "bass"})


if __name__ == "__main__":
    unittest.main()
