# Spatial Audio Essential 프로젝트 구조

## v1.7 추가 구성

- `data/hrtf/profiles.json`: 측정/범용 HRTF 선택 레지스트리
- `data/hrtf/sadie-kemar.*`, `sadie-ku100.*`: SADIE II 1550방향 더미헤드 HRIR
- `data/hrtf/sadie-human-003.*`, `sadie-human-009.*`: SADIE II 170방향 human-ear HRIR
- `data/hrtf/universal-listener-v1.sofa`: AES69/SOFA 2.1 범용 대칭 144방향 HRIR
- `data/hrtf/universal-listener-v1.hrir`: SOFA에서 생성한 브라우저용 Float32 런타임 HRIR
- `data/hrtf/universal-listener-v1.json`: 두상·cue·폴백 정책 프로파일
- `data/assets-manifest.json`: HRTF/BRIR 크기 및 SHA-256 무결성 목록
- `data/hrtf/SADIE_II_NOTICE.txt`: 측정 자산 출처, 좌표 변환, 라이선스 고지
- `tools/build_universal_hrtf.py`: 프로파일·SOFA·런타임 HRIR 결정론적 생성기
- `tools/build_measured_hrtf_library.py`: SADIE II 다운로드, MD5 검증, 런타임 변환기
- `tools/build_asset_manifest.py`: 모든 공간 자산의 크기·SHA-256 manifest 생성기
- `tools/diagnose.py`: Python/DSP/CUDA/Demucs/자산 설치 진단
- `static/mushra.html`: 블라인드 주관 청취평가 보조 화면
- `static/js/device-profiles.js`: AirPods Pro 3/IE 600 bounded DF와 MR4 anechoic PEQ, 기기별 렌더러 정책
- `DEVICE_CORRECTION.md`: 측정 출처·타깃·보정 범위·한계
- `.github/workflows/ci.yml`: Windows Python/Node/Playwright 회귀 검증

## 핵심 흐름

1. `app.py`가 오디오를 메모리 복제 없이 임시 파일로 스트리밍하고 콘텐츠 해시 캐시를 확인합니다.
2. 캐시가 없으면 단일 분석 슬롯에서 `backend/audio_engine.py`로 분석과 Demucs 분리를 요청합니다.
3. 브라우저는 원본 오디오와 `vocals`, `other`, `drums`, `bass` WAV stem을 디코딩하고 길이 정합성 및 ±128 sample 공통 lag를 확인합니다.
4. Full Spatial 모드는 검출한 sample lag와 원본/stem 합의 gain 정합을 적용하고 `원본 − stem 합` residual을 만듭니다.
5. Stem L/R과 residual은 지연·pan·HRTF 없는 phase-coherent primary bus로 출력하고, 반사와 측정 BRIR만 대역 제한 room bus로 출력합니다. 원본은 출력에 직결하지 않습니다.
6. Original은 기기 EQ와 preamp까지 모두 우회하는 strict unity-gain 비교 경로입니다. 재생 기기 프로파일은 Full Spatial에만 적용됩니다. stem이 없거나 정렬 신뢰도가 낮으면 Full Spatial은 원본 L/R sample phase를 보존하는 full-mix primary를 사용합니다.

## 주요 파일

| 경로 | 역할 |
|---|---|
| `app.py` | FastAPI 서버, 분석 API, 정적 UI와 stem·BRIR 파일 제공 |
| `backend/audio_engine.py` | 스펙트럼·악기·stereo image 분석과 Demucs 실행 |
| `static/index.html` | Spatial Audio Essential 화면 구조 |
| `static/app.js` | Web Audio 그래프, stem 객체 라우팅, 재생 및 UI |
| `static/js/config.js` | stem 프로필과 악기 시그니처 |
| `static/js/device-profiles.js` | 측정 기반 기기 PEQ, preamp, headphone/speaker renderer 정책 |
| `static/js/runtime-quality.js` | 실제 audio render 부하 기반 대칭 DSP 품질 자동 조절 |
| `static/js/utils.js` | DOM, 수치, API 경로 유틸리티 |
| `static/styles.css` | 반응형 UI와 테마 |
| `tests/spatial-ui.spec.js` | UI, 재생, stem routing 회귀 테스트 |
| `tests/test_audio_engine.py` | 백엔드 오디오 분석 테스트 |
| `tests/test_app.py` | 스트리밍 업로드, 크기 제한, 파일명·요청 ID 경계 테스트 |
| `SPATIAL_AUDIO_RESEARCH.md` | 원 논문·표준의 적용/제외 근거와 검증 규칙 |
| `data/brir/aula_carolina_front_3m_90deg_late.wav` | Aula Carolina 3m 정면 측정에서 만든 45ms–2.8s binaural late field |
| `tools/build_air_brir.py` | AIR MAT 원본 두 채널을 bounded stereo late-field WAV로 재현하는 빌드 도구 |
| `Spatial Audio Essential 실행.cmd` | Windows 원클릭 실행 |

