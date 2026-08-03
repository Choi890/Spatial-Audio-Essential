# Spatial Audio Essential

## 실측 다중 BRIR + 합성 FIR 실시간 렌더러 (v1.11)

v1.11은 AIR v1.4의 서로 다른 네 실측 공간(Meeting Room, Lecture Room,
Stairway, Aula Carolina)을 사용합니다. Full Spatial QA는 음악 구간이 아니라
렌더러에 통과시킨 stereo impulse response에서 IACC80, C50/C80, DRR, EDT,
T20을 계산합니다. 실시간 상관도·트랜지언트 감시는 AudioWorklet에서 수행하고,
장시간 곡의 room-send automation은 rolling window로 예약합니다. HQ 렌더는
8 MB 단위 IndexedDB chunk로 저장되며 설정이 같으면 다음 세션에서도 재사용됩니다.
방향별 HRTF 경로는 동일한 선형 응답의 합성 FIR로 통합해 실시간 부하를 줄였고,
3~4 m 외부화 링과 후면·천장 반사 에너지 재분배로 사방 공간감을 확장했습니다.

기본 렌더러는 Apache-2.0으로 공개된 **SADIE II 측정 HRIR**입니다. KEMAR와 KU100 더미헤드, Human 003/009를 UI에서 바꿔 들을 수 있으며, 개인 측정 없이도 청감상 가장 자연스러운 프로파일을 선택할 수 있습니다. 이 선택은 개인화의 대체물이 아니므로 모든 청취자에게 같은 앞뒤·상하 외재화를 보장하지 않습니다.

- `data/hrtf/profiles.json`: SADIE II 네 프로파일과 결정론적 범용 폴백의 런타임 레지스트리
- `data/hrtf/sadie-*.hrir`: 48kHz, 2수신기, 256-tap 측정 HRIR의 무손실 Float32 런타임 표현
- `data/hrtf/universal-listener-v1.*`: 측정 자산을 읽지 못할 때 사용하는 144방향 대칭 폴백
- 브라우저는 구면 각거리 기준 최근접 방향을 고르고, 각 귀의 onset을 분리한 뒤 시간 정렬 보간합니다. 44.1/48/96kHz AudioContext에 맞춰 HRIR을 선형 리샘플링하므로 Convolver sample-rate 불일치가 없습니다.
- `tools/build_measured_hrtf_library.py`가 Zenodo 원본의 MD5를 검증하고 좌표계·레벨을 결정론적으로 변환합니다. 출처와 라이선스는 `data/hrtf/SADIE_II_NOTICE.txt`에 기록됩니다.
- 모든 HRTF/BRIR 자산은 `data/assets-manifest.json`의 크기와 SHA-256으로 서버 상태에서 검증됩니다.

Full Spatial 분석 완료 후 `24-bit WAV` 버튼을 누르면 전체 곡과 잔향 꼬리를 오프라인 렌더링합니다. 서버가 렌더 결과를 ITU-R BS.1770-5 gated LUFS와 8× true peak로 재측정하고, 필요할 때만 최종 출력을 -1 dBTP 이하로 감쇠합니다. `/mushra`에는 Original과 Full Spatial을 무작위 순서로 비교하는 주관 평가 보조 도구가 있습니다.

환경 점검은 `python tools/diagnose.py`, 전체 회귀 검증은 `npm test`로 실행합니다. 입력 채널 정책은 mono/stereo이며, 그 이상의 채널 레이아웃은 잘못 다운믹스하지 않고 422로 거부합니다. Demucs는 현재 공식 저장소가 보관(archived) 상태이므로 공급자 상태를 `/api/health`에 노출하고 교체 가능한 경계로 취급합니다.

분리 모델은 기본 `htdemucs_ft`이며 필요하면 실행 전에 `$env:SPATIAL_SEPARATOR_MODEL = "htdemucs"`로 바꿀 수 있습니다. 허용 목록 밖의 값은 안전하게 기본 모델로 돌아갑니다.

Demucs stem을 binaural 직접음 객체로 다시 렌더하고, 분리에서 빠진 성분은 mixture residual로 보존하는 공간음향 스튜디오입니다.

