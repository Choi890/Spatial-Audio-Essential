# Spatial Audio Essential — 연구 적용 기록

## 범위

공간음향 문헌 전체를 문자 그대로 구현하는 것은 불가능하며 바람직하지도 않다. 연구마다 재생 장치, 입력 포맷, 청취자 측정, 헤드트래킹, 다채널 스피커와 같은 전제가 다르기 때문이다. 이 문서는 현재 프로젝트의 입력인 stereo music, 적응형 Demucs 4~6 Stem, 브라우저 Web Audio, 고정 청취자, binaural headphone output에 직접 적용할 수 있는 연구 축을 정리한다.

적용 원칙은 다음과 같다.

1. Original은 투명하게 보존하고 Full Spatial은 원본을 출력에 직결하지 않는다.
2. 분리 누락을 버리지 않고 `원본 − 정합된 stem 합` residual로 보존한다.
3. 직접음은 원래 L/R sample phase를 유지하고 반사·확산음만 대역 제한된 별도 bus로 분리한다.
4. 특정 stem에 임의의 좌우 pan을 부여하지 않고 모든 공간 반사는 ±azimuth 대칭으로 만든다.
5. 사용자 측정이나 센서가 필요한 기술은 임의로 모사하지 않는다.

## 적용한 연구 축

