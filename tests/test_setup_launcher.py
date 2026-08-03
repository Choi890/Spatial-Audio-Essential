from __future__ import annotations

import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class SetupLauncherTests(unittest.TestCase):
    def test_cmd_invokes_the_matching_powershell_installer(self) -> None:
        launcher = (ROOT / "Necessary Package Download.cmd").read_text(encoding="utf-8")
        self.assertIn('Necessary Package Download.ps1', launcher)
        self.assertIn("ExecutionPolicy Bypass", launcher)
        self.assertIn("%*", launcher)

    def test_installer_covers_python_ffmpeg_and_both_demucs_profiles(self) -> None:
        installer = (ROOT / "Necessary Package Download.ps1").read_text(encoding="utf-8")
        self.assertIn("Python.Python.3.12", installer)
        self.assertIn("Gyan.FFmpeg", installer)
        self.assertIn("requirements-ml.txt", installer)
        self.assertIn("requirements-ml-cpu.txt", installer)
        self.assertIn("tools\\diagnose.py", installer)

    def test_cpu_profile_uses_cpu_pytorch_wheels(self) -> None:
        requirements = (ROOT / "requirements-ml-cpu.txt").read_text(encoding="utf-8")
        self.assertIn("https://download.pytorch.org/whl/cpu", requirements)
        self.assertIn("torch==2.5.1+cpu", requirements)
        self.assertIn("torchaudio==2.5.1+cpu", requirements)
        self.assertIn("demucs==4.0.1", requirements)


if __name__ == "__main__":
    unittest.main()