`Full Spatial`은 원본 Dry를 출력에 직결하지 않습니다. `vocals`, `drums`, `bass`, `other`의 원래 L/R sample phase를 지연 없는 primary path에 보존하고 `원본 − 보정된 stem 합` residual도 같은 방식으로 합칩니다. 측정 HRTF는 방향쌍 반사, 3~4m 외재화 셸과 후기 공간에 사용합니다. 비교용으로 완전 무처리 `Original`만 남깁니다.

## 핵심 구조

- `backend/audio_engine.py`: 오디오 메타데이터, 스펙트럼, stereo image, Demucs stem 분석
- `app.py`: FastAPI 서버, 오디오 업로드 API, 정적 프론트엔드와 `/outputs` stem·`/brir` 측정 응답 제공
- `static/app.js`: Full Spatial/Original 그래프, stem 직접음, mixture residual, 3~4m 외재화 셸, 측정 BRIR renderer, stem analyser UI
- `static/js/config.js`: stem 표시 정보와 실시간 악기 시그니처
- `static/js/device-profiles.js`: AirPods Pro 3, IE 600, MR4의 측정 기반 bounded-DF/anechoic PEQ와 출력 기기별 렌더러 정책. 근거와 한계는 [`DEVICE_CORRECTION.md`](DEVICE_CORRECTION.md)에 정리했습니다.
- `static/js/runtime-quality.js`: Web Audio render-capacity 기반 Full/Balanced/Safe 자동 품질 제어
- `static/js/utils.js`: API 경로, 포맷, DOM 업데이트 유틸
- `static/styles.css`: 라이트/다크 테마와 대시보드 UI

## 실행

프로젝트 루트의 `Spatial Audio Essential 실행.cmd`를 더블클릭하면 Python 분석 서버가 시작되고 브라우저가 자동으로 열립니다.

수동으로 실행하려면:

```powershell
cd "D:\Code\Codex\Spatial Audio Essential"
python -m uvicorn app:app --host 127.0.0.1 --port 8768
```

브라우저에서 `http://127.0.0.1:8768/`을 열면 됩니다.

## 설치

기본 패키지:

```powershell
pip install -r requirements.txt
```

Demucs 포함 패키지:

```powershell
pip install -r requirements-ml.txt
```

개발 검증용 JavaScript 테스트:

```powershell
npm install
npm test
```

PowerShell 실행 정책 때문에 `npm`이 막힌 환경에서는 `npm.cmd install`, `npm.cmd run test:e2e`를 사용하면 됩니다.

## 현재 재생 방식

