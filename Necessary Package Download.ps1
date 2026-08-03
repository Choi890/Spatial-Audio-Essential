param(
    [switch]$SkipMl,
    [switch]$SkipFfmpeg
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
Set-Location -LiteralPath $PSScriptRoot

$projectVenvPath = Join-Path $PSScriptRoot ".venv"
$projectVenvPython = Join-Path $projectVenvPath "Scripts\python.exe"
$baseRequirements = Join-Path $PSScriptRoot "requirements.txt"
$cudaRequirements = Join-Path $PSScriptRoot "requirements-ml.txt"
$cpuRequirements = Join-Path $PSScriptRoot "requirements-ml-cpu.txt"

function Invoke-SetupCommand {
    param(
        [Parameter(Mandatory = $true)][string]$FilePath,
        [Parameter(Mandatory = $true)][string[]]$ArgumentList
    )

    & $FilePath @ArgumentList
    if ($LASTEXITCODE -ne 0) {
        throw "명령 실행에 실패했습니다: $FilePath $($ArgumentList -join ' ')"
    }
}

function Update-ProcessPath {
    $machinePath = [Environment]::GetEnvironmentVariable("Path", "Machine")
    $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
    $env:Path = "$machinePath;$userPath"
}

function Resolve-Python312 {
    $candidates = [System.Collections.Generic.List[string]]::new()
    $pyLauncher = Get-Command py -ErrorAction SilentlyContinue
    if ($pyLauncher) {
        try {
            $resolved = & $pyLauncher.Source -3.12 -c "import sys; print(sys.executable)" 2>$null
            if ($LASTEXITCODE -eq 0 -and $resolved) {
                $candidates.Add(($resolved | Select-Object -Last 1).Trim())
            }
        }
        catch {
            # Python Launcher에 3.12가 등록되지 않은 경우 다음 후보를 확인한다.
        }
    }

    $pythonCommand = Get-Command python -ErrorAction SilentlyContinue
    if ($pythonCommand) {
        $candidates.Add($pythonCommand.Source)
    }
    $candidates.Add((Join-Path $env:LocalAppData "Programs\Python\Python312\python.exe"))
    $candidates.Add((Join-Path $env:ProgramFiles "Python312\python.exe"))

    foreach ($candidate in $candidates | Select-Object -Unique) {
        if (-not (Test-Path -LiteralPath $candidate)) {
            continue
        }
        try {
            $isPython312 = & $candidate -c "import sys; raise SystemExit(0 if sys.version_info[:2] == (3, 12) else 1)"
            if ($LASTEXITCODE -eq 0) {
                return (Resolve-Path -LiteralPath $candidate).Path
            }
        }
        catch {
            # 실행할 수 없는 후보는 건너뛴다.
        }
    }
    return $null
}

function Resolve-Winget {
    $winget = Get-Command winget -ErrorAction SilentlyContinue
    if (-not $winget) {
        throw "winget을 찾지 못했습니다. Microsoft App Installer를 설치한 뒤 다시 실행하세요."
    }
    return $winget.Source
}

function Install-Python312 {
    Write-Host "Python 3.12가 없어 winget으로 설치합니다..." -ForegroundColor Yellow
    $winget = Resolve-Winget
    Invoke-SetupCommand -FilePath $winget -ArgumentList @(
        "install", "--id", "Python.Python.3.12", "-e",
        "--accept-package-agreements", "--accept-source-agreements", "--silent"
    )
    Update-ProcessPath
}

function Install-FfmpegIfNeeded {
    if ($SkipFfmpeg) {
        Write-Host "FFmpeg 설치를 건너뜁니다."
        return
    }
    if (Get-Command ffmpeg -ErrorAction SilentlyContinue) {
        Write-Host "FFmpeg 확인 완료."
        return
    }

    Write-Host "FFmpeg가 없어 winget으로 설치합니다..." -ForegroundColor Yellow
    $winget = Resolve-Winget
    Invoke-SetupCommand -FilePath $winget -ArgumentList @(
        "install", "--id", "Gyan.FFmpeg", "-e",
        "--accept-package-agreements", "--accept-source-agreements", "--silent"
    )
    Update-ProcessPath
    if (-not (Get-Command ffmpeg -ErrorAction SilentlyContinue)) {
        Write-Warning "FFmpeg 설치는 완료됐지만 현재 창의 PATH에서 찾지 못했습니다. 새 터미널에서는 자동 인식됩니다."
    }
}

Write-Host "Spatial Audio Essential 필수 패키지 설치를 시작합니다." -ForegroundColor Cyan
Write-Host "프로젝트: $PSScriptRoot"

$python312 = Resolve-Python312
if (-not $python312) {
    Install-Python312
    $python312 = Resolve-Python312
}
if (-not $python312) {
    throw "Python 3.12 설치 후 실행 파일을 찾지 못했습니다. Windows를 다시 로그인한 뒤 재실행하세요."
}
Write-Host "Python 3.12: $python312"

if (-not (Test-Path -LiteralPath $projectVenvPython)) {
    Write-Host "프로젝트 전용 가상환경을 생성합니다..."
    Invoke-SetupCommand -FilePath $python312 -ArgumentList @("-m", "venv", $projectVenvPath)
}
if (-not (Test-Path -LiteralPath $projectVenvPython)) {
    throw "가상환경 Python을 생성하지 못했습니다: $projectVenvPython"
}

Write-Host "pip 도구를 갱신합니다..."
Invoke-SetupCommand -FilePath $projectVenvPython -ArgumentList @(
    "-m", "pip", "install", "--upgrade", "pip", "setuptools", "wheel"
)

Write-Host "기본 분석 패키지를 설치합니다..."
Invoke-SetupCommand -FilePath $projectVenvPython -ArgumentList @(
    "-m", "pip", "install", "-r", $baseRequirements
)

if (-not $SkipMl) {
    $hasNvidiaGpu = $null -ne (Get-Command nvidia-smi -ErrorAction SilentlyContinue)
    $selectedMlRequirements = if ($hasNvidiaGpu) { $cudaRequirements } else { $cpuRequirements }
    $computeLabel = if ($hasNvidiaGpu) { "NVIDIA CUDA 12.1" } else { "CPU" }
    Write-Host "Demucs 패키지를 설치합니다. 계산 프로필: $computeLabel" -ForegroundColor Cyan
    Invoke-SetupCommand -FilePath $projectVenvPython -ArgumentList @(
        "-m", "pip", "install", "-r", $selectedMlRequirements
    )
}
else {
    Write-Host "Demucs 설치를 건너뜁니다. Full-mix fallback으로 실행됩니다." -ForegroundColor Yellow
}

Install-FfmpegIfNeeded

Write-Host "설치 결과와 공간음향 자산을 검증합니다..."
Invoke-SetupCommand -FilePath $projectVenvPython -ArgumentList @("tools\diagnose.py")
if (-not $SkipMl) {
    Invoke-SetupCommand -FilePath $projectVenvPython -ArgumentList @(
        "-c", "import demucs, torch, torchaudio; print(f'Demucs ready / torch {torch.__version__} / CUDA {torch.cuda.is_available()}')"
    )
}

Write-Host ""
Write-Host "필수 패키지 설치가 완료됐습니다." -ForegroundColor Green
Write-Host "이제 'Spatial Audio Essential 실행.cmd'를 더블클릭해 실행하세요."
