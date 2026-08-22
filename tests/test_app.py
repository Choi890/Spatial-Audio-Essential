from __future__ import annotations

import hashlib
import tempfile
import unittest
import wave
import json
import struct
from array import array
from pathlib import Path
from unittest.mock import patch

from fastapi import HTTPException

import app as spatial_app
import h5py
import numpy as np


class FakeStreamingRequest:
    def __init__(self, chunks: list[bytes]) -> None:
        self._chunks = chunks

    async def stream(self):
        for chunk in self._chunks:
            yield chunk


class AppBoundaryTests(unittest.IsolatedAsyncioTestCase):
    def test_stale_analysis_profile_cache_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            cache_root = Path(temp)
            file_hash = "a" * 64
            cache_path = cache_root / f"{file_hash}.json"
            cache_path.write_text(
                json.dumps({"analysisProfile": "obsolete-profile"}),
                encoding="utf-8",
            )
            with patch.object(spatial_app, "ANALYSIS_CACHE_DIR", cache_root):
                self.assertIsNone(spatial_app.read_cached_analysis(file_hash, "song.flac"))
            self.assertFalse(cache_path.exists())

    def test_spatial_asset_manifest_and_sofa_are_valid(self) -> None:
        status = spatial_app.validate_spatial_assets()
        self.assertEqual(status["status"], "ready")
        self.assertTrue(all(item["valid"] for item in status["assets"]))
        profile = json.loads((spatial_app.HRTF_DIR / "universal-listener-v1.json").read_text(encoding="utf-8"))
        with h5py.File(spatial_app.HRTF_DIR / "universal-listener-v1.sofa", "r") as sofa:
            impulses = sofa["Data.IR"][:]
            positions = sofa["SourcePosition"][:]
            self.assertEqual(impulses.shape, (144, 2, 256))
            self.assertEqual(positions.shape, (144, 3))
            self.assertEqual(int(sofa["Data.SamplingRate"][0]), profile["sampleRate"])
            self.assertEqual(sofa["SourcePosition"].attrs["Type"], "spherical")
            self.assertEqual(sofa["ListenerPosition"].attrs["Units"], "metre")
            for elevation in (-20.0, 0.0, 20.0):
                left_index = np.where((positions[:, 0] == -45.0) & (positions[:, 1] == elevation))[0][0]
                right_index = np.where((positions[:, 0] == 45.0) & (positions[:, 1] == elevation))[0][0]
                np.testing.assert_allclose(impulses[left_index, 0], impulses[right_index, 1], atol=1e-6)
                np.testing.assert_allclose(impulses[left_index, 1], impulses[right_index, 0], atol=1e-6)
        runtime = (spatial_app.HRTF_DIR / "universal-listener-v1.hrir").read_bytes()
        magic, directions, receivers, taps, sample_rate = struct.unpack("<8sIIII", runtime[:24])
        self.assertEqual(magic, b"SAHRTF1\0")
        self.assertEqual((directions, receivers, taps, sample_rate), (144, 2, 256, 48000))
        runtime_ir = np.frombuffer(runtime, dtype="<f4", offset=24 + directions * 3 * 4).reshape(directions, receivers, taps)
        np.testing.assert_array_equal(runtime_ir, impulses)

    def test_measured_hrtf_registry_and_runtime_assets_are_consistent(self) -> None:
        registry = json.loads((spatial_app.HRTF_DIR / "profiles.json").read_text(encoding="utf-8"))
        self.assertEqual(registry["schema"], "SpatialAudioEssential.HRTFLibrary/1.0")
        self.assertEqual(registry["defaultId"], "sadie-kemar")
        self.assertEqual(
            [entry["id"] for entry in registry["profiles"]],
            [
                "sadie-kemar",
                "sadie-ku100",
                "sadie-human-003",
                "sadie-human-009",
                "universal-listener-v1",
            ],
        )

        for entry in registry["profiles"]:
            profile_path = spatial_app.HRTF_DIR / entry["profileAsset"]
            profile = json.loads(profile_path.read_text(encoding="utf-8"))
            runtime = (spatial_app.HRTF_DIR / profile["rendering"]["runtimeAsset"]).read_bytes()
            magic, directions, receivers, taps, sample_rate = struct.unpack("<8sIIII", runtime[:24])
            expected_size = 24 + directions * 3 * 4 + directions * receivers * taps * 4
            self.assertEqual(magic, b"SAHRTF1\0")
            self.assertEqual(receivers, 2)
            self.assertEqual(directions, entry["directions"])
            self.assertEqual(taps, profile["impulseLength"])
            self.assertEqual(sample_rate, profile["sampleRate"])
            self.assertEqual(len(runtime), expected_size)

    async def test_upload_stream_is_written_incrementally_and_hashed(self) -> None:
        chunks = [b"alpha", b"", b"-", b"omega"]
        profile = b"profile-v2"
        expected = hashlib.sha256(profile + b"\0" + b"alpha-omega").hexdigest()

        with tempfile.TemporaryDirectory() as temp:
            destination = Path(temp) / "upload.bin"
            size, digest, content_digest = await spatial_app.stream_request_to_file(
                FakeStreamingRequest(chunks),
                destination,
                profile_prefix=profile,
            )

            self.assertEqual(size, len(b"alpha-omega"))
            self.assertEqual(digest, expected)
            self.assertEqual(content_digest, hashlib.sha256(b"alpha-omega").hexdigest())
            self.assertEqual(destination.read_bytes(), b"alpha-omega")

    async def test_upload_stream_stops_at_the_server_limit(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            destination = Path(temp) / "oversized.bin"
            with patch.object(spatial_app, "UPLOAD_CHUNK_WRITE_LIMIT", 4):
                with self.assertRaises(HTTPException) as raised:
                    await spatial_app.stream_request_to_file(
                        FakeStreamingRequest([b"123", b"45"]),
                        destination,
                        profile_prefix=b"profile",
                    )

        self.assertEqual(raised.exception.status_code, 413)

    def test_filename_and_request_id_boundaries(self) -> None:
        self.assertEqual(
            spatial_app.sanitize_filename(r"..\album/../테스트<>.wav"),
            "테스트_.wav",
        )
        spatial_app.validate_audio_filename("master.flac")
        with self.assertRaises(HTTPException) as raised:
            spatial_app.validate_audio_filename("payload.exe")
        self.assertEqual(raised.exception.status_code, 415)

        supplied = "request_20260727"
        self.assertEqual(spatial_app.normalize_request_id(supplied), supplied)
        generated = spatial_app.normalize_request_id("../bad")
        self.assertRegex(generated, r"^[a-f0-9]{16}$")

    def test_measured_brir_is_bounded_and_has_no_direct_segment(self) -> None:
        brir_path = spatial_app.BRIR_DIR / "air_aula_carolina_front_late.wav"
        with wave.open(str(brir_path), "rb") as audio:
            self.assertEqual(audio.getnchannels(), 2)
            self.assertEqual(audio.getframerate(), 48_000)
            self.assertEqual(audio.getnframes(), 153_600)
            direct_segment = array("h", audio.readframes(round(0.045 * 48_000)))
            late_segment = array("h", audio.readframes(round(0.04 * 48_000)))

        self.assertTrue(direct_segment)
        self.assertEqual(max(abs(sample) for sample in direct_segment), 0)
        self.assertGreater(max(abs(sample) for sample in late_segment), 0)

    def test_brir_room_library_contains_valid_bounded_stereo_profiles(self) -> None:
        manifest = json.loads((spatial_app.BRIR_DIR / "profiles.json").read_text(encoding="utf-8"))
        self.assertEqual(manifest["schema"], "SpatialAudioEssential.BRIRLibrary/2.0")
        self.assertEqual(manifest["defaultId"], "aula")
        self.assertEqual(
            {profile["id"] for profile in manifest["profiles"]},
            {"meeting", "lecture", "stairway", "aula"},
        )
        for profile in manifest["profiles"]:
            path = spatial_app.BRIR_DIR / profile["file"]
            self.assertEqual(hashlib.sha256(path.read_bytes()).hexdigest(), profile["sha256"])
            self.assertTrue(profile["measured"])
            with wave.open(str(path), "rb") as audio:
                self.assertEqual(audio.getnchannels(), 2)
                self.assertEqual(audio.getframerate(), 48_000)
                self.assertGreaterEqual(audio.getnframes(), 30_000)
                samples = array("h", audio.readframes(audio.getnframes()))
                self.assertLessEqual(max(abs(sample) for sample in samples), 32767)

    def test_measured_brir_metrics_match_golden_regression_ranges(self) -> None:
        golden_path = Path(__file__).parent / "golden" / "brir_metrics_v2.json"
        golden = json.loads(golden_path.read_text(encoding="utf-8"))
        manifest = json.loads((spatial_app.BRIR_DIR / "profiles.json").read_text(encoding="utf-8"))
        for profile in manifest["profiles"]:
            with wave.open(str(spatial_app.BRIR_DIR / profile["file"]), "rb") as audio:
                sample_rate = audio.getframerate()
                frames = audio.getnframes()
                samples = np.frombuffer(audio.readframes(frames), dtype="<i2").reshape(-1, 2).astype(np.float64) / 32768
            direct_frames = round(golden["directSilenceSeconds"] * sample_rate)
            self.assertEqual(float(np.max(np.abs(samples[:direct_frames]))), 0)
            early = samples[direct_frames : direct_frames + round(0.08 * sample_rate)]
            left, right = early[:, 0], early[:, 1]
            iacc80 = float(np.dot(left, right) / max(1e-12, np.sqrt(np.dot(left, left) * np.dot(right, right))))
            energy = np.sum(samples * samples, axis=1)
            c80_db = 10 * np.log10(
                max(1e-12, float(np.sum(energy[direct_frames : direct_frames + round(0.08 * sample_rate)]))) /
                max(1e-12, float(np.sum(energy[direct_frames + round(0.08 * sample_rate) :])))
            )
            balance_db = 10 * np.log10(
                max(1e-12, float(np.sum(samples[:, 0] ** 2))) /
                max(1e-12, float(np.sum(samples[:, 1] ** 2)))
            )
            expected = golden["profiles"][profile["id"]]
            values = {
                "duration": frames / sample_rate,
                "iacc80": iacc80,
                "c80Db": float(c80_db),
                "balanceDb": float(balance_db),
            }
            for metric, value in values.items():
                lower, upper = expected[metric]
                self.assertGreaterEqual(value, lower, f"{profile['id']} {metric}")
                self.assertLessEqual(value, upper, f"{profile['id']} {metric}")


if __name__ == "__main__":
    unittest.main()