1. 업로드한 오디오는 분석 API에서 Demucs 분리를 기본 요청합니다.
2. Demucs가 성공하면 `spatial-q2` 품질 프로파일로 `vocals`, `other`, `drums`, `bass` stem을 생성하고, shift averaging/overlap/soft-mask cleanup 결과를 브라우저가 디코딩합니다.
3. `Original`은 기기 EQ, preamp, HRTF, room layer, peak guard를 모두 우회하는 strict unity-gain 원본 경로입니다. 재생 기기 보정은 `Full Spatial`에만 적용됩니다.
4. `Full Spatial`은 원본 버퍼를 residual 합산점에만 연결합니다. 재생 전 공통 sample lag를 ±128 sample 안에서 추정·보정하고, decimated least-squares 검사로 stem 합의 gain을 0.72~1.18 범위에서 맞춘 뒤 반대 극성 stem 합으로 residual을 만들어 함께 렌더합니다. 신뢰할 수 있는 정렬을 찾지 못하면 원본 위상 보존 fallback으로 전환합니다.
5. 각 stereo stem은 mono로 접거나 강제 pan하지 않고 L/R sample을 그대로 전달합니다. Primary path는 0ms이며 공간 깊이는 좌우 대칭 반사와 측정 late field로 추가합니다.
6. 2.4~3m 반경의 전면·측면·후면·상부 측정 HRTF 셸은 거리/음속에 따른 최소 전파 지연, inverse-distance 감쇠와 거리별 고역 감쇠를 적용해 귀 바깥의 근거리 공간 음상을 만듭니다.
7. 두 번째 카드의 `Wet layer`, `Stage radius`, `Reflections` 값은 곡 분석 결과에 따라 자동 설정됩니다.
8. 네 stem 중 하나라도 없거나 원본과 길이가 120ms 이상 어긋나거나 sample 정렬 신뢰도가 낮으면 원본 L/R sample phase를 그대로 유지하는 dry-free full-mix fallback을 사용합니다. 최종 출력에는 BS.1770 통합 loudness, 8× true-peak, 처리 후 출력 preflight headroom trim과 peak guard 하나만 둡니다.
9. 실제 Aula Carolina 3m 정면 BRIR의 45ms 이후 측정 응답을 2.8초 mono-to-binaural 후기 공간 레이어로 사용합니다. 자동 거리 프로파일은 near/mid/far에 따라 pre-delay, 220~250Hz high-pass, 9.6~11.5kHz low-pass와 에너지를 함께 바꿉니다.
10. 원본 side는 220Hz 이상, 좁은 믹스의 mid-derived side는 700Hz~12kHz에서만 확장합니다. 고정 단일 지연 대신 3.2~19.5ms sparse velvet FIR을 사용하며 두 출력은 정확히 반대 극성이어서 mono 합산 오차가 0입니다.
11. 공간 버스에만 최대 ±1.2dB의 저차수 응답 정규화를 적용해 165~340Hz의 누적과 4.2kHz의 과도한 손실을 보정합니다. 직접음과 Original에는 이 EQ가 들어가지 않습니다.
12. 9.5~38ms의 방향쌍 무대 가장자리·측벽·발코니·천장·후면 갤러리 HRTF 반사를 추가해 오케스트라 홀의 폭과 잔향을 만듭니다.

Full Spatial과 Original 전환은 새 그래프를 미래 시점에 예약 시작해 기존 그래프와 샘플 위치를 맞춘 뒤 linear constant-sum 크로스페이드를 사용합니다.

## 재생 중 성능 관리

- `ScriptProcessorNode`는 사용하지 않습니다. 실시간 분석은 `AnalyserNode` 기반이며, live analyser는 2048 FFT, stem meter는 512 FFT로 제한합니다.
- 오디오 그래프는 Web Audio 렌더 스레드에서 동작하고, stem bar·필드·스펙트럼·파형 UI는 최대 30fps로 제한합니다. 탭이 숨겨지면 시각화는 8fps 이하로 낮아지며 오디오 재생은 계속됩니다.
- 파형과 스펙트럼은 Canvas 기반으로 그리고, stem bar와 field DOM은 값 변화가 임계값을 넘을 때만 style/class/text를 갱신합니다.
- Canvas backing store의 device pixel ratio는 최대 2로 제한해 4K/고배율 화면에서 GPU 메모리와 fill-rate가 급증하지 않게 합니다.
- Stem 반응 바는 RMS/peak 입력에 `-10 dB` 오프셋을 적용한 뒤 0~100% 선형 범위로 표시합니다. 이전의 80~90% 부근 표시 압축과 극단 피크 전용 100% 제한은 사용하지 않으며, 실제 입력이 디지털 최대치에 가까워질수록 자연스럽게 100%까지 반응합니다.
- Full Spatial primary path에는 DelayNode, HRTF, channel split/merge가 없습니다. 공간 반사·lateral·venue bus만 110Hz~14.5kHz로 제한하며 bass를 포함한 원래 inter-channel phase를 그대로 보존합니다.
- L/R primary object와 mono-null lateral field를 함께 사용해 중앙 음상을 분해하지 않으면서 폭을 확보합니다. 자동 테스트는 유한 출력, 0dBFS 미만 peak, stereo correlation guard, residual 상쇄와 직접음 0ms를 검사합니다.
- 측정 BRIR 파일은 약 525KB이며 한 번만 디코딩해 재사용합니다. 원본 9.987초 응답은 2.8초의 에너지 정규화된 late field로 빌드해 실시간 convolution 비용을 제한합니다.
- CPU·메모리 힌트로 Full/Balanced/Safe 초기 DSP 품질을 선택하고, 지원 브라우저에서는 실제 `averageLoad`, `peakLoad`, `underrunRatio`를 지속 관찰해 재생 위치를 유지한 채 자동 전환합니다. 모든 단계에서 좌우 대칭 pair는 유지합니다.
- 분석 서버는 BS.1770 K-weighting 절대/상대 게이팅으로 LUFS-I를 측정하고 8× windowed-sinc 보간으로 inter-sample true peak를 추정합니다.
- 브라우저는 곡의 가장 강한 동일 구간을 Original과 각 기기 프리셋으로 비교해 level-match gain을 구합니다. 예상 피크가 peak guard의 비선형 구간에 닿는 곡만 2차 렌더하여 guard 이후 남은 오차까지 제거하고 Original RMS에 맞춥니다.
- 재생 그래프 dispose 시 source, LFO, analyser, convolver, gain node를 모두 stop/disconnect해 retired graph가 남지 않도록 정리합니다.

