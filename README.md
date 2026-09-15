# Spatial Audio Essential

**실측 다중 BRIR과 합성 FIR을 활용한 실시간 공간음향 렌더러**
현재 버전: **v1.18**

Spatial Audio Essential은 일반적인 스테레오 음악의 원래 음상과 inter-channel phase를 가능한 한 보존하면서, **source separation, measured HRTF/BRIR, binaural rendering, objective QA**를 결합해 공간적 외재화와 방향성 반사를 추가하는 실시간 공간음향 시스템입니다.

**연구용 프로토타입입니다.** 구현과 회귀 테스트는 있지만, 분리 없는 공간 처리 대비 음질·외재화 개선을 입증한 청취 실험 결과는 아직 없습니다. 기여 범위는 **직접음 복원 구조를 유지하면서 stem별 공간 효과를 제어하는 시스템 구현**입니다. 직접음 복원은 최종 출력의 주파수 응답·위상 보존을 보장하지 않습니다.

v1.18에서는 전체 파일 식별자와 설정의 SHA-256 캐시 키, 안티앨리어싱 분석 리샘플링, 원래 샘플레이트의 연속 구간 분석, 절댓값 기반 IACC를 적용했습니다. 청취평가에는 LUFS 음량 맞춤·재생 위치 유지·비교 조건 추가·EQ 조건 기록을 보강했습니다. 검증 범위와 실험 절차는 [EVALUATION_PROTOCOL.md](EVALUATION_PROTOCOL.md)에 정리했습니다.

v1.17에서는 음질과 공간 렌더링 구조를 유지하면서 CPU/GPU 병렬 분석, 콘텐츠 기반 Stem 캐시, 제한형 캐시 정리, 공간 에셋 검증 캐시와 불필요한 UI 렌더링 제거를 적용했습니다.

* Meeting Room
* Lecture Room
* Stairway
* Aula Carolina

Full Spatial 출력은 원본 Dry 신호를 그대로 섞는 방식이 아닙니다. 핵심 `vocals`, `drums`, `bass`, `other`와 품질 게이트를 통과한 `guitar`, `piano` Stem의 기존 L/R sample phase를 지연 없는 primary path에 유지하고, 원본에서 보정된 Stem 합을 뺀 residual도 동일한 경로로 합산합니다.

측정 HRTF는 직접음이 아니라 앞 스테이지 외재화, 20m 공연장의 전후·좌우·천장 방향성 반사, 후기 공간 응답을 만드는 데 사용합니다. 완전히 처리되지 않은 원본은 비교용 `Original` 모드에서만 재생됩니다.

---

## Research Question

> **스테레오 음악의 기존 직접음과 inter-channel phase를 최대한 보존하면서 공간감과 externalization을 확장할 수 있는가?**

이 질문을 바탕으로 다음 세 가지 설계 원칙을 사용합니다.

1. 직접음 primary path는 기존 stereo L/R sample phase를 유지합니다.
2. 공간 정보는 직접음을 강제로 재배치하지 않고, HRTF 기반 방향성 반사와 measured BRIR late field를 통해 추가합니다.
3. Source separation에서 누락된 신호는 mixture residual을 계산해 다시 보존합니다.

---

## Main Contributions

### 1. Direct-path stem and residual reconstruction

Demucs(`htdemucs_ft`)를 이용해 입력 음악을 `vocals`, `drums`, `bass`, `other`의 네 stem으로 분리합니다.

분리된 stem의 합과 원본 사이의 공통 sample lag와 gain을 정합한 뒤,

```text
Residual = Original - Sum(Aligned Stems)
```

을 계산하여 source separation 과정에서 누락된 성분을 보존합니다.

신뢰할 수 있는 정렬을 찾지 못한 경우에는 원본 L/R sample phase를 유지하는 fallback 경로로 전환합니다.

Primary path에는 인위적인 panning, HRTF convolution, 추가 delay를 적용하지 않습니다.

동일하게 정합한 stem을 같은 이득으로 더하면 `Sum(Aligned Stems) + Residual = Original`입니다. 이 등식은 신호 합산 구조의 성질이며 새로운 분리 성능을 증명하지 않습니다. 반사·잔향·기기 EQ·출력 이득을 적용한 최종 출력은 원본과 달라집니다. Demucs의 필요성은 **분리 없는 full-mix 공간 처리 대비 stem별 공간 처리의 이득**으로 검증해야 합니다.

### 2. Measured HRTF / BRIR spatial rendering

SADIE II의 측정 HRIR과 RWTH Aachen AIR Database의 실측 room response를 사용합니다.

현재 HRTF 프로파일:

- KEMAR
- KU100
- Human 003
- Human 009

