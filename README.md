# Spatial Audio Essential

Demucs stem 분석과 측정 HRTF·BRIR을 사용하는 로컬 공간음향 스튜디오입니다. 앱 v1.19 / 렌더러 `v130-adaptive-clear-idle-render` 기준입니다. 직접음 초점을 유지하면서 앞·뒤·옆·위·아래 16방향의 독립 공간 반사를 만들고, Original 음량은 Spatial 출력에 맞춥니다.

## 시작하기

Windows에서 다음 파일을 순서대로 실행합니다.

1. `Necessary Package Download.cmd`: Python 3.12, FFmpeg, 프로젝트 `.venv`, CUDA/CPU용 Demucs를 준비하고 공간음향 자산을 검증합니다.
2. `Spatial Audio Essential 실행.cmd`: 로컬 서버와 브라우저를 엽니다.
3. 음악을 선택해 분석하고 **Full Spatial / Original**을 비교합니다. Space는 재생·일시정지, Escape는 중지입니다.
4. **24-bit WAV**로 공간음향 결과를 내보냅니다.

주소: [http://127.0.0.1:8768/](http://127.0.0.1:8768/). 실행 중인 화면에는 새로고침으로 프런트엔드 변경을 적용합니다.

수동 설치와 실행:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements-ml.txt
.\.venv\Scripts\python.exe -m uvicorn app:app --host 127.0.0.1 --port 8768
```

NVIDIA GPU가 없으면 `requirements-ml-cpu.txt`, 기본 분석 패키지만 필요하면 `requirements.txt`를 사용합니다. 자동 설치 옵션은 `Necessary Package Download.cmd -SkipMl` 및 `-SkipFfmpeg`입니다. 브라우저 없이 실행하려면 `powershell -File start.ps1 -NoBrowser`를 사용합니다.

## 분석과 재생

- Mono·stereo, 최대 420MB. AAC, FLAC, M4A, MP3, OGG, OPUS, WAV, WEBM을 지원하며 일부 형식에는 FFmpeg가 필요합니다. 3채널 이상은 임의 다운믹스 없이 거부합니다.
- `htdemucs_ft`의 4스템을 기본으로 사용하고, `htdemucs_6s`의 기타·피아노 후보는 품질 기준을 통과할 때만 추가합니다. 분리되지 않은 성분은 residual로 보존합니다.
- CPU 특성 분석과 CUDA 분리를 병렬 실행합니다. FP32, shifts=2, overlap=0.36, segment=7초를 유지하며 GPU 배치는 메모리가 부족하면 축소합니다. CPU는 기존 Demucs 실행 경로를 사용합니다.
- 파일 내용과 모델·분석 설정으로 캐시를 구별합니다. 새 분석·초기화·연결 종료 시 진행 중인 작업을 취소합니다.
- 악기 카드는 곡 전체의 추정 위치에 겹치지 않게 배치하며 재생 중 위치를 고정합니다. Stem 반응바와 스펙트럼은 재생 신호에 반응합니다.

**Original**은 원본 AudioBuffer에 곡별 고정 이득만 적용해 Spatial의 대표 분석 구간 출력 음량에 맞춥니다. 공간 처리·EQ·컴프레서를 사용하지 않아 파형의 강약 비율을 유지하며 stem 표시는 비활성화합니다. 증폭 시에는 원본의 추정 피크 여유로 이득을 제한합니다.

**Full Spatial**은 정렬된 stem과 residual의 직접음을 동일 이득으로 합산한 뒤 공통 고정 바이노럴 행렬로 한 번 렌더링합니다. 측정 HRIR의 ±35도 가상 스테이지와 좌우 대칭으로 mono 보컬의 중심을 유지합니다. Stem마다 다른 직접음 필터를 적용하거나 과도음에 따라 잔향을 duck하지 않습니다.

공간 경로는 stem별 초기·외곽 반사, hall 반사, 16방향 독립 확산장과 measured BRIR로 구성합니다. 독립 확산장은 52ms 이후 전이 구간부터 후기장까지 이어집니다. 기록된 side 신호의 즉시 역극성 복사 경로는 사용하지 않습니다. 톤 보정은 공통 경로에서 수행하고 QA 제한은 공간 버스에 적용합니다.

후기장은 방향별 반사의 고정 상승 구간과 주파수별 감쇠를 사용합니다. 음량에 따라 보컬을 duck하거나 위치를 움직이지 않습니다. 출력 보정은 압축 전 신호의 피크 여유를 먼저 확인합니다. 피크가 큰 곡은 강약을 누르는 대신 고정 출력 이득을 낮출 수 있습니다. 실제 녹음실을 추정·복원하는 기능은 아닙니다.

공간음향은 전체 곡 사전 렌더 없이 실시간 DSP로 재생합니다. 모드 전환은 재생 위치를 유지하고, 중지는 공통 출력과 전환 중인 그래프를 함께 정리합니다. 부하에 따른 Full / Balanced / Safe DSP 전환은 좌우 대칭을 유지합니다.

WAV 내보내기는 오프라인 렌더링 후 BS.1770-5 gated loudness와 8× true peak를 측정합니다. Loudness 보정과 필요한 감쇠를 거쳐 24-bit stereo WAV를 생성합니다.

기존 동일 장비의 3분 15초 음악 비교에서 서버 최초 분석은 **106.4→94.9초**, stem 캐시 재사용은 **3.4초**였습니다. 고정밀 최초 분석 1분 이하는 달성하지 못했습니다. 업로드·브라우저 준비·첫 모델 다운로드는 제외한 수치입니다. [측정 조건과 한계](EVALUATION_PROTOCOL.md)를 참고하세요.

## 자산과 예외 처리

기본 HRTF는 **SADIE II KEMAR**, BRIR은 **AIR Aula Carolina**이며 자동 적용됩니다. 각각 `data/hrtf/profiles.json`, `data/brir/profiles.json`에 정의되어 있습니다. 서버는 `data/assets-manifest.json`의 크기와 SHA-256을 검증합니다.

측정 HRTF를 불러오지 못하면 브라우저 native HRTF 또는 결정론적 synthetic FIR을 사용합니다. BRIR이 없으면 제한된 초기반사 경로를 사용합니다. Stem 정렬·합산 신뢰도가 낮거나 브라우저 디코딩에 실패하면 분석 결과를 보존하고 가능한 재생 경로를 사용합니다.

출처·라이선스는 [SADIE II 안내](data/hrtf/SADIE_II_NOTICE.txt)와 [AIR Database 안내](data/brir/AIR_DATABASE_NOTICE.txt)에 있습니다. 자산 생성 도구는 `tools/build_measured_hrtf_library.py`, `build_universal_hrtf.py`, `build_brir_profiles.py`, `build_asset_manifest.py`입니다. 자산을 재생성하면 manifest도 갱신하며 검증 대상 WAV·SOFA·HRIR의 원시 바이트를 유지합니다.

## 설정과 운영

실행 전에 필요한 환경 변수만 지정합니다.

| 환경 변수 | 기본값 | 용도 |
|---|---|---|
| `SPATIAL_SEPARATOR_MODEL` | `htdemucs_ft` | 4스템 모델. `htdemucs`도 지원하며 잘못된 값은 기본 모델 사용 |
| `SPATIAL_DEMUCS_SHIFTS` | `2` | 분리 안정화 횟수 |
| `SPATIAL_DEMUCS_OVERLAP` | `0.36` | 분리 구간 겹침 |
| `SPATIAL_DEMUCS_SEGMENT` | `7` | 분리 구간 길이, 초 |
| `SPATIAL_DEMUCS_JOBS` | `1` | Demucs 작업 수 |
| `SPATIAL_DEMUCS_GPU_BATCH_SIZE` | `4` | CUDA 배치 크기, 1–8 |
| `SPATIAL_ANALYSIS_CONCURRENCY` | `1` | 서버 분석 동시성, 1–2 |

예: PowerShell에서 `$env:SPATIAL_DEMUCS_GPU_BATCH_SIZE = "2"`로 설정한 뒤 실행합니다. 분리 설정을 바꾸면 해당 설정의 캐시를 새로 생성합니다.

업로드 파일은 24시간, 일반 출력은 14일, 분석 JSON 캐시는 30일 기준으로 정리합니다. 분석 캐시는 최대 256개, Demucs 캐시는 최대 12GiB·30일 기준입니다. 주기적 정리는 현재 작업의 캐시를 보호합니다.

서버는 로컬 origin·host 제한, CSP·보안 헤더, 스트리밍 업로드 용량 제한, 경로 검증을 적용합니다. `/api/health`에서 버전·분리 provider·작업 상태를 확인하고 요청 ID와 `Server-Timing`으로 분석 요청을 추적합니다.

## 개발과 검증

```powershell
python tools/diagnose.py
npm.cmd install
npx.cmd playwright install
npm.cmd test
```

Chrome·Edge 테스트는 해당 브라우저가 설치되어 있어야 합니다. 개별 검사는 `npm.cmd run check`, `npm.cmd run test:audio`, `npm.cmd run test:e2e`로 실행합니다.

Python은 분석·캐시·취소·채널·자산 경계를, Node는 DSP 분석을 검사합니다. Playwright는 Chrome·Edge·Firefox의 재생·음향·UI 회귀와 WebKit 기본 동작을 검사합니다. 조건별 음량을 맞춘 비교 청취는 `/mushra`에서 준비합니다.

## 코드 구조

| 경로 | 역할 |
|---|---|
| `app.py` | API, 업로드·작업·캐시·자산 관리 |
| `backend/audio_engine.py`, `features.py` | 분석 조율·악기 활성도 추정, 공유 프레임 기반 특징 계산 |
| `backend/separation.py`, `demucs_worker.py` | 모델 실행·분리 품질·Stem 캐시, CUDA worker |
| `backend/audio_io.py` | 오디오 디코딩·채널 검증·라우드니스와 피크 측정 |
| `static/app.js` | 분석·자산·렌더 캐시·내보내기 조율 |
| `static/js/transport.js`, `task-scope.js` | 재생 명령·그래프 수명, 분석 취소와 최신 결과 적용 |
| `static/js/spatial-renderer.js` | 설정을 고정한 렌더 계획과 DSP 그래프 생성 |
| `static/js/studio-view.js` | 화면·카드·Stem 미터·스펙트럼과 화면 상태 |
| `static/js/config.js`, `utils.js` | Stem·악기 설정표와 DOM·표시 공통 함수 |
| `static/js/binaural-scene.js` | 공통 직접음·톤 보정과 후기장 FIR |
| `static/js/spatial-quality.js`, `runtime-quality.js` | Coherence·양이 응답 분석과 부하 기반 품질 전환 |
| `static/js/mushra.js`, `static/mushra.html` | 비교 청취 도구 |
| `static/index.html`, `static/styles.css` | 스튜디오 화면과 테마 |
| `tests/`, `tools/` | 회귀 검사·수치 기준, 자산 생성·진단·성능 측정 |

## 연구와 검증 범위

비개인 HRTF의 지각 적합도는 청취자마다 다릅니다. 회귀 검사 통과는 실제 음악의 음질·감동·외재화 개선을 입증하지 않으며 대표 음악의 통제된 청취 결과는 아직 없습니다. 원본과 공간 처리의 전체 주파수 응답·위상이 동일하다고 보장하지 않습니다.

- [현재 바이노럴 설계와 논문·영상·기술 근거](BINAURAL_SCENE_RESEARCH.md)
- [구조 재설계·공식 자료·성능 측정 범위](ARCHITECTURE.md)
- [측정 조건, 비교 결과와 검증 한계](EVALUATION_PROTOCOL.md)
- [이전 공간음향 설계 기록](SPATIAL_AUDIO_RESEARCH.md)