## 운영 안정성

- 업로드는 `request.stream()`으로 임시 파일에 순차 기록하며 420MB 상한을 스트림 도중에도 검사합니다. 요청 전체를 Python 메모리에 복제하지 않습니다.
- Demucs/NMF 분석 슬롯은 기본 1개입니다. 두 번째 요청은 대기열에 들어가므로 CUDA 메모리와 RAM 사용이 중첩되지 않습니다. 필요할 때만 `SPATIAL_ANALYSIS_CONCURRENCY=2`로 올릴 수 있습니다.
- 사용자가 분석을 초기화하거나 새 파일로 교체해 연결이 종료되면 취소 신호가 분석 스레드와 Demucs subprocess까지 전달됩니다. 중단된 cache stem은 삭제합니다.
- 성공한 4-stem 분석은 콘텐츠 해시와 분석 프로필을 키로 최대 256개/30일 캐시합니다. 업로드 원본은 분석 직후 삭제하고 stem과 JSON 결과만 남깁니다.
- 각 응답에 요청 ID와 Server-Timing을 넣고, 사용자 화면에는 내부 경로나 subprocess 오류 원문 대신 요청 ID가 포함된 안전한 오류만 표시합니다.
- CSP, `nosniff`, frame 차단, 로컬 origin CORS, Trusted Host 검사를 적용합니다. 앱은 `127.0.0.1` 전용으로 실행됩니다.
- 분석 단계·경과 시간, 키보드 포커스, skip link, 상태 live region, reduced-motion 및 forced-colors 대응을 포함합니다.

## 품질 설정

기본 Demucs 프로필은 `htdemucs_ft`, shifts 2, overlap 0.36, segment 7초, jobs 1입니다.

```powershell
$env:SPATIAL_DEMUCS_SHIFTS = "2"
$env:SPATIAL_DEMUCS_OVERLAP = "0.36"
$env:SPATIAL_DEMUCS_SEGMENT = "7"
$env:SPATIAL_DEMUCS_JOBS = "1"
```

`shifts`와 `jobs`를 높이면 처리 시간과 메모리 사용량이 늘어납니다. 실시간 UI의 속도와 오디오 렌더 품질은 서로 분리되어 있습니다.

## 설계 근거

- 프로젝트별 적용/제외 판단은 [`SPATIAL_AUDIO_RESEARCH.md`](SPATIAL_AUDIO_RESEARCH.md)에 정리했습니다.
- [W3C Web Audio API](https://www.w3.org/TR/webaudio-1.1/)
- [ITU-R BS.1770-5](https://www.itu.int/rec/R-REC-BS.1770-5-202311-I)
- [FastAPI lifespan](https://fastapi.tiangolo.com/advanced/events/)
- [Starlette request streaming](https://www.starlette.io/requests/)
- [Demucs 공식 저장소](https://github.com/facebookresearch/demucs)
- [RWTH Aachen AIR Database](https://www.iks.rwth-aachen.de/en/research/tools-downloads/databases/aachen-impulse-response-database/)
- [SADIE II Database v2.2](https://zenodo.org/records/12542676)
- [Armstrong et al., SADIE II 비개인/개인 HRTF 지각 평가](https://doi.org/10.3390/app8112029)
- [W3C WCAG 2.2 이해 문서](https://www.w3.org/WAI/WCAG22/understanding/)