현재 측정 공간 응답:

- Meeting Room
- Lecture Room
- Stairway
- Aula Carolina

HRTF는 직접음을 대체하기보다 directional reflection과 externalization layer를 생성하는 데 사용합니다.

### 3. Objective and subjective evaluation

렌더러의 stereo impulse response와 최종 출력을 기준으로 다음 지표를 분석합니다.

- IACC80
- C50 / C80
- DRR
- EDT / T20
- ITU-R BS.1770-5 Integrated Loudness
- 8× oversampled True Peak
- Stereo correlation

또한 `/mushra`에서 `Original`과 `Full Spatial`을 무작위 순서로 비교할 수 있는 주관 평가 보조 도구를 제공합니다.

선택적으로 분리 없는 공간 처리와 stem별 공간 처리 WAV를 추가할 수 있습니다. 서버가 입력별 LUFS-I·추정 true peak를 측정하고 감쇠만으로 음량을 맞춥니다. 파일 길이가 50ms 넘게 다르면 세션 생성을 차단합니다. 재생 위치는 전환 시 유지하지만 파일 간 지연 정렬과 EQ 일치 여부는 사용자가 확인해야 합니다. EQ 선택은 기록용입니다.

### 4. Reproducibility and regression testing

프로젝트는 Python·Node DSP 테스트와 Playwright 기반 UI/E2E 테스트를 포함합니다. GitHub Actions에는 Windows 전체 테스트와 Linux의 Python·Node DSP/자산 검증을 구성했습니다.

검증 항목에는 residual 상쇄, primary path 지연, mono compatibility, stereo correlation, finite output, peak guard, graph disposal 등이 포함됩니다.

---

## System Pipeline

```text
Stereo Music
     |
     v
Demucs Source Separation
     |
     +-- Vocals
     +-- Drums
     +-- Bass
     +-- Other
     |
     v
Sample / Gain Alignment
     |
     +--------------------+
     |                    |
     v                    v
Stem Primary        Mixture Residual
     |                    |
     +---------+----------+
               |
               v
     Phase-coherent Primary
               |
     +---------+----------+-------------+
     |                    |             |
     v                    v             v
HRTF Reflections     Lateral Field   BRIR Late Field
     |                    |             |
     +---------+----------+-------------+
               |
               v
          Full Spatial
               |
               v
   LUFS / True Peak / Spatial QA
```

---

## Evaluation Status

현재 프로젝트에는 객관 지표 계산과 주관 평가 도구가 구현되어 있습니다. 다만 README에는 아직 동일 입력 조건에서 수행한 대표 benchmark 결과를 고정해 두지 않았습니다.

임펄스 QA는 `ignoreStems: true`로 실행하는 full-mix 경로 진단입니다. 실제 stem 분리부터 최종 청취까지의 검증 결과로 해석하면 안 됩니다. 합성 신호 회귀 테스트와 대표 음악·사람 대상 청취평가도 구분합니다. `1 − IACC`는 폭·포위감 관련 보조 수치이며 지각 평가 점수가 아닙니다. 현재 DRR은 onset 이후 10ms를 직접음 구간으로 가정하는 근사값입니다.

따라서 아래 값은 임의의 수치를 넣지 않고, 향후 동일한 test material과 level-matching 조건에서 재현 가능한 결과를 확보한 뒤 업데이트할 예정입니다.

| Metric | Original | Full Spatial | Purpose |
|---|---:|---:|---|
| IACC80 | TBD | TBD | Lateral spatial impression |
| C80 | TBD | TBD | Musical clarity |
| DRR | TBD | TBD | Direct / reverberant balance |
| Integrated LUFS | TBD | TBD | Level matching |
| True Peak | TBD | TBD | Output safety |
| Stereo Correlation | TBD | TBD | Phase stability |

---

## Current Limitations

현재 시스템은 연구 및 개인 실험을 위한 prototype입니다.

- 개인 측정 HRTF를 사용하지 않습니다.
- Head tracking 및 6DoF를 지원하지 않습니다.
- 비개인 HRTF이므로 사용자마다 localization / externalization 성능이 다를 수 있습니다.
- 입력은 mono/stereo music으로 제한됩니다.
- 현재 source separation은 Demucs에 의존합니다.
- 객관적 spatial metric만으로 실제 청취 품질을 완전히 설명할 수 없으므로 주관 청취평가가 필요합니다.
- 현재 AIR 기반 BRIR은 직접음 전체를 그대로 사용하지 않고, primary path와 중복을 피하기 위해 제한된 late-field 용도로 사용합니다.

---

## Research Direction

향후에는 다음 연구 방향으로 확장할 수 있습니다.