| 연구 축 | 근거 | 프로젝트 적용 |
|---|---|---|
| 지배 방향과 확산도 분리 | [Spatial Impulse Response Rendering I](https://aes2.org/publications/elibrary-page/?id=13401), [Directional Audio Coding](https://research.aalto.fi/fi/publications/directional-audio-coding-filterbank-and-stft-based-design/) | Stem마다 하나의 anchor를 두고 주변 tap을 diffuse 성분으로 분리했다. |
| 시간–주파수 영역의 단일 지배 소스 가정 | [First-Order DirAC](https://research.aalto.fi/en/publications/first-order-directional-audio-coding-dirac/) | Anchor에는 stem의 보호 대역 전체를, diffuse tap에는 별도 high-pass를 통과한 성분만 보낸다. |
| 선행음 우세와 반사음 융합 | [Bianchi et al., 2013](https://pubmed.ncbi.nlm.nih.gov/23903865/), [Shinn-Cunningham et al., 1993](https://pubmed.ncbi.nlm.nih.gov/8315156/) | Anchor가 모든 diffuse tap보다 최소 6ms 먼저 도착하도록 강제한다. |
| 선행 위치 변화에 따른 echo suppression 붕괴 | [Clifton, 1987](https://pubmed.ncbi.nlm.nih.gov/3693711/) | 오디오 anchor는 재생 중 움직이지 않는다. 화면의 시각적 움직임이 오디오 좌표를 바꾸지 않는다. |
| 에너지 보존형 객체 배치 | [Pulkki, 1997 VBAP](https://research.aalto.fi/en/publications/virtual-sound-source-positioning-using-vector-base-amplitude-pann/) | Diffusion gain 합을 anchor의 72% 이하로 정규화하고 하나의 우세 음상을 보존한다. |
| ITD·ILD·spectral cue 기반 binaural localization | [Individualized HRTF empirical study](https://pmc.ncbi.nlm.nih.gov/articles/PMC7509635/), [SADIE II](https://zenodo.org/records/12542676), [Armstrong et al., 2018](https://doi.org/10.3390/app8112029) | KEMAR/KU100/Human 003/009 측정 HRIR을 청감 선택하고 onset 정렬 구면 보간한다. 결정론적 generic FIR과 native HRTF는 폴백으로만 사용한다. |
| 실제 공간 반응에 의한 externalization | [Arend et al., 2021](https://aes2.org/publications/elibrary-page/?id=21122), [Daugintis et al., 2024](https://aes2.org/publications/elibrary-page/?id=22671), [RWTH Aachen AIR Database](https://www.iks.rwth-aachen.de/en/research/tools-downloads/databases/aachen-impulse-response-database/) | Direct/early/diffuse bus를 분리하고, Aula Carolina 3m 정면 BRIR의 45ms 이후 부분만 저강도 binaural late field로 사용한다. |
| BRIR early/late 경계 | [Meesawat & Hammershøi, 2003](https://secure.aes.org/forum/pubs/conventions/?elib=12346) | 연구에서 작은 지각 차이로 tail 교환이 가능했던 40–60ms 범위 안의 45ms를 경계로 정했다. 측정 응답의 직접음은 제거해 앱의 dry/anchor와 중복하지 않는다. |
| 과도한 decorrelation artifact | [First-Order DirAC](https://research.aalto.fi/en/publications/first-order-directional-audio-coding-dirac/) | time-varying decorrelator를 쓰지 않는다. 고정된 zero-mean sparse velvet FIR을 220Hz 이상 wet side에만 적용하고 좌우를 정확한 반대 극성으로 만들어 mono 합을 보존한다. |
| 저역 공간화의 coloration·위상 위험 | [Blauert, Spatial Hearing](https://link.springer.com/book/10.1007/978-3-642-37762-4), [W3C Web Audio BiquadFilterNode](https://www.w3.org/TR/webaudio-1.1/#BiquadFilterNode) | Primary 저역은 처리하지 않고 lateral 220Hz, mid-derived side 700Hz, diffuse 320Hz 이상으로 분리한다. room bus에만 최대 ±1.2dB 저차수 정규화 EQ를 둔다. |
| Hybrid Transformer source separation | [Rouard et al., 2022](https://arxiv.org/abs/2211.08553), [Défossez, 2021](https://arxiv.org/abs/2111.03600) | `htdemucs_ft` 4 Stem을 품질 기준으로 유지하고 `htdemucs_6s`의 guitar/piano가 누출·투영·에너지 게이트를 통과할 때만 승격한다. mixture-consistency scale과 residual로 분리 누락을 보존한다. |
| Stereo-to-binaural coherence | [Interaural Coherence Matching](https://secure.aes.org/forum/pubs/conventions/?elib=15283) | Primary stem과 residual의 L/R sample phase를 그대로 유지하며 lateral field의 상관도 guard를 자동 테스트한다. |
| Early reflections와 externalization | [Hassager et al., 2018](https://pubmed.ncbi.nlm.nih.gov/29857749/) | Primary에는 인위적 delay를 두지 않고 early/diffuse/late field를 분리해 외재화 단서는 늘리되 직접음 명료도를 보호한다. |
| 초기 측면 반사와 apparent source width | [Barron, 1971](https://doi.org/10.1016/0022-460X(71)90406-8) | 10~80ms 측면 반사를 전면·천장 반사보다 우선해 무대 폭을 만들고, 직접음은 별도 0ms primary에 유지한다. |
| 후기 반사와 listener envelopment | [Barron, 2001](https://doi.org/10.1016/S0003-682X(00)00055-4) | 80ms 이후의 측면 에너지를 별도 LEV 레이어로 분리하고 후면·상부 방향을 대칭으로 보강한다. |
| 반사의 binaural 변동과 외재화 | [Catic et al., 2015](https://pubmed.ncbi.nlm.nih.gov/26328729/) | 정면 음원의 외재화를 위해 반사장의 양이간 단서를 보존하고, 고정 mono 잔향으로 축소하지 않는다. |
| 직접음과 잔향의 HRTF spectral detail | [Hassager et al., 2016](https://pubmed.ncbi.nlm.nih.gov/27250190/) | 직접음·초기 방향 단서의 스펙트럼을 보호하되 후기장은 9.2kHz low-pass와 저강도 확산으로 과도한 generic pinna coloration을 억제한다. |
| 자연 음원의 방향성과 반사 차수 | [Steffens et al., 2021](https://pubmed.ncbi.nlm.nih.gov/33940902/) | 방향성이 지각적으로 중요한 직접음과 1차 반사는 Stem 객체가 담당하고, 후기 확산장에는 세부 방향성을 반복 적용하지 않는다. |
| 디지털 overload와 true-peak 위험 | [ITU-R BS.1770-5](https://www.itu.int/rec/R-REC-BS.1770-5-202311-I) | K-weighting 절대/상대 게이팅 LUFS-I, 8× windowed-sinc inter-sample peak 추정, 처리 후 peak/RMS preflight와 단일 peak guard로 headroom을 확보한다. |

## 현재 주파수별 공간 정책

| 신호 | Full Spatial primary 대역 | Diffusion 시작 주파수 |
|---|---:|---:|
| Vocals | 45Hz–17.5kHz | 900Hz |
| Drums | 35Hz–17kHz | 1.2kHz |
| Bass | 원본 full-band stereo phase 보존 | 320Hz |
| Other/music | 35Hz–17.5kHz | 650Hz |
| Scene lateral | primary 저역 별도 보존 | 220Hz |
| Mid-derived mono-null side | primary center·low 별도 보존 | 700Hz |
| Scene diffuse field | primary 별도 보존 | 320Hz |
| Measured venue late field | primary·early 별도 보존 | 220Hz |

Full Spatial은 연주자를 앞 스테이지에 고정한 채 20×20×20m 공연장 중앙을 기준으로 전면·측면·후면·천장 반사를 함께 사용합니다. 벽 10m, 벽 모서리 14.14m, 공간 모서리 17.32m 좌표에 음속 343m/s 기반 29.2~50.5ms 지연을 적용하며 좌우 반사는 완전 대칭입니다. 측정 late field는 220Hz~10.5kHz로 사용하고 Primary L/R 위상은 이 레이어와 분리합니다.

공간적 폭과 포위감은 별도로 렌더링합니다. 80ms 이전의 측면 초기 반사는 apparent source width를 담당하고, 80ms 이후의 후기 레이어는 측면·후면·상부 8방향에 87~140ms 기본 지연과 5~44ms 희소 확산을 적용합니다. 후기장은 240Hz~9.2kHz로 제한하며 측정 BRIR이 있을 때 send를 3.2%로 제한합니다. QA는 초기 `IACC80`과 후기 `IACC late`를 따로 계산합니다.

Room 출력만 110Hz high-pass와 14.5kHz low-pass 안에서 동작합니다. 165Hz/340Hz의 누적 에너지를 낮추고 4.2kHz 존재감을 복원하는 최대 ±1.2dB 정규화 EQ도 room bus에만 적용합니다. 직접음과 stereo bass는 별도 full-band primary bus가 담당합니다.

## 의도적으로 적용하지 않은 연구

- **개인 측정 HRTF:** 공개 측정 프로파일의 청감 선택은 제공하지만 사용자의 귀·머리 형상을 실제로 측정한 개인 HRTF라고 표시하지 않는다.
- **6DoF와 head tracking:** 브라우저에 신뢰할 수 있는 머리 방향 센서 입력이 연결되어 있지 않다.
- **Ambisonics/HOA/VBAP 출력:** 현재 입력은 Ambisonics scene이 아니며 출력도 다채널 스피커 배열이 아니다.
- **측정 BRIR의 직접음·개인화:** 포함된 AIR 응답은 더미헤드 측정값이며 청취자 개인 HRTF가 아니다. 따라서 45ms 이전 직접음은 사용하지 않고 “Aula Carolina의 측정 late field”로만 표시한다.
- **강한 time-varying decorrelation:** 넓이는 커질 수 있지만 coloration, transient smear, 위치 불안정 위험이 있어 제외한다.
- **인증용 납품 미터 대체:** K-weighted gated LUFS-I와 8× true-peak를 구현했지만, 브라우저 출력 장치 이후의 OS DSP나 DAC를 측정하지는 않는다. 방송 납품 인증에는 교정된 외부 미터가 필요하다.

## 검증 규칙

- Full Spatial primary path의 추가 delay는 0ms여야 하며 원본 source가 출력 bus에 직결되면 안 된다.
- Stem과 residual primary는 channel split, pan, HRTF 없이 입력 L/R sample을 오차 없이 보존해야 한다.
- Full Spatial reflection tap은 같은 gain·delay의 ±azimuth pair여야 한다.
- Mixture scale은 0.72~1.18 범위이고 정합된 stem 합은 반대 극성으로 residual 합산점에 연결되어야 한다.
- Stem 공통 sample lag는 ±128 sample 안에서 정렬하고, 상관 신뢰도가 낮으면 위상 보존 full-mix fallback을 사용해야 한다.
- Stem diffuse tap은 route anchor보다 6ms 이상 늦고 합은 anchor gain의 72%를 넘지 않아야 한다.
- Vocals/other anchor는 전면 75° 안쪽, 4m 이내, 7ms 이하여야 한다.
- Drums/bass anchor는 후면 130° 바깥, 9m 이상, 17ms 이상이어야 한다.
- Bass diffuse는 320Hz 아래를 포함하지 않아야 한다.
- Lateral side layer는 220Hz 아래를 포함하지 않아야 한다.
- Mid-derived side는 700Hz~12kHz로 제한하고 좌우 반대 극성으로 출력해 mono 합이 0이어야 한다.
- Decorrelator FIR의 좌우 sample 합은 부동소수점 오차 범위에서 0이고 시간에 따라 변하지 않아야 한다.
- 측정 HRIR은 현재 AudioContext sample rate로 리샘플링되고 모든 출력 sample이 finite여야 한다.
- Room 응답 정규화는 최대 ±1.2dB이며 primary와 Original graph에는 연결되지 않아야 한다.
- 렌더된 출력은 finite이고 peak가 0dBFS보다 낮으며 stereo correlation은 -0.35보다 커야 한다.
- Full-mix diffuse field는 320Hz 아래를 포함하지 않아야 한다.
- Measured venue late field는 stereo 48kHz, 2.8초여야 하며 45ms 이전 direct segment가 0이어야 한다.
- Venue convolution 입력은 mono로 만들고 출력만 measured binaural stereo를 사용해야 한다.
- Venue gain은 room master와 최종 peak guard를 거쳐야 한다.
- Spatial 출력의 dynamics processor는 최종 peak guard 하나만 사용한다.
- 외재화 HRTF 객체는 실제 distance model, 거리/음속 기반 최소 지연과 거리별 고역 감쇠를 사용해야 한다.
- 출력 headroom 계산은 분석된 8× true-peak와 처리 후 Full Spatial preflight 실측값을 반영해야 한다.
