param(
    [switch]$NoBrowser
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
Set-Location -LiteralPath $PSScriptRoot

$appUrl = "http://127.0.0.1:8768/"
$healthUrl = "http://127.0.0.1:8768/api/health"
$appSourcePath = Join-Path $PSScriptRoot "app.py"
$appSource = Get-Content -LiteralPath $appSourcePath -Raw -Encoding UTF8
$versionMatch = [regex]::Match($appSource, '(?m)^APP_VERSION\s*=\s*"(?<version>[^"]+)"')
if (-not $versionMatch.Success) {
    throw "app.py에서 APP_VERSION을 확인할 수 없습니다."
}
$expectedVersion = $versionMatch.Groups["version"].Value
$venvPython = Join-Path $PSScriptRoot ".venv\Scripts\python.exe"
$logDirectory = Join-Path $PSScriptRoot "data\logs"
$serverOutputLog = Join-Path $logDirectory "launcher-server.out.log"
$serverErrorLog = Join-Path $logDirectory "launcher-server.err.log"

function Test-SpatialAudioServer {
    try {
        $response = Invoke-WebRequest -Uri $healthUrl -UseBasicParsing -TimeoutSec 2
        $health = $response.Content | ConvertFrom-Json
        return $response.StatusCode -eq 200 -and $health.version -eq $expectedVersion
    }
    catch {
        return $false
    }
}

if (Test-SpatialAudioServer) {
    if (-not $NoBrowser) {
        Start-Process $appUrl
        Write-Host "Spatial Audio가 이미 실행 중입니다. 브라우저를 열었습니다."
    }
    else {
        Write-Host "Spatial Audio가 이미 실행 중입니다."
    }
    exit 0
}

$staleListener = Get-NetTCPConnection -LocalPort 8768 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($staleListener) {
    $staleProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $($staleListener.OwningProcess)"
    $isProjectServer = $staleProcess.CommandLine -match "uvicorn\s+app:app" -and $staleProcess.CommandLine -match "8768"
    if (-not $isProjectServer) {
        throw "포트 8768을 다른 프로그램이 사용 중입니다. 해당 프로그램을 종료한 뒤 다시 실행하세요."
    }
    Write-Host "이전 버전 Spatial Audio 서버를 종료하고 v$expectedVersion(으)로 갱신합니다."
    $staleProcessId = $staleListener.OwningProcess
    Stop-Process -Id $staleProcessId -Force
    Wait-Process -Id $staleProcessId -Timeout 5 -ErrorAction SilentlyContinue

    # Windows가 종료된 서버의 포트를 반환할 때까지 기다린 뒤 새 서버를 시작한다.
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        $remainingListener = Get-NetTCPConnection -LocalPort 8768 -State Listen -ErrorAction SilentlyContinue
        if (-not $remainingListener) {
            break
        }
        Start-Sleep -Milliseconds 100
    }
    if (Get-NetTCPConnection -LocalPort 8768 -State Listen -ErrorAction SilentlyContinue) {
        throw "기존 Spatial Audio 서버가 포트 8768을 반환하지 않았습니다. 잠시 후 다시 실행하세요."
    }
}

if (Test-Path -LiteralPath $venvPython) {
    $pythonCommand = $venvPython
}
else {
    $pythonCommand = (Get-Command python -ErrorAction Stop).Source
}

Write-Host "Spatial Audio Essential을 시작하는 중입니다..."
New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
$server = Start-Process `
    -FilePath $pythonCommand `
    -ArgumentList @("-m", "uvicorn", "app:app", "--host", "127.0.0.1", "--port", "8768") `
    -WorkingDirectory $PSScriptRoot `
    -WindowStyle Hidden `
    -RedirectStandardOutput $serverOutputLog `
    -RedirectStandardError $serverErrorLog `
    -PassThru

$ready = $false
for ($attempt = 0; $attempt -lt 60; $attempt++) {
    if ($server.HasExited) {
        break
    }
    if (Test-SpatialAudioServer) {
        $ready = $true
        break
    }
    Start-Sleep -Milliseconds 500
}

if (-not $ready) {
    if (-not $server.HasExited) {
        Stop-Process -Id $server.Id
    }
    if (Test-Path -LiteralPath $serverErrorLog) {
        $serverError = Get-Content -LiteralPath $serverErrorLog -Tail 24 -ErrorAction SilentlyContinue
        if ($serverError) {
            Write-Host ""
            Write-Host "서버 오류 로그:" -ForegroundColor Red
            $serverError | ForEach-Object { Write-Host $_ -ForegroundColor DarkRed }
        }
    }
    throw "분석 서버를 시작하지 못했습니다. Python 패키지와 data\logs\launcher-server.err.log를 확인하세요."
}

if (-not $NoBrowser) {
    Start-Process $appUrl
}
Write-Host ""
Write-Host "Spatial Audio Essential이 준비됐습니다."
Write-Host "서버를 종료하려면 이 창에서 Ctrl+C를 누르세요."
try {
    Wait-Process -Id $server.Id
}
finally {
    $runningServer = Get-Process -Id $server.Id -ErrorAction SilentlyContinue
    if ($runningServer) {
        Stop-Process -Id $server.Id
    }
}