- Deep-learning-based sound source localization
- Joint source separation and spatial estimation
- Personalized HRTF estimation
- Listener / environment-adaptive spatial audio
- Objective-subjective spatial quality correlation
- Separation confidence와 공간 파라미터를 함께 최적화하는 adaptive rendering

---

## Documentation

- `SPATIAL_AUDIO_RESEARCH.md` — 논문 및 표준 적용 근거, 적용/제외 기술, 검증 규칙
- `EVALUATION_PROTOCOL.md` — 수정 검증 범위와 분리 유무 비교 실험 절차
- `DEVICE_CORRECTION.md` — 출력 기기별 보정 원칙과 한계
- `tests/` — backend, DSP, UI regression tests
- `.github/workflows/ci.yml` — 자동 회귀 검증

---

# Detailed Implementation

아래는 현재 구현의 세부 동작과 실행 방법입니다.

## 주요 특징

### 실측 HRTF 기반 binaural 렌더링

기본 렌더러는 Apache-2.0 라이선스로 공개된 **SADIE II 측정 HRIR**을 사용합니다.

UI에서 다음 네 가지 프로파일을 선택할 수 있습니다.

* KEMAR
* KU100
* Human 003
* Human 009

개인 HRTF를 측정하지 않아도 청취자가 가장 자연스럽게 느끼는 프로파일을 직접 선택할 수 있습니다. 다만 이 기능은 개인화 HRTF를 대체하지 않으며, 모든 사용자에게 동일한 전후·상하 외재화 성능을 보장하지는 않습니다.

관련 파일은 다음과 같습니다.

* `data/hrtf/profiles.json`
  SADIE II 프로파일 네 개와 결정론적 범용 폴백을 등록하는 런타임 레지스트리입니다.

* `data/hrtf/sadie-*.hrir`
  48kHz, 2수신기, 256-tap 측정 HRIR을 무손실 Float32 형식으로 저장한 런타임 자산입니다.

* `data/hrtf/universal-listener-v1.*`
  측정 자산을 불러오지 못했을 때 사용하는 144방향 대칭 폴백입니다.

브라우저는 요청 방향과 가장 가까운 HRIR을 구면 각거리 기준으로 선택합니다. 이후 양쪽 귀의 onset을 각각 분리하고, 시간 정렬된 상태에서 방향 보간을 수행합니다.

HRIR은 현재 AudioContext의 sample rate에 맞춰 선형 리샘플링됩니다. 따라서 44.1kHz, 48kHz, 96kHz 환경에서도 Convolver와 HRIR 사이의 sample-rate 불일치가 발생하지 않습니다.

`tools/build_measured_hrtf_library.py`는 Zenodo 원본 파일의 MD5를 검증한 뒤, 좌표계와 레벨을 결정론적으로 변환합니다. 데이터 출처와 라이선스 정보는 `data/hrtf/SADIE_II_NOTICE.txt`에 기록되어 있습니다.

모든 HRTF와 BRIR 자산은 `data/assets-manifest.json`에 저장된 파일 크기와 SHA-256 해시를 기준으로 서버 시작 시 검증됩니다.

---

## Full Spatial QA

Full Spatial QA는 음악 구간 자체를 분석하지 않습니다. 렌더러를 통과시킨 **stereo impulse response**를 기준으로 다음 음향 지표를 계산합니다.

* IACC80
* C50
* C80
* DRR
* EDT
* T20

실시간 상관도와 transient 감시는 AudioWorklet에서 수행합니다. 긴 곡의 room-send automation은 전체 이벤트를 한 번에 예약하지 않고 rolling window 방식으로 순차 예약합니다.

방향별 HRTF 경로는 동일한 선형 응답을 하나의 합성 FIR로 통합해 실시간 DSP 부하를 줄였습니다. 또한 20×20×20m 공연장 중앙에서 벽 10m, 벽 모서리 14.14m, 공간 모서리 17.32m에 해당하는 반사 좌표와 음속 기반 지연을 사용해 전후·좌우·상하 공간을 확장합니다.

---

## 24-bit WAV 오프라인 렌더링

Full Spatial 분석이 완료되면 `24-bit WAV` 버튼을 통해 전체 곡과 잔향 꼬리를 오프라인으로 렌더링할 수 있습니다.

HQ 렌더 결과는 IndexedDB에 8MB 단위 chunk로 저장됩니다. 입력 파일과 설정이 같으면 다음 브라우저 세션에서도 기존 결과를 재사용합니다.

렌더링이 끝나면 서버가 결과물을 다시 측정합니다.

* ITU-R BS.1770-5 gated LUFS
* 8× oversampled true peak

최종 true peak가 허용 범위를 넘는 경우에만 전체 출력을 감쇠해 **-1dBTP 이하**로 맞춥니다.

