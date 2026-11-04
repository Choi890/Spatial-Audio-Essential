# Binaural scene — 2026-10-18 적용 기록

## 현재 수정: v124-phase-stable-scene

사용자 청취에서 보컬·악기의 전후 이동과 위상 불안정이 보고되어 v123 직접음 구조를 대체했다. v123은 stem마다 다른 HRTF·공통 보정 필터를 적용했으므로 `H1(stem1) + H2(stem2) + Hr(residual)`이 `H(original)`과 달랐다. 분리 누설 비율이 시간에 따라 달라지면 원래의 상쇄가 깨져 음색·위상·전후감이 달라질 수 있다. 초기 톤·임펄스 검사는 이 문제를 검증하지 못했다.

현재는 정합 stem과 residual을 **동일 이득으로 먼저 합산한 뒤 하나의 고정 바이노럴 행렬로 한 번만 렌더**한다. 모든 직접음이 동일한 처리 연산자를 거치므로 선형 구간에서 `H(sum(stems) + residual) = H(original)`이 성립한다. 두 가상 스피커는 ±35°이며, 한 측정 HRIR과 그 귀별 미러를 사용한다. 따라서 mono center는 정확히 중앙에 유지된다. Stem별 직접음 방향 재배치는 하지 않고 입력의 stereo 배치를 공통 가상 무대로 렌더한다. 분석 필드의 카드는 여전히 녹음의 좌우 추정 표시다.

별도 1.2dB 보컬 lift를 없애고, 보컬 전면감은 약하고 고정된 공간 전송량으로 유지한다. Vocal reflection send는 기존의 18%, vocal perimeter send는 0.02로 제한한다. Field/hall/venue의 vocal 계수는 각각 0.2/0.16/0.12다. 악기의 초기 반사 send도 절반으로 제한했다. 과도음에 따라 공간 이득을 감쇠·복원하는 automation과 즉시 역극성 side 복제는 사용하지 않는다. 8방향 독립 후기장은 유지한다.

프로그램 기반 보정은 전체 원본을 기준으로 고정된 공통 필터를 준비하고 사용한다. Stem별 EQ를 따로 만들지 않는다. 직접음의 FIR도 공유해 중복 convolution을 줄였다. 렌더 캐시 버전은 v124로 변경했다.

새 회귀 검사는 같은 원음을 고정한 채 vocal/other 누설 비율을 시간에 따라 바꾼다. 별도 vocal lift를 중립으로 둔 v123에서는 직접음 상대 RMS 오차가 약 0.0544였고, v124는 기본 설정에서 1e-5 미만을 요구한다. 또 시간에 따라 harmonic 비율이 달라지는 mono 보컬의 L/R 오차, transient map 유무의 전체 출력 차이가 각각 1e-7 미만인지 확인한다. 기존 포위감·톤·전환·중지 검사도 유지한다. 이 검사는 구체적인 재현 조건이며 모든 음악의 청감을 대신하지 않는다.

이하의 자료 표는 설계 참고 문헌이며, v123의 개별 직접음 위치·1.2dB lift 관련 기술 설명은 이전 개발 기록이다. 현재 구현은 이 절을 따른다.

## 목표와 범위

`v123-binaural-envelopment`는 원음과 약한 공간음을 병렬로 더하던 직접음 경로를 대체한다. Stem과 residual의 두 입력 채널을 각각 가상 음원으로 렌더하고 측정 HRIR의 양쪽 귀 출력으로 합산한다. 보컬은 정면 중앙, 악기는 전체 곡의 스테레오 에너지로 추정한 방위에 고정한다. 이 추정은 실제 녹음 현장의 3D 위치를 복원한 결과가 아니다. 측면·후면·상부 후기장은 별도의 독립 방향 패턴으로 구성한다.

문헌 전체를 조사하거나 각 제품을 복제했다는 의미가 아니다. 기존 SADIE II/AIR 자산과 브라우저에서 적용할 수 있는 1차 자료를 검토했다. 영상은 공개 기술 영상의 대본·슬라이드로 검토했으며 청감 비교 실험을 대신하지 않는다.

## 검토한 근거와 구현의 연결