## Full Spatial stem 배치

| Stem | 배치 | 보호 규칙 |
|---|---|---|
| `vocals` | 원본 stereo 위치 유지 | Full-band phase-coherent primary, 0ms |
| `drums` | 원본 stereo 위치 + 대칭 후방 반사 | Full-band phase-coherent primary, 0ms |
| `bass` | 원본 stereo 저역 위치 유지 | Full-band phase-coherent primary, 0ms |
| `other` | 원본 stereo 위치 + 대칭 전면 반사 | Full-band phase-coherent primary, 0ms |

Separation confidence는 직접음 레벨을 크게 흔들지 않도록 0.94~1.02로 제한하고 반사 send에 더 강하게 적용합니다. 전체 room field에는 110Hz high-pass와 14.5kHz low-pass를 적용합니다. 공간 버스만 165Hz low shelf, 340Hz bell, 4.2kHz presence 보정으로 최대 ±1.2dB 안에서 정규화하며 primary와 Original은 통과하지 않습니다.

Full Spatial의 primary path가 해당 stem의 원래 우세 음상을 담당합니다. Route의 anchor tap은 반사 목록에서 제외하고, 나머지 반사는 ±azimuth 대칭 pair로 만들어 특정 방향으로 전체 mix가 쏠리지 않게 합니다.

외재화 셸은 2.4~3m 반경에 전면 ±34°, 측면 ±88°, 후면 ±142°/±174°, 상부 ±58° 객체를 배치합니다. 각 HRTF 객체에 inverse-distance 감쇠, 거리/음속 기반 최소 지연, 거리별 low-pass를 적용해 원본 위치를 유지하면서 음상을 귀 바깥으로 끌어냅니다. Stem별 방향 집합을 사용하되 모든 tap은 좌우 대칭 pair입니다.

장치 성능 힌트로 Full/Balanced/Safe 초기 품질을 선택하고, Web Audio render capacity가 있으면 실제 평균/피크 부하와 underrun을 기준으로 자동 전환합니다. 낮은 단계는 대칭 pair 수와 room send만 줄입니다. 출력 pre-gain은 BS.1770 gated LUFS-I, 8× true-peak와 가장 강한 구간의 처리 후 오프라인 렌더 결과를 함께 사용합니다.

오케스트라 홀 레이어는 9.5ms 무대 가장자리, 17ms 측벽, 26ms 발코니, 31ms 천장, 38ms 후면 갤러리를 각각 좌우 대칭 HRTF pair로 렌더합니다. 직접음 위치는 유지하면서 폭·높이·후방 포위감을 형성합니다.

전면 stem의 anchor는 75° 안쪽·4m 이내·7ms 이하이며, 후면 stem의 anchor는 130° 바깥·9m 이상·17ms 이상입니다. 이 경계는 좌우 폭과 별도로 앞/뒤 깊이 차이를 보장합니다.

측정 공간 꼬리는 stem scene과 residual을 mono로 합산한 뒤 거리 프로파일별 220~250Hz high-pass, 9.6~11.5kHz low-pass와 0~12ms pre-delay를 거쳐 binaural BRIR에 convolution합니다. 45ms 이전 직접음은 제거되어 primary object와 중복되지 않습니다.

Lateral layer는 재구성 scene의 `(L-R)/2` side를 220Hz 이상, `(L+R)/2` mid를 700Hz~12kHz에서 추출해 3.2~19.5ms sparse velvet FIR로 decorrelation합니다. 좌우 FIR은 sample 단위로 정확히 반대 극성이므로 생성 side는 mono에서 상쇄되고 저역 primary는 영향을 받지 않습니다.