`/mushra`에는 `Original`과 `Full Spatial`을 무작위 순서로 비교할 수 있는 주관 평가 보조 도구가 포함되어 있습니다.

---

## 프로젝트 구조

### 백엔드

* `backend/audio_engine.py`
  오디오 메타데이터, 스펙트럼, stereo image, Demucs stem 분석을 담당합니다.

* `app.py`
  FastAPI 서버, 오디오 업로드 API, 정적 프런트엔드, `/outputs` stem 제공, `/brir` 측정 응답 제공을 담당합니다.

### 프런트엔드

* `static/app.js`
  Full Spatial 및 Original 그래프, stem 직접음, mixture residual, 앞 스테이지 외재화와 20m 공연장 필드, 측정 BRIR 렌더러, stem analyser UI를 구성합니다.

* `static/js/config.js`
  stem 표시 정보와 실시간 악기 signature를 정의합니다.

* `static/js/device-profiles.js`
  AirPods Pro 3, IE 600, MR4를 위한 측정 기반 bounded-DF 또는 anechoic PEQ와 출력 기기별 렌더러 정책을 정의합니다. 보정의 근거와 한계는 `DEVICE_CORRECTION.md`에 정리되어 있습니다.

* `static/js/runtime-quality.js`
  Web Audio render capacity를 기반으로 Full, Balanced, Safe 품질을 자동 선택하고 전환합니다.

* `static/js/utils.js`
  API 경로, 데이터 포맷, DOM 업데이트 관련 공통 기능을 제공합니다.

* `static/styles.css`
  라이트·다크 테마와 대시보드 UI를 정의합니다.

---

## 실행 방법

새 PC에서는 먼저 `Necessary Package Download.cmd`를 더블클릭합니다. 이 설치 런처는 Python 3.12와 FFmpeg를 확인하고, 없으면 공식 winget 패키지로 설치합니다. 이후 `.venv`를 만들고 기본 분석 패키지와 PC에 맞는 NVIDIA CUDA/CPU Demucs 패키지를 설치한 뒤 공간음향 자산까지 검증합니다.

프로젝트 루트의 다음 파일을 더블클릭하면 Python 분석 서버가 시작되고 브라우저가 자동으로 열립니다.

```text
Spatial Audio Essential 실행.cmd
```

수동으로 실행하려면 다음 명령을 사용합니다.

```powershell
cd "D:\Code\Codex\Spatial Audio Essential"
python -m uvicorn app:app --host 127.0.0.1 --port 8768
```

서버가 실행되면 브라우저에서 다음 주소를 엽니다.

```text
http://127.0.0.1:8768/
```

---

## 설치

### 권장 자동 설치

```text
Necessary Package Download.cmd
```

기본 패키지만 설치하고 싶은 고급 사용자는 명령 프롬프트에서
`Necessary Package Download.cmd -SkipMl`을 실행할 수 있습니다. FFmpeg 자동 설치도
건너뛰려면 `-SkipFfmpeg`를 함께 사용합니다.

수동 설치가 필요한 환경에서는 아래 명령을 사용합니다.

### 기본 패키지

```powershell
pip install -r requirements.txt
```

### Demucs 포함 패키지

```powershell
pip install -r requirements-ml.txt
```

### NVIDIA GPU가 없는 PC의 Demucs 패키지

```powershell
pip install -r requirements-ml-cpu.txt
```

### JavaScript 테스트 환경

```powershell
npm install
npm test
```

PowerShell 실행 정책 때문에 `npm` 명령이 차단되는 경우에는 다음과 같이 `npm.cmd`를 사용합니다.

```powershell
npm.cmd install
npm.cmd run test:e2e
```

---

## 환경 점검과 회귀 테스트

환경 점검은 다음 명령으로 실행합니다.

```powershell
python tools/diagnose.py
```

전체 회귀 검증은 다음 명령으로 실행합니다.

```powershell
npm test
```

입력 채널은 mono와 stereo만 지원합니다. 3채널 이상의 입력을 임의로 다운믹스하지 않으며, 지원하지 않는 채널 레이아웃은 HTTP 422로 거부합니다.

---

## Demucs 설정

업로드된 오디오는 분석 API에서 기본적으로 Demucs 분리를 요청합니다.

기본 모델은 `htdemucs_ft`입니다. 필요할 경우 실행 전에 다음 환경 변수로 `htdemucs`를 선택할 수 있습니다.

```powershell
$env:SPATIAL_SEPARATOR_MODEL = "htdemucs"
```

허용 목록에 없는 값을 지정하면 안전하게 기본 모델인 `htdemucs_ft`로 돌아갑니다.