| 자료 | 확인한 내용 | 적용 또는 한계 |
|---|---|---|
| [Best et al., 2020 — Sound Externalization](https://journals.sagepub.com/doi/10.1177/2331216520948390) | 외재화는 직접음·반사장의 양이간/스펙트럼 단서와 청취 맥락에 의존한다. 개인차가 있으며 지각적 평가가 필요하다. | 직접음을 측정 HRTF로 전환했다. 출력의 `1 − IACC`를 청감 점수로 표현하지 않는다. |
| [Soulodre & Bradley, 1994](https://jcaa.caa-aca.ca/index.php/jcaa/article/view/845) | 초기 측면 반사로 넓어진 음상과 청취자를 감싸는 후기 에너지는 구분된다. | 초기장과 별도로 87ms 이후 측면·후면·상부 후기장을 구성하고 에너지·IACC를 검사한다. |
| [Microsoft Research — Spatial Audio](https://www.microsoft.com/en-us/research/project/spatial-audio/) | HRTF는 방위·고도에 따른 시간·주파수 단서를 표현한다. 머리 움직임과 장면이 맞지 않으면 착각이 깨질 수 있다. | 좌우 채널별 측정 HRIR을 적용한다. 센서 없는 고정 청취자이며 head tracking을 구현했다고 주장하지 않는다. |
| [Gamper et al. — Spatial Audio research at Microsoft, 슬라이드](https://www.microsoft.com/en-us/research/wp-content/uploads/2016/07/Gamper_Hannes_Audio_for_AR_VR_at_MS.pdf) | 공간 엔진은 직접음 방향 단서, 방 응답, 동적 청취 단서를 함께 다룬다. | 직접음·초기장·후기장을 나누되, 동적 방향 입력은 자동으로 만들어내지 않는다. |
| [Apple WWDC24 — RealityKit audio 영상·대본](https://developer.apple.com/videos/play/wwdc2024/111801/) | 공간 음원, 방향성·거리, 잔향과 ambient music을 서로 다른 역할로 다룬다. 공간화 시 mono 합산의 아티팩트도 주의한다. | Stereo stem을 한 mono로 축소하지 않고 L/R을 각각 바이노럴 렌더한다. Apple의 6DoF 기능을 브라우저에서 재현한 것은 아니다. |
| [Aalto — Late-Reverberation Synthesis using Interleaved Velvet-Noise Sequences](https://research.aalto.fi/en/publications/late-reverberation-synthesis-using-interleaved-velvet-noise-seque/) | 서로 다른 희소 시퀀스의 결합은 다채널 후기 잔향의 비상관 신호 생성에 쓰인다. | 방향마다 다른 결정론적 희소 패턴을 HRIR과 합성해 사용한다. 논문의 feedback 알고리즘을 그대로 구현한 것은 아니다. |
| [Fagerström — Velvet noise in audio processing](https://research.aalto.fi/en/publications/velvet-noise-in-audio-processing/) | 희소 잡음은 잔향·비상관화·확산에 활용되며 binaural late reverb 연구가 있다. | L/R 입력마다 독립 후기 FIR을 사용해 완전 역극성 widening과 구분한다. |
| [York — SADIE 프로젝트](https://www.york.ac.uk/sadie-project/index.html), [SADIE II 논문 저자 공개본](https://eprints.whiterose.ac.uk/id/eprint/137829/1/applsci_08_02029_1_.pdf) | 공개 측정 HRTF와 비개인 HRTF 평가의 기반 자료. | 기존 diffuse-field-compensated KEMAR 자산을 사용한다. 개인 HRTF로 표시하지 않는다. |
| [W3C Web Audio — ConvolverNode](https://www.w3.org/TR/webaudio-1.1/#ConvolverNode) | 채널 구성과 convolution, 자동 normalization의 동작을 정의한다. | Mono 채널별 stereo FIR과 공통 mono 보정 FIR을 사용하고 normalization을 명시적으로 끈다. |

## 현재 신호 경로

```text
정합 stem / residual
  → 각 L/R 채널의 고정 가상 음원
  → 측정 HRTF + 프로그램 기반 공통 스펙트럼 보정
  → 보컬 전면 버스 / 악기 버스
  → 합산

초기 방향 반사 + 측정 BRIR 후기장 ────┤
독립 8방향 바이노럴 후기장 ──────────┤
                                    ↓
대표 구간에서 측정한 공통 톤 보정 → 음량/peak guard → 출력
```

직접음은 원래 L/R을 단순 통과시키지 않는다. 두 채널을 각각 HRIR에 통과시켜 한 채널의 음원도 두 귀에 시간·레벨 차이를 갖고 도착하게 한다. 가상 L/R 간격은 보컬 ±18°, 베이스 ±24°, 기타 악기 ±55°이며 스테레오 에너지 편향으로 중심 방위를 조정한다. 보컬 중심은 0°로 유지한다. 이는 제작한 가상 무대이며 원본에서 앞뒤·높이를 정확히 추정했다는 뜻이 아니다.

원본과 정합 stem의 차이는 residual로 남긴다. 공간화 전 합산은 mixture consistency를 유지하지만, 서로 다른 HRIR을 통과한 최종 출력은 원본과 bit 동일하지 않다. Full-mix fallback도 바이노럴 경로를 사용한다. Original만 원래 신호를 그대로 출력한다.

## 톤·방향 단서 보호

HRIR의 녹음 이득을 공통 scalar로 정규화한 뒤, 최대 6개 대표 FFT 창에서 입력 L/R power와 cross-spectrum을 계산한다. HRIR 행렬을 통과했을 때의 예상 에너지로부터 1/3-octave 공통 보정을 만들고 ±6dB로 제한한다. 양쪽 귀를 별도로 평탄화하지 않으므로 동일 입력 채널의 양이간 HRIR 비율은 유지된다. 방향별 스펙트럼이 지각에 미치는 영향을 없앴다고 보장하지는 않는다.

전체 렌더의 대표 구간도 원본과 비교해 공간 처리에서 생긴 넓은 대역 편차를 보정한다. 이 공통 FIR은 두 출력 채널에 같은 응답을 적용하며, 기기 EQ나 청취자 개인 보정이 아니다. 이 과정은 기존 보정용 preview를 재사용한다. 실시간 audio callback에서 FFT·곡 분석을 하지 않는다. 버퍼별 결과와 방향 FIR을 캐시한다.

## 포위감 레이어

기존 후기장은 공통 신호를 작은 이득으로 대칭 합성했다. 새 경로는 측면 ±100°, 후면 ±145°, 상부 ±72°/64° 및 후상부 ±145°/56°의 8방향에 각각 다른 희소 패턴을 둔다. 시작은 87–140ms, 감쇠 설계 T60은 0.65초, FIR 저장 길이는 0.72초다. 각 방향을 측정 HRIR로 렌더하고, L/R 입력마다 다른 FIR을 사용한다. 실제 최종 EDT/T20는 전체 초기장·BRIR·필터와 합쳐진 측정값이며 이 설계값과 같다고 표시하지 않는다.

후기장의 귀별 총 에너지는 균형을 맞추지만 파형을 동일하게 또는 완전 반대로 만들지 않는다. 220Hz–11kHz로 제한하며 초기장 EQ·기존 mono-null 확장과 별도로 송출한다. 보컬의 후기 전송량은 악기보다 작아 전면 초점을 유지한다.

## 검증과 남은 한계

- 임펄스 검사는 실제 후기 에너지, 후기 IACC, 모노에 남는 에너지, 후면·상부 방향 포함 여부를 확인한다.
- 한쪽 입력만 재생해도 두 귀에 신호가 도달하고 가까운 귀가 더 강한지 검사한다.
- 보정된 전체 그래프에서 64Hz–12kHz의 9개 톤, mono/상이한 stereo phase, stem 유무, BRIR 유무의 8개 조건을 검사한다. 대역 간 이득 편차 기준은 이전과 같은 1.5dB 미만이다. 연속 전 대역 응답이나 모든 곡에서의 청감을 보증하지 않는다.
- Original의 무가공 경로, 모드 전환·중지·지연 요청 취소, 그래프 폐기를 함께 검사한다.
- 고정 non-individual HRTF에서 전후·상하 구분과 외재화에는 개인차가 있다. Head tracking, 개인 귀 측정, 다채널 원본의 실제 3D 장면 복원은 구현하지 않았다.
- 같은 음량의 음악으로 폭·포위감·보컬 명료도·톤을 나누어 청취 평가해야 한다. 사용자 청취 없이 “머리 밖 모든 방향이 확실히 들린다”고 단정하지 않는다.

## v125-open-field: 공간 경계감 완화

`static/js/spatial-renderer.js`에서 공통 공간 버스 계수를 0.4 → 0.3, hall 초기 반사 버스 계수를 0.88 → 0.76, 실측 venue tail 계수를 0.3 → 0.24로 낮췄다. 공간 버스 high-pass는 110 → 180 Hz, 340 Hz EQ는 -1.15 → -1.8 dB로 조정했다. 공간 버스 low-pass는 14.5 → 16 kHz, Q는 0.35 → 0.5로 바꿔 저중역 중첩과 상부 대역 감쇠를 함께 완화한다. 직접음 행렬·분리 정렬·독립 후기장·보컬 중심·디자인은 변경하지 않았다. 새 노드는 추가하지 않았다.

설계 근거는 직접음/초기 반사/후기장의 구분([Stewart & Sandler, DAFx 2007](https://www.dafx.de/paper-archive/details.php?id=xDO_3WOhPiGcD4CI1FZChw))과 방향별 시간 밀도를 다룬 포위감 연구([Riedel et al.](https://arxiv.org/abs/2301.10210))다. 논문이 위 계수나 사용자에게 더 좋은 청감을 보장하는 것은 아니다. 이번 변경은 기존 독립 후기장을 보존하면서 공간 경로의 상대적 비중을 낮추는 튜닝이다.

기존 v124 파일을 `data/outputs/_benchmarks/open-field-before/`에 보존하고 측정 BRIR 유/무 조건에서 48 kHz 저레벨 mono impulse를 1.2초 렌더해 경로별로 비교했다. 직접음만, 독립 후기장만 켠 출력은 각각 최대 PCM 오차 0이었다. 별도 공간 경로 에너지는 -2.529/-3.570 dB, 전체 에너지는 -0.054/-0.158 dB 변했다. 전체 피크는 동일했다. 노드 수는 BRIR 없이 94개, BRIR 포함 102개로 전후 동일했다. 상세 결과는 `data/outputs/_benchmarks/open-field-comparison.log`에 있다. 곡과 HRTF, 기기에 따라 청감은 달라지므로 이 결과만으로 개방감 개선을 단정하지 않는다.

렌더 캐시 버전을 `v125-open-field`로 바꾸고 JS URL도 갱신해 이전 HQ 결과가 재사용되지 않게 했다. 이미 열린 화면에는 새로고침 후 음악 재선택이 필요하다.

## v126-immersive-dynamics: 포위감과 강약 보존

### 근거와 적용 범위

- Griesinger, AES 126 (2009), [The Importance of the Direct to Reverberant Ratio in the Perception of Distance, Localization, Clarity, and Envelopment](https://aes.org/publications/elibrary/elibrary-page/?id=14920): 직접음 검출, 반사 에너지 비율, 지연의 관계를 다룬다. 직접음 행렬과 첫 파면은 보존하고 후기장의 상대적 비중을 조정한다. 공개 초록 범위에서 참고했다.
- Riedel, Frank & Zotter (2023), [Perceptual evaluation of listener envelopment using spatial granular synthesis](https://arxiv.org/abs/2301.10210): 포위감에 대한 방향·시간 밀도를 다룬다. 연구의 20ms 미만 조건은 해당 재생 실험의 결과이며, 이 앱에서 보장되는 지각 임계값으로 사용하지 않는다. 방향별 반사의 시간 밀도를 높이는 설계 참고로 사용했다.
- [BinRIR, DAFx 2017](https://www.dafx.de/paper-archive/details/lUF_cLvEDGdaZjWoH1jBrQ): 직접음·초기 반사·확산 후기장을 분리하고 후기장을 합성하는 접근을 참고했다. 이 앱의 수치나 합성 신호가 해당 알고리즘의 재현이라고 주장하지 않는다.

음원에 실제 녹음실의 BRIR·마이크 위치·헤드 트래킹 정보가 없으므로 녹음실 자체를 복원하는 기능은 아니다. 기본 측정 HRTF와 AIR Aula Carolina, 기존 공간 장면 위에서의 튜닝이다. 청취자 개인 HRTF와 실제 재생 기기에 따른 차이는 남는다.

### 코드 변경

`SPATIAL_LATE_FIELD`가 후기장 설정을 모은다. 8방향·2개 입력 채널의 고정 FIR 구조는 유지하며 방향당 tap 수를 28 → 48로 늘렸다. Tap 시간 분포는 0.5초, 상승 구간은 25ms, 지수 감쇠 계수는 0.78초다. HRIR의 4.8kHz low-pass 성분과 그 나머지를 합성할 때 고역 성분에는 추가 0.22초 감쇠 계수를 적용한다. 이 계수들은 튜닝 값이며 실측 T60이나 논문이 권장한 수치라고 해석하지 않는다. 방향별 jitter와 독립 부호를 유지하고, 귀별 에너지는 이전처럼 정규화한다. Send는 0.15 → 0.165로 조정했다. 고정 FIR 길이는 최종적으로 기존 0.72초를 유지했다. 신호에 따라 반사·보컬 이득을 변조하지 않는다. 준비 때의 계산은 늘지만 캐시를 재사용하며 실시간 노드 수와 FIR 길이는 그대로다.

보정 첫 단계에서는 peak guard의 ratio를 1로 설정한 오프라인 프리뷰로 압축 전 피크를 측정한다. 창별 RMS 일치 이득의 중앙값과 최소 피크 여유 이득 중 작은 값을 선택한다. 이후 검증 프리뷰는 실제 peak guard 설정을 유지해 브라우저 compressor의 고정 이득 특성도 반영한다. 최종 보정도 같은 원칙을 사용하며 `headroomLimited`로 이 선택을 기록한다. 실제 재생에는 기존 비상 peak guard를 유지한다. 샘플 피크 목표와 0.5dB 여유는 inter-sample peak에 대한 보수적 추정이며 true-peak 보장을 뜻하지 않는다. 피크가 큰 곡은 압축 대신 고정 출력 이득이 낮아질 수 있다.

### 측정

비교 기준은 이번 작업 시작 시의 v125 스냅샷 `data/outputs/_benchmarks/immersive-before/`다. 최신 측정은 브라우저 캐시를 사용하지 않고 이전·현재 JS를 각각 명시적으로 공급했다. `immersive-sustained-final.log`에는 양쪽 FIR 길이 0.72초도 기록했다.

48kHz mono, 진폭이 다른 60ms의 3.2kHz Hann burst와 220Hz 저레벨 배경을 사용했다. 동일 보정 상태에서 전체 진폭과 1/4 진폭을 각각 렌더해 입력의 12.0412dB 차이를 확인했다. BRIR 유/무에서 이전 출력 차이는 11.5662/11.5799dB, 변경 후는 12.0412/12.0412dB였다. 큰 신호와 작은 신호를 4배 정렬했을 때 상대 오차는 이전 약 -29.5/-29.8dB, 이후 약 -125.7/-126.2dB였다. 해당 자극에서의 비선형 압축 감소를 보여주며 모든 음악에 대한 보장은 아니다.

이때 변경 후 샘플 피크는 약 0.8414이고 RMS 음량은 원본보다 약 1.78~1.79dB 낮았다. 원본 crest는 18.0189dB, 변경 후는 18.3173~18.3332dB다. 음량 증가를 다이내믹 개선으로 계산하지 않았다. 직접음만 분리한 이전·이후 PCM 최대 오차는 0이었다.

별도 저레벨 임펄스에서 late/early 에너지 비율은 -7.902 → -7.018dB(BRIR 없음), -7.634 → -6.785dB(BRIR 있음)였다. 후기장 에너지 중심은 약 155 → 168ms, 160 → 172ms로 이동했다. IACC late는 각각 0.1075 → 0.1048, 0.1095 → 0.1084로 소폭 변했다. 전체 노드 수는 94/102개로 각각 동일했다. 객관 지표만으로 더 자연스럽거나 감동적이라고 단정하지 않는다. 이 변경에 대한 사용자 청취 평가는 아직 없다.

구문 검사, Python 33개, Node 8개, 브라우저 전체 114개 통과·기존 조건부 2개 제외. FIR 길이를 기존대로 맞춘 최종 코드에서 음향·라우팅 18개를 추가로 재검증했다. 전체 검사 중 발견한 낮은 레벨의 0.25dB 매칭 오차는 실제 compressor를 켠 검증 단계로 수정했고 기존 0.1dB 기준을 유지했다. 렌더 키는 `v126-immersive-dynamics`, JS URL도 갱신했다. 적용하려면 열린 화면을 새로고침하고 곡을 다시 선택한다.

## v128-panoramic-surround: 사방 확산 확대

사용자의 전체 후기장 send 0.4와 보컬 설정을 유지하고 독립 공간 필드의 방향·도착 시간 분포를 재설계했다. 기존 8방향을 16방향으로 늘려 전방 사선·아래쪽 측면·후면 축·위쪽 전방을 추가했다. 방향 쌍은 ±42°/12°, ±85°/-28°, ±174°/8°, ±40°/58°를 포함한다. 이는 가상 FIR 방향 설정이며 개인 청취자의 정확한 지각 위치를 보장하지 않는다. 직접음의 ±35° 행렬과 stem/residual 합산은 변경하지 않았다.

독립 필드의 시작 시각 범위는 87~140ms에서 52~122ms로, 고정 상승 구간은 25ms에서 16ms로 바꿨다. 이제 해당 필드는 50~80ms 전이 구간부터 후기장으로 이어지므로 기존 `startsAfterEarlyWindow`는 false다. 고역 추가 감쇠 계수는 0.22 → 0.3초, 필드 low-pass는 11 → 14kHz로 조정했다. 기존 노드 수와 FIR 길이 0.72초, 두 입력의 독립 FIR 구조와 귀별 에너지 정규화를 유지했다. 준비 단계의 방향별 합성 계산은 증가하지만 컨볼버·런타임 오디오 노드는 추가하지 않았다. 단순 잔향 이득 증가로 공간을 확장한 것이 아니다.

[Catic et al., JASA 2015](https://orbit.dtu.dk/en/publications/the-role-of-reverberation-related-binaural-cues-in-the-externaliz/)의 공개 초록은 직접음과 반사음의 양이 정보가 외재화 지각에 함께 관여함을 다룬다. 이를 직접음을 보존하면서 더 이른 반사 구간에 양이 단서를 분포시키는 설계 참고로 사용했다. 52ms·16방향 등의 수치는 이번 엔지니어링 튜닝 값이며 해당 연구의 재현이나 권장값으로 주장하지 않는다. 원래 녹음실을 복원하거나 외재화·개방감의 청취 결과를 입증하는 기능은 아니다.

비교 기준은 `data/outputs/_benchmarks/panoramic-before/`의 v127 작업 트리다. 최신 코드와 이전 코드를 각각 명시적으로 공급했다. 보컬 stem/BRIR 유무, 악기 stem/BRIR, full-mix fallback의 4조건에서 직접음 PCM 최대 차이 0, 첫 50ms 최대 차이는 약 1.57e-9 이하였다. 50~80ms side 에너지는 모든 조건에서 증가했다. 기준 구간 에너지가 매우 작았으므로 21~47dB의 상대 증가는 지각상 배수나 공간 크기 증가로 해석하지 않는다. 초기 IACC는 악기 0.953 → 0.816, full-mix 0.924 → 0.818, 보컬 약 1.000 → 0.976이었다. 후기 IACC는 약 0.105 → 0.084로 변했다. 노드 수와 FIR 길이는 각 조건에서 동일했다. 로그·JSON은 `panoramic-signal.log`, `panoramic-signal.json`이다.

동일한 burst 신호의 입력 강약 차이 12.0412dB가 변경 후에도 12.0412dB로 유지됐다. 입력 crest 18.0189dB 대비 출력은 17.9993~18.0120dB였고 샘플 피크는 약 0.8414였다. Original/Spatial 빠른·정밀 보정 4조건 음량 차이는 0.001dB 미만이고 HQ 캐시의 unity 이득도 유지됐다. 관련 로그는 `panoramic-dynamics.log`, `panoramic-original-match.log`다. 합성 신호의 결과이며 실제 곡의 주관적 폭과 자연스러움 평가는 아직 없다.


## v129: virtual large sphere

Hoppe et al., *Combined assessment of auditory distance perception and externalization* (2024 preprint), https://arxiv.org/abs/2408.14198, distinguishes perceived distance from externalization: both depend on room size, with different effects from reverberation and visual context. Accordingly this implementation does not equate a numerical radius with an assured listening distance. The 16 m parameter explicitly controls reflected-field travel times, while reduced close-reflection gain changes their balance against the unchanged direct signal. The directional HRTFs still use far-field responses at distance 1; this is an artistic sphere-like ambience model, not wave propagation from a spherical array. No head tracking, individualized HRTF or listening validation is added. Current 0.72 s FIR capacity is adequate at radius 16; substantially increasing radius also requires reviewing tapSpan and duration to avoid truncation. See EVALUATION_PROTOCOL.md for measured results and test limitations.