Demucs 공식 저장소는 현재 archived 상태이므로, 프로젝트에서는 Demucs를 교체 가능한 provider 경계로 취급합니다. 현재 provider 상태는 `/api/health`에서 확인할 수 있습니다.

기본 분석 프로필은 다음과 같습니다.

```powershell
$env:SPATIAL_DEMUCS_SHIFTS = "2"  # 품질 보존 기본값
$env:SPATIAL_DEMUCS_OVERLAP = "0.36"
$env:SPATIAL_DEMUCS_SEGMENT = "7"
$env:SPATIAL_DEMUCS_JOBS = "1"
```

기본값은 다음과 같습니다.

* Model: `htdemucs_ft`
* Shifts: `2`
* Overlap: `0.36`
* Segment: `7초`
* Jobs: `1`

`shifts`와 `jobs` 값을 높이면 분리 품질이 좋아질 가능성이 있지만, 처리 시간과 메모리 사용량도 함께 증가합니다.

실시간 UI 성능과 오디오 렌더링 품질은 서로 독립적으로 관리됩니다.

---

## 현재 재생 구조

### Demucs stem 생성

Demucs 분석이 성공하면 `spatial-q3-adaptive6` 품질 프로파일로 다음 Stem을 생성합니다. `htdemucs_ft` 결과를 핵심 품질 기준으로 사용하고, `htdemucs_6s`의 기타·피아노 후보는 투영 적합도, 핵심 Stem 누출, 에너지 비율과 후보 간 중복 검사를 통과한 경우에만 독립 Stem으로 승격합니다.

* vocals
* guitar (품질 통과 시)
* piano (품질 통과 시)
* other
* drums
* bass

분리 과정에는 shift averaging, overlap 처리, soft-mask cleanup이 적용됩니다. 생성된 stem은 브라우저에서 디코딩한 뒤 Full Spatial 그래프에 사용됩니다.

---

### Original 모드

`Original`은 strict unity-gain 원본 경로입니다.

다음 처리를 모두 우회합니다.

* 재생 기기 EQ
* Preamp
* HRTF
* Room layer
* Peak guard
* 공간 반사
* 외재화 처리

재생 기기 보정은 Full Spatial에만 적용됩니다.

---

### Full Spatial 모드

Full Spatial은 원본 Dry 버퍼를 출력에 직접 연결하지 않습니다. 원본 버퍼는 residual 계산과 합산점에만 사용됩니다.

재생 전에 다음 절차를 수행합니다.

1. 원본과 stem 합 사이의 공통 sample lag를 ±128 sample 범위에서 추정합니다.
2. 추정된 지연을 보정합니다.
3. Decimated least-squares 검사로 stem 합의 gain을 맞춥니다.
4. Gain은 0.72~1.18 범위로 제한합니다.
5. 원본과 반대 극성의 보정된 stem 합을 이용해 residual을 계산합니다.
6. 계산된 residual을 stem과 함께 렌더링합니다.

신뢰할 수 있는 정렬을 찾지 못하면 원본의 L/R sample phase를 그대로 유지하는 fallback 경로로 전환합니다.

각 stereo stem은 mono로 합치거나 강제로 pan하지 않습니다. 입력의 L/R sample을 그대로 전달하며, primary path의 지연은 0ms입니다.

공간 깊이와 외재화는 직접음에 지연을 추가하는 대신 좌우 대칭 반사와 측정 기반 late field를 통해 만듭니다.

---

## 공간 렌더링 구조

### 외재화 셸

전면, 측면, 후면, 상부 방향으로 구성된 측정 HRTF 셸을 사용합니다.

연주자 외재화 셸은 청취자 앞 7.2~11.8m 스테이지에 놓이며, 공간 반사는 20×20×20m 공연장의 벽·모서리·천장 좌표에 배치됩니다.

각 방향에는 다음 처리가 적용됩니다.

* 거리와 음속을 반영한 최소 전파 지연
* Inverse-distance 감쇠
* 거리에 따른 고역 감쇠
* 방향별 측정 HRTF
* 좌우 대칭 방향쌍

이를 통해 음상이 머리 내부가 아니라 귀 바깥의 근거리 공간에 형성되도록 유도합니다.

두 번째 카드의 다음 값은 곡 분석 결과를 기준으로 자동 설정됩니다.

* Wet layer
* Stage radius
* Reflections

---

### Late-field BRIR

실제 Aula Carolina의 3m 정면 BRIR에서 45ms 이후 구간을 추출해 후기 공간 레이어로 사용합니다.

원본 측정 응답의 길이는 약 9.987초이지만, 실시간 convolution 부하를 줄이기 위해 에너지를 정규화한 2.8초 길이의 mono-to-binaural late field로 변환합니다.

자동 거리 프로파일은 `near`, `mid`, `far`에 따라 다음 요소를 함께 조정합니다.

* Pre-delay
* High-pass cutoff: 220~250Hz
* Low-pass cutoff: 9.6~11.5kHz
* Late-field energy

---

### Lateral 확장

원본 side 성분은 220Hz 이상에서 사용합니다.

스테레오 폭이 좁은 믹스에서는 mid 신호로부터 추가 side 성분을 만들되, 700Hz~12kHz 범위에서만 확장합니다.

고정된 단일 delay는 사용하지 않습니다. 대신 3.2~19.5ms 범위의 sparse velvet FIR을 사용합니다.

두 채널에 적용되는 lateral 출력은 정확히 반대 극성으로 구성되어 mono 합산 시 오차가 0이 되도록 설계했습니다.

Primary path에는 L/R 직접음 객체를 유지하고, 여기에 mono-null lateral field를 더합니다. 이를 통해 중앙 음상을 흐트러뜨리지 않으면서 무대 폭을 확장합니다.

---

### 방향성 반사

다음 위치를 모사하는 HRTF 반사를 추가합니다.

* 전면 벽
* 측벽
* 천장
* 후면 벽과 상부 모서리

기본 반사 지연은 29.2~50.5ms 범위이며, 좌우 대칭 방향쌍으로 구성됩니다. 선택된 거리 프로필에 따라 전파 지연만 제한적으로 늘어납니다.

이 반사들은 직접음을 대체하지 않고, 오케스트라 홀과 같은 폭, 높이, 후면 에너지, 잔향 연결감을 만드는 보조 공간 버스로 동작합니다.

### 후기 포위감

초기 측면 반사는 직접음 도착 후 80ms 이내에서 apparent source width를 만들고, 별도의 late-envelopment 레이어는 80ms 이후에만 동작합니다. 후기 레이어는 측면·후면·상부 방향쌍과 46ms 희소 확산 FIR을 사용하며 240Hz~9.2kHz로 제한합니다. 측정 BRIR 후기장과 합산되지만 송출량은 낮게 유지해 개별 반사가 에코로 들리거나 보컬이 뒤로 밀리지 않게 합니다.

---

### 공간 버스 보정

공간 버스에만 최대 ±1.2dB 범위의 저차수 응답 정규화를 적용합니다.

주요 목적은 다음과 같습니다.

* 165~340Hz 누적 에너지 완화
* 4.2kHz 부근의 과도한 손실 보정

이 EQ는 직접음과 Original에는 적용되지 않습니다.

공간 반사, lateral field, venue bus의 동작 대역은 110Hz~14.5kHz로 제한합니다. Bass를 포함한 primary path의 기존 inter-channel phase는 그대로 보존됩니다.

---

## Fallback 정책

다음 조건 중 하나라도 발생하면 일반적인 stem 기반 경로 대신 원본 L/R phase를 유지하는 `dry-free full-mix fallback`을 사용합니다.

* 네 개 stem 중 하나라도 누락된 경우
* 원본과 stem 길이 차이가 120ms 이상인 경우
* Sample alignment 신뢰도가 낮은 경우
* Stem 합산 결과가 신뢰 범위를 벗어난 경우

Fallback에서도 원본 Dry를 별도 병렬 경로로 출력하지 않습니다. 원본 스테레오 위상을 보존한 full-mix primary path 위에 공간 레이어를 구성합니다.

최종 출력단에는 다음 처리만 둡니다.

* BS.1770 integrated loudness 측정
* 8× true-peak 측정
* 처리 후 출력 preflight headroom trim
* 단일 peak guard

---

## Original과 Full Spatial 전환

Original과 Full Spatial을 전환할 때는 즉시 그래프를 교체하지 않습니다.

새 그래프를 가까운 미래 시점에 예약해 기존 그래프와 sample position을 맞춘 다음, linear constant-sum crossfade를 적용합니다.

이 방식은 전환 시 발생할 수 있는 위치 점프, 클릭 노이즈, 순간적인 에너지 손실을 줄입니다.

---

## 출력 기기 보정

Full Spatial에서는 출력 기기별 보정 프로파일을 사용할 수 있습니다.

현재 기본 프로파일은 다음 기기를 대상으로 합니다.

* AirPods Pro 3
* Sennheiser IE 600
* Edifier MR4

각 프로파일은 측정 자료를 기반으로 bounded-DF 또는 anechoic PEQ를 적용하며, 기기 특성에 맞는 렌더러 정책도 함께 선택합니다.

기기 보정의 근거, 적용 범위, 측정 오차와 한계는 `DEVICE_CORRECTION.md`에 정리되어 있습니다.

Original은 기기 보정을 포함한 모든 처리를 우회합니다.

---

## Loudness 및 peak 관리

서버는 BS.1770 K-weighting의 절대·상대 게이팅을 이용해 integrated LUFS를 측정합니다.

True peak는 8× windowed-sinc 보간으로 inter-sample peak를 추정합니다.

브라우저는 곡에서 에너지가 가장 강한 동일 구간을 사용해 Original과 각 기기 프리셋의 level-match gain을 계산합니다.

예상 peak가 peak guard의 비선형 동작 구간에 들어가는 곡만 두 번째 렌더를 수행합니다. 이후 guard를 통과한 결과의 남은 오차까지 계산해 Original RMS와 다시 맞춥니다.

---

## 실시간 성능 관리

### 오디오 처리

`ScriptProcessorNode`는 사용하지 않습니다.

오디오 그래프는 Web Audio 렌더 스레드에서 실행되며, 실시간 감시와 분석에는 다음 구성을 사용합니다.

* Live analyser: 2048 FFT
* Stem meter: 512 FFT
* 실시간 상관도·transient 감시: AudioWorklet

Full Spatial primary path에는 다음 노드가 없습니다.

* DelayNode
* HRTF convolution
* Channel split/merge

직접음 경로를 단순하게 유지하고, HRTF와 convolution은 공간 반사 및 venue bus에만 사용합니다.

---

### UI 갱신

다음 UI 요소는 최대 30fps로 제한합니다.

* Stem bar
* Spatial field
* Spectrum
* Waveform

브라우저 탭이 숨겨지면 시각화 갱신률은 8fps 이하로 낮아지지만 오디오 재생은 계속됩니다.

파형과 스펙트럼은 Canvas로 렌더링합니다. Stem bar와 field DOM은 값 변화가 정해진 임계값을 넘을 때만 `style`, `class`, `text`를 갱신합니다.

Canvas backing store의 device pixel ratio는 최대 2로 제한합니다. 이를 통해 4K 또는 고배율 디스플레이에서 GPU 메모리 사용량과 fill-rate가 과도하게 증가하는 것을 방지합니다.

---

### Stem meter 표시

Stem 반응 바는 RMS와 peak 입력에 -10dB 오프셋을 적용한 뒤 0~100% 선형 범위로 표시합니다.

이전 버전에서 사용하던 다음 방식은 제거했습니다.

* 80~90% 부근 표시 압축
* 극단적인 peak에서만 100%에 도달하는 제한

현재는 실제 입력이 디지털 최대치에 가까워질수록 자연스럽게 100%까지 반응합니다.

---

### 자동 품질 전환

초기 DSP 품질은 CPU와 메모리 정보를 참고해 다음 중 하나로 선택합니다.

* Full
* Balanced
* Safe

지원되는 브라우저에서는 재생 중 다음 지표를 지속적으로 관찰합니다.

* `averageLoad`
* `peakLoad`
* `underrunRatio`

부하가 변하면 재생 위치를 유지한 상태에서 품질 단계를 자동으로 전환합니다. 모든 품질 단계에서 좌우 대칭 방향쌍은 유지됩니다.

---

## 자동 검증

자동 테스트에서는 다음 항목을 확인합니다.

* 출력 값이 모두 유한한지
* Peak가 0dBFS 미만인지
* Stereo correlation guard를 통과하는지
* Residual이 올바르게 상쇄되는지
* 직접음 primary path가 0ms인지
* Mono 합산 시 lateral field 오차가 없는지
* Retired graph가 남지 않는지

재생 그래프를 dispose할 때는 관련 객체를 모두 정리합니다.

* Source
* LFO
* Analyser
* Convolver
* Gain node

각 노드에는 필요한 `stop()`과 `disconnect()`를 호출해 이전 그래프가 오디오 엔진에 남지 않도록 합니다.

---

## 서버와 분석 작업 관리

### 스트리밍 업로드

업로드 파일은 `request.stream()`을 통해 임시 파일에 순차 기록합니다.

최대 업로드 크기는 420MB이며, 요청 본문을 모두 받은 뒤가 아니라 스트리밍 도중에도 크기를 검사합니다.

따라서 업로드 전체를 Python 메모리에 복제하지 않습니다.

---

### 분석 동시성

Demucs와 NMF 분석 슬롯은 기본적으로 한 개입니다.

두 번째 분석 요청은 대기열에 들어가며, CUDA 메모리와 시스템 RAM이 여러 작업으로 중첩되지 않도록 합니다.

필요한 경우 다음 환경 변수로 동시성을 2까지 높일 수 있습니다.

```powershell
$env:SPATIAL_ANALYSIS_CONCURRENCY = "2"
```

GPU 메모리와 시스템 RAM이 충분하지 않은 환경에서는 기본값 1을 유지하는 것이 안전합니다.

---

### 작업 취소

사용자가 분석을 초기화하거나 새 파일로 교체해 기존 연결이 종료되면 취소 신호를 다음 단계까지 전달합니다.

* 분석 스레드
* Demucs subprocess
* 캐시 저장 단계

중단된 분석에서 생성된 불완전한 cache stem은 삭제합니다.

---

### 분석 캐시

성공한 적응형 4~6 Stem 분석은 다음 값을 조합한 키로 캐시합니다.

* 입력 콘텐츠 해시
* 분석 프로필
* 분리 모델 및 관련 설정

캐시는 최대 256개 또는 30일 동안 유지됩니다.

업로드한 원본 파일은 분석 완료 직후 삭제하며, 캐시에는 stem과 JSON 분석 결과만 남깁니다.

---

### 오류 처리와 관찰성

모든 응답에는 요청 ID와 `Server-Timing` 정보를 포함합니다.

사용자 화면에는 다음 정보를 직접 노출하지 않습니다.

* 내부 파일 경로
* Python traceback
* Subprocess 원문 오류
* 서버 내부 구현 정보

대신 요청 ID가 포함된 안전한 오류 메시지를 표시합니다. 개발자는 해당 요청 ID를 기준으로 서버 로그를 추적할 수 있습니다.

---

## 보안

앱은 기본적으로 `127.0.0.1`에서만 실행됩니다.

다음 보안 정책을 적용합니다.

* Content Security Policy
* `nosniff`
* Frame 차단
* Local-origin CORS
* Trusted Host 검사
* 업로드 크기 제한
* 지원 채널 수 검증
* 내부 경로 및 subprocess 오류 은닉

---

## 접근성

다음 접근성 기능을 포함합니다.

* 분석 단계와 경과 시간 안내
* 키보드 포커스 표시
* Skip link
* 상태 변경 live region
* `prefers-reduced-motion` 대응
* Forced Colors 모드 대응
* 키보드 중심 UI 조작

---

## 설계 원칙

Spatial Audio Essential의 Full Spatial 경로는 다음 원칙을 따릅니다.

1. 원본 Dry 신호를 별도 병렬 경로로 출력하지 않습니다.
2. Stereo stem의 L/R sample phase를 가능한 한 그대로 보존합니다.
3. 직접음 primary path에 인위적인 지연을 추가하지 않습니다.
4. 외재화는 측정 HRTF, 방향성 반사, lateral field, late-field BRIR로 구성합니다.
5. 분리에서 누락된 성분은 mixture residual로 보존합니다.
6. 신뢰할 수 없는 stem 정렬이나 합산 결과는 fallback으로 안전하게 처리합니다.
7. Original은 모든 처리와 보정을 우회하는 strict unity-gain 비교 경로로 유지합니다.
8. 실시간 품질 전환 중에도 좌우 대칭성과 재생 위치를 유지합니다.
9. 최종 출력은 loudness와 true peak를 재측정한 뒤 필요한 경우에만 감쇠합니다.

---

## 설계 및 연구 근거

프로젝트에 적용한 기술과 제외한 기술, 각 방식의 선택 이유는 `SPATIAL_AUDIO_RESEARCH.md`에 정리되어 있습니다.

주요 참고 자료는 다음과 같습니다.

* W3C Web Audio API
* ITU-R BS.1770-5
* FastAPI lifespan
* Starlette request streaming
* Demucs 공식 저장소
* RWTH Aachen AIR Database
* SADIE II Database v2.2
* Armstrong et al.의 SADIE II 비개인·개인 HRTF 지각 평가
* W3C WCAG 2.2 이해 문서

---

## 요약

Spatial Audio Essential은 단순한 stereo widening이나 reverb 추가 도구가 아닙니다.

Demucs stem의 기존 스테레오 위상을 보존하고, mixture residual을 유지하면서, 측정 HRTF와 BRIR을 이용해 직접음 바깥에 방향성 반사와 후기 공간을 구성합니다.

실시간 재생에서는 DSP 부하와 안정성을 관리하고, 오프라인 렌더에서는 BS.1770-5 loudness와 8× true peak를 다시 측정합니다. 또한 Original과 Full Spatial을 동일 조건에서 비교할 수 있도록 level matching과 주관 평가 도구를 제공합니다.

개인 HRTF가 없는 환경에서도 여러 실측 더미헤드와 사람 프로파일 중 자연스러운 응답을 선택할 수 있지만, 비개인 HRTF의 한계를 숨기거나 모든 사용자에게 동일한 외재화를 보장하지는 않습니다.
