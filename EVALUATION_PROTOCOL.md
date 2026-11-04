# 검증 범위와 비교 실험

## 현재 결론

직접음 복원과 stem별 공간 효과 제어를 구현한 연구용 프로토타입이다. 회귀 테스트 통과는 음질·외재화 개선의 증거가 아니다. 대표 음악의 비교 청취 결과는 아직 없으며 README의 성능표는 미측정 상태로 유지한다.

## v1.18 오류 수정

| 항목 | 변경과 회귀 검증 |
|---|---|
| Demucs 캐시 | 파일 식별자 전체와 모델·분리·후처리 설정을 구조화해 SHA-256으로 해싱한다. 마지막 글자만 다른 64자리 키와 서로 다른 설정을 구별한다. 기존 `content-v2` 캐시는 재사용하지 않는다. |
| 긴 곡 분석 | 샘플 건너뛰기를 원래 샘플레이트의 분산된 연속 구간으로 교체한다. 기본 분석량은 최대 4초, 최대 8구간이며 필터 예열은 별도다. 48kHz/8kHz 톤의 4초·180초 대역 레벨 차이가 0.1dB 이내인지 검사한다. 평균 레벨 추정도 같은 방식으로 보정한다. 이는 전체 곡의 모든 순간을 검사하는 분석은 아니다. |
| 분석 리샘플링 | 기존 `resample_linear` 이름은 호환성을 위해 유지하고 구현은 FIR polyphase로 교체한다. 48kHz→22.05kHz에서 1kHz 진폭 오차 1% 이내, 16kHz의 내부 구간 잔류 진폭 0.001 미만을 검사한다. 재생 HRIR 리샘플링은 별도 구현이다. |
| IACC | ±1ms lag에서 정규화 교차상관의 절댓값 최대를 사용하며 모든 샘플을 누적한다. lag별 겹치는 구간을 정규화하고 범위는 0–1이다. 무음은 0으로 처리한다. 초기 80ms, 후기 80ms 이후 최대 1.5초를 사용한다. 동일·역상 입력과 홀수 샘플에만 에너지가 있는 입력을 검사한다. |
| 자산 | JSON·공지문 체크아웃은 LF로 고정하고 생성기도 LF를 기록한다. WAV/HRIR/SOFA는 원시 바이트 해시 검증을 유지한다. Windows와 Linux CI에서 manifest를 검증한다. |

분석 프로파일과 브라우저 렌더 캐시 버전을 변경했으므로 첫 분석·렌더는 다시 실행된다. 캐시 키 변경으로 Demucs도 새로 실행될 수 있다. 사용자가 만든 오디오 파일을 삭제하지 않는다.

리샘플링 구현 근거: [SciPy resample_poly](https://docs.scipy.org/doc/scipy/reference/generated/scipy.signal.resample_poly.html). 이 함수는 저역 FIR 필터를 적용한 뒤 다운샘플링한다.

## 2026-10-18 공간 확장과 초점 보존

기록된 L/R 차이 성분에 지연 없는 확장 경로를 추가했다. 220Hz 고역 통과 필터로 저음 확장을 제한하고 좌우 역극성으로 더해 모노 합산을 보존한다. 직접음 복원과 출력 음량 보정·피크 제한은 유지한다. 분리된 보컬은 lateral 경로에서 제외하고 전용 초기반사와 hall/BRIR 경로는 유지한다. Stem 경로의 지연된 lateral 확산 이득은 2에서 1.25로 줄였으며, stem이 없는 fallback은 기존 확산 이득을 유지한다. 렌더 캐시 식별자와 app.js URL도 변경했다.

새 브라우저 회귀 검사는 44.1/96kHz에서 확장 경로만 분리해 원본과 합산한다. 3kHz 좌우 성분의 RMS 비율은 1.75–2, 50Hz 추가 성분은 원본 좌우 성분의 0.06 미만, 모노 최대 오차는 1e-7 미만, 추가 신호의 시작은 1ms 미만을 요구한다. 이는 **독립된 경로의 합성 신호 조건**이며 전체 출력이나 실제 음악의 체감 공간이 두 배라는 뜻은 아니다. 악기 위치 정확도·보컬의 전방감·몰입감은 같은 음량의 비교 청취로 확인해야 한다.

2026-10-18 Windows 검증: 구문 검사, Python 29개, Node DSP 4개, 브라우저 99개 통과·2개 조건부 건너뜀. 브라우저 실행은 종료 단계에서 남은 테스트 worker를 종료한 뒤 성공 코드로 완료됐다. 새 경로의 회귀 검사는 Chrome·Edge·Firefox에서 통과했다.

## 필요한 비교 조건

### 재생 모드 전환 회귀

모드 전환 함수가 진행 중인 HQ 전체곡 렌더 Promise를 무제한 기다려 버튼과 실제 출력이 달라지는 경로를 제거했다. 캐시가 준비됐으면 캐시를, 아니면 실시간 DSP를 즉시 사용한다. 전환마다 revision과 곡·모드·재생 명령을 확인해 오래된 요청을 무시하고, 정지 시 대기 중 전환도 무효화한다. 새 소스를 성공적으로 시작한 뒤 활성 그래프를 교체한다. 진행 중 gain curve는 hold/cancel 후 다시 예약하며, 이전 그래프의 페이드 예약에 실패하면 해당 그래프를 즉시 폐기해 이전 소리가 남지 않게 한다.

브라우저 회귀 검사는 Original에 440Hz, 캐시된 Spatial에 1200Hz를 사용한다. 끝나지 않는 HQ 렌더를 둔 상태에서도 두 모드가 전환되는지, 모든 활성 master를 합산한 analyser에서 우세 주파수가 바뀌는지 확인한다. 같은 이벤트 루프의 연속 클릭, 35ms 간격으로 페이드를 중단하는 전환, AudioContext 대기 중 정지 후 늦게 완료되는 요청도 검사한다. Headless Firefox는 오디오 클록이 멈출 수 있어 출력 주파수 검사는 Chrome·Edge에서 실행하고 Firefox에서는 그래프·재생 상태와 폐기를 검증한다.

중지 시 공통 재생 출력의 gain을 0으로 바꾸고 목적지 연결도 해제한다. 활성 포인터와 별개로 모든 실시간 재생 그래프를 추적해 전환 중 생성된 그래프까지 폐기하며, 각 master의 미래 gain 예약도 취소한다. 재생 시작 중 일부 소스만 시작한 상태에서 예외가 발생해도 전체 경로를 정리한다. 이 출력 게이트는 unity gain이며 오프라인 렌더·내보내기 DSP에는 적용하지 않는다.

추가 회귀 검사는 페이드 중 Stop 이후 모든 master의 합산 신호가 0인지, 650ms 후에도 무음인지, 다시 Play하면 신호가 돌아오는지 확인한다. 대기 중 Play 취소와 소스 시작 직후 강제 예외의 정리도 검사한다. Firefox에서는 재생 재개 신호 크기 검사를 제외한다.

### v1.19 분석 속도 검증

사용자는 최초 분석 1분을 요청한 뒤, 빠른 모델 전환 대신 기존 음질과 모델을 우선하도록 선택했다. `htdemucs_ft` 4-model ensemble, `htdemucs_6s`, FP32, shifts=2, overlap=0.36, segment=7초를 유지한다. CUDA worker는 4개 구간씩 처리하고 메모리가 부족하면 2→1로 줄여 재시도한다. 각 모델의 shift·overlap-add·positional embedding RNG 호출 순서를 유지한다. CPU 분리는 upstream CLI를 유지한다. 업스트림의 모델·shift 비용 설명은 [Demucs README](https://github.com/facebookresearch/demucs/blob/main/README.md)에 있다.

두 모델을 한 worker에서 실행해 입력 디코딩과 프로세스 초기화를 공유한다. NMF는 이미 계산된 STFT를 재사용하며 행렬 곱의 결합 순서만 바꿔 불필요한 중간 행렬을 없앤다. Hybrid stem 후처리는 메모리에서 이어서 실행해 중간 WAV 쓰기·읽기를 줄인다. 브라우저 디코딩 전 ArrayBuffer 복제도 제거했다. 서버 `analysisTiming`과 브라우저 `analysis.clientTiming`에 단계별 시간을 남긴다. 서버 전체 분석 캐시 키에는 분리 설정 식별자도 포함한다.

Windows / RTX 4070 Laptop GPU / PyTorch 2.5.1+cu121에서 같은 194.608초 WAV를 비교했다. 원본 업로드가 남아 있지 않아 기존 음악의 4개 stem을 더한 재구성 입력을 사용했다. 이전 구현은 Git HEAD의 `backend/audio_engine.py`를 별도 모듈로 로드해 실행했다. 양쪽 모두 stem 캐시 미사용, 모델 파일은 이미 다운로드된 상태다.

| 서버 측 측정 | 이전 구현 | 최적화 구현 |
|---|---:|---:|
| 전체 최초 분석 | 106.374초 | 94.893초 |
| 핵심 분리 | 69.54초 | 66.20초 |
| 보조 분리 | 26.18초 | 15.85초 |
| 분리 후처리 | 6.84초 | 5.37초 |
| stem 캐시 재사용 분석 | 미측정 | 3.380초 |

최초 분석은 약 10.8% 단축됐지만 **1분 목표에는 미달**한다. 단일 곡의 단일 비교이며 실행 순서·장비 부하에 따른 편차가 있다. 위 전체 측정 뒤 추가한 메모리 내 후처리는 별도 동일-input 비교에서 4.839초→4.282초였고, 후보 악기가 없는 4-stem 출력의 PCM24 샘플 최대 차이는 0이었다. 이 값을 전체 시간에서 추정 차감하지 않았다. 브라우저 업로드·다운로드·오프라인 보정·HQ 전체곡 캐시 렌더 시간은 이 서버 수치에 포함하지 않는다. 재분석 3.4초를 최초 분석 성능으로 표시하지 않는다.

`tools/benchmark_analysis.py INPUT --output-dir WORK_DIR --report REPORT.json`으로 반복 측정한다. 캐시 사용 여부와 분리 완료 상태를 기록하며, 실패를 빠른 완료로 취급하지 않는다. 로컬 측정 원본 JSON은 `data/outputs/_benchmarks/analysis-reference-v118.json`, `analysis-quality-v119.json`, `postprocess-comparison.json`에 저장했다. 10초 입력의 실제 HTDemucs 단일 모델에서 같은 seed의 upstream 대비 batch 2 상대 RMS 차이는 약 0.00012였다. 이는 FP32 연산 순서 차이를 검토한 것이며 음질 개선이나 완전한 bit 일치를 입증하지 않는다. 합성 모델 테스트는 shift·짧은 마지막 구간·overlap-add·RNG·OOM 재시도의 출력을 검증한다.

최종 검증: 구문 검사, Python 31개와 Node DSP 4개 통과, 브라우저 102개 통과·2개 조건부 건너뜀. 기타·피아노 후보가 채택된 합성 입력에서도 기존 디스크 중간 파일 경로와 새 메모리 경로의 결과를 비교한다. CI에 선택적인 Demucs/PyTorch가 없으면 worker 수치 테스트만 건너뛴다.

### 현재 위상 안정성 회귀: v124-phase-stable-scene

직전 개별 HRTF·보정 경로는 분리 신호와 residual을 다르게 필터링해 mixture reconstruction의 상쇄 조건을 깨뜨렸다. 같은 원음에서 시간에 따라 분리 누설만 바꾼 재현 검사에서, vocal lift를 중립으로 둔 v123 직접음의 상대 RMS 차이는 0.054419였다. 현재는 기본 설정에서 동일 이득으로 합산한 후 하나의 고정 대칭 바이노럴 행렬을 적용한다. 상세 구조와 현재 적용 범위는 [BINAURAL_SCENE_RESEARCH.md](BINAURAL_SCENE_RESEARCH.md)의 v124 절을 따른다.

`tests/phase-stability.spec.js`는 분리 누설 변화의 상대 RMS 오차 1e-5 미만, mono 보컬의 L/R 차이 1e-7 미만, transient map 유무에 따른 전체 출력 차이 1e-7 미만을 요구한다. 공간음의 순간 ducking, 별도 vocal gain lift, 즉시 역극성 side 복제를 제거했으며, 8방향 후기장과 원본 대비 톤 검사는 유지한다. 이전 정적 톤·임펄스 수치만으로 위상 안정성이나 실제 청감을 입증할 수 없다.

Windows Chrome·Edge·Firefox에서 누설 변화의 상대 RMS 차이는 각각 1.27e-7, 1.29e-7, 2.81e-7이었다. 새 위상 검사 6개와 기존 톤 검사 3개를 통과했다. 전체 브라우저 실행은 110개 통과·2개 제외였으며, 제거된 transient control 개수를 기대하던 3개 검사를 0으로 갱신하고 재검증했다. Chrome 초기 Play의 일회성 실패도 있어 관련 6개 검사(6-stem·전환·중지)를 세 브라우저에서 다시 실행했고 모두 통과했다. 이 일회성 초기 Play 실패 원인을 확인했다고 주장하지 않는다. 구문 검사와 diff 공백 검사도 통과했다.

### 코드·DSP 정리: 1.20.2

위상 안정성 수정 직후 코드를 기준으로 `app.js` 137줄과 `spatial-quality.js` 42줄을 삭제했다. 사용하지 않는 transient 분석·잔향 duck 예약·실시간 duck 콜백, unity gain 중간 노드, 출력이 0인 역극성 확장 경로와 미사용 impulse 생성기를 제거했다. 동일 이득의 보컬·악기·residual 직접음 버스는 공통 버스로 합쳤다. 측정 HRTF, 방향별 후기 공간장, 기존 분리 모델은 유지한다.

수정 전 스크립트를 별도로 보관하고 Chrome·Edge·Firefox에서 같은 48kHz 합성 입력을 각각 렌더링해 비교했다. Stem 없는 경우와 4·6스템의 9개 비교에서 최대 샘플 차이는 6.71e-8 이하, 상대 RMS 차이는 5.75e-7 이하였다. 이 합성 fixture의 그래프 노드는 각각 101→94, 185→170, 223→204개였다. 이는 노드 수 측정이며 CPU 사용률이나 전체 곡 분석 시간의 개선율을 의미하지 않는다. 비교 결과는 로컬 `data/outputs/_benchmarks/audio-cleanup-{chrome,edge,firefox}.json`에 기록했다. 기존 4스템 회귀의 노드 상한도 220에서 200으로 낮췄다.

정리 후 전체 브라우저 회귀는 114개 통과·2개 조건부 제외로 완료됐다. Python 31개와 Node DSP 4개도 통과했다. 구문 검사와 diff 공백 검사를 통과했으며, 실행 중인 8768 서버가 새 스크립트 URL을 제공하는 것도 확인했다.

### 프로젝트 간소화: 1.20.3-simplified

이번 작업 직전 작업 트리의 원본을 `data/outputs/_benchmarks/simplification-before/`에 보관했다. 기존 미커밋 수정분을 기준으로 비교하며, 이전 커밋 대비 감축량으로 섞어 계산하지 않는다. 실행 코드(app·backend·static)는 12,338→11,439줄로 899줄(7.29%), 테스트·도구·런처를 포함한 코드 전체는 16,995→16,091줄로 904줄(5.32%) 감소했다. 실행 코드 크기는 470,220→440,463바이트다. README는 856→107줄로 줄이고 중복 설명을 실행·설정·코드 구조와 기존 연구 문서 링크로 정리했다. **코드 절반 감축 목표는 달성하지 않았다.**

반사음의 composite/native/synthetic 경로를 `createDirectionalTapBank`로 공통화하고, Gain·Filter·Convolver·BufferSource 및 mono 입력 생성, 트랙 상태 초기화와 캐시 재생 경로를 재사용한다. 대칭 방향·stem 설정은 동일 값의 표로 표현한다. 모든 설정과 방향 표는 변경 전 JSON과 정확히 일치하는지 비교했다. 모든 field 방향이 HRTF를 사용하므로 도달할 수 없는 panned-delay 분기와 미사용 좌표 확장 분기를 제거했다. 소비자가 없는 AudioWorklet 분석 경로와 파일도 제거했다. 잔차 에너지는 이미 구한 dot product로 계산해 중복 샘플 순회를 없앴으며 출력 신호의 stemScale 계산은 유지한다. 백엔드에서는 실행 인자와 metadata JSON 입출력을 공유한다. 기존 92개 백엔드 함수 중 87개의 AST는 그대로이며 변경된 5개는 실행 인자 전달과 JSON 입출력 함수다.

디자인 비교는 Chromium에서 폭 1480·1000·390px와 light/dark의 6조건을 사용했다. 초기 화면은 모든 요소와 before/after 가상 요소의 computed style이 같았으며 PNG 픽셀도 정확히 일치했다. 6스템을 표시한 화면의 6조건도 181개 요소의 computed style이 모두 같았다. 비교 중에만 transition·animation을 비활성화했으며 실제 CSS의 동작은 바꾸지 않았다. 동적 화면 PNG에는 일부 rasterization 차이가 있어 이 화면의 모든 픽셀이 같다고 주장하지 않는다. 스크린샷은 `output/playwright/`에 보관한다.

음향은 44.1kHz 무스템, 48kHz 4스템+BRIR, 96kHz 6스템 Balanced, 24kHz synthetic Safe, 48kHz mono 보컬+BRIR의 다섯 합성 입력을 변경 전 스크립트와 비교했다. Offline DSP 노드 수는 각 조건에서 동일했고, 최대 샘플 차이는 1.72e-7 미만·상대 RMS 차이는 1.71e-6 미만이었다. 실시간 재생에서는 소비되지 않는 Worklet과 silent tap 2개가 추가로 사라진다. CPU·실곡 분석 시간을 새로 측정한 성능 개선율로 해석하지 않는다.

정리 후 Python 31개·Node 4개·브라우저 114개가 통과했고 브라우저 2개는 기존 조건에 따라 제외됐다. 구문 검사와 diff 공백 검사도 통과했다. 품질 모델·분리 설정·음향 계수·측정 자산과 디자인은 유지했다.

### 이전 바이노럴·포위감 회귀: v123-binaural-envelopment (현재 대체됨)

현재 직접음은 채널별 측정 HRIR로 렌더한다. 프로그램의 L/R cross-spectrum을 이용해 공통 응답을 보정하고, 기존 대표 preview에서 얻은 전체 출력 톤 보정도 적용한다. 양쪽 귀를 별도로 평탄화하지 않는다. 측면·후면·상부 후기장은 서로 다른 방향 패턴과 L/R 입력별 FIR을 사용한다. 근거와 구현 경계는 [BINAURAL_SCENE_RESEARCH.md](BINAURAL_SCENE_RESEARCH.md)에 정리했다.

`tests/binaural-scene.spec.js`는 단일 채널 입력이 두 귀에 전달되는지, 가까운 귀 에너지가 더 큰지, 8방향 후기장에 후면·상부가 포함되는지 검사한다. 임펄스의 후기/초기 에너지 비는 −20~−3dB, 후기 IACC는 0.65 미만, 후기 mono 에너지 비율은 0.2~0.8을 요구한다. 이 기준은 회귀용 임의 범위이며 지각적 외재화의 합격 기준이나 국제 표준 인증이 아니다.

전체 톤 검사는 실제 분석 준비와 같은 fast calibration을 거친 뒤 64Hz–12kHz의 9개 톤에 대해 대역 간 이득 편차 1.5dB 미만을 유지한다. Mono/상이한 L/R 위상, stem 유무, BRIR 유무의 8개 조건이다. 이전 raw-primary null 검사는 제거했으며 Original의 무가공 검사와 새 귀별 전달 검사를 유지한다.

가상 스피커의 crossfeed로 원래 hard-panned stereo의 side 비율은 줄 수 있다. 기존 단순 폭 지표의 골든 범위는 0.5–1.35로 갱신하고, 포위감은 별도의 후기 에너지·IACC·mono 생존 검사로 확인한다. 직접음 HRTF가 추가된 4-stem 그래프의 node 예산은 220 미만이다. 이 변경은 테스트를 같은 출력으로 유지하려는 것이 아니라 렌더링 구조와 평가 대상을 변경한 것이다.

2026-10-18 Windows Chrome·Edge·Firefox 측정: 합성 임펄스 후기/초기 에너지 비 −6.908dB, 후기 IACC 0.106, 후기 mono 에너지 비율 0.488이었다. 보정된 8개 합성 프로그램 조건에서 9개 시험 주파수 이득의 최대 편차는 0.332dB였다. 이 값은 단일 KEMAR 구성의 회귀 수치이며 실제 음악·청취자 평균이 아니다. 결과 JSON은 각 테스트의 `envelopment.json`, `tone-response.json`으로 저장한다. 구문 검사 통과, 전체 브라우저 108개 통과·2개 조건부 제외를 확인했다.

### 이전 톤밸런스 회귀: v122-neutral-direct (현재 대체됨)

PLAYBACK DEVICE UI, 기기 프로파일 스크립트, 기기별 preamp·EQ·공간 렌더러 분기를 제거했다. 이전 localStorage 선택은 읽지 않는다. 렌더 캐시 키를 변경해 이전 보정 출력이 재사용되지 않게 했다.

직접음은 좌우 확장 shelf를 우회하고, 확장은 홀 반환에만 적용한다. 홀의 4.2kHz 부스트를 제거하고 wet 합산 계수는 0.82→0.4, 측면 합산 계수는 1.25→0.24로 낮췄다. HRTF 방향, 반사 지연과 잔향 길이, 중앙 보컬의 1.2dB 전면 이득은 유지한다. 직접음을 포함해 side를 두 배 증폭하던 이전 동작은 대체됐다.

`tests/tone-balance.spec.js`는 64Hz–12kHz의 9개 톤을 동시에 입력하고, 출력 각 톤의 L/R 에너지 이득 차이가 최대 1.5dB 미만인지 검사한다. 동일/상이한 L/R 위상, stem 유무, 측정 BRIR 유무의 8개 조건을 Chrome·Edge·Firefox에서 렌더한다. 이는 작은 레벨의 합성 신호 검사이며 모든 곡의 청감이나 전 대역 연속 응답을 보증하지 않는다. 직접음 회귀는 wet를 끈 상태에서 폭 설정을 바꿔도 악기와 보컬 L/R 샘플이 달라지지 않는지 확인한다.

이전 v1 골든의 폭 하한은 전체 신호 side 증폭을 요구했다. 현재 v2 골든은 기존 스테레오 이미지에 가까운 0.9–1.35 범위를 검사하고, 별도의 주파수 응답 검사를 병행한다. 공간감은 같은 음량에서 음악으로 별도 평가해야 한다.

### 이전 확장 기록: 좌우 성분 2배 (현재 대체됨)

`v120-wide-stage-2x`는 stem 렌더 출력에 mid/side shelf 단계를 추가한다. 보컬 직접음은 별도 버스로 통과시키며, 악기 직접음과 공간음의 side에는 250Hz high-shelf로 최대 +6.02dB를 적용한다. Mid는 원래 샘플을 통과시키고 side 변화분만 좌우 역극성으로 합산한다. 따라서 지연이나 잔향 길이를 추가하지 않는다. 저음 side의 이득은 1에 접근한다. 기존 기기별 폭 보정과 상관도 QA 제한도 적용되므로 모든 곡에서 항상 두 배가 되지는 않는다. Stem이 없으면 보컬을 독립 보호할 수 없어 이 추가 확장은 적용하지 않는다.

새 테스트는 이전 처리에 해당하는 `stageWidth: 1`과 기본 확장을 같은 합성 4-stem 프로그램으로 렌더한다. 전체 그래프에서 3kHz side 진폭 비율 1.97–2.03, 50Hz 비율 0.98–1.02, mid 샘플 최대 오차 2e-7 미만을 검사한다. 별도로 잔향을 음소거한 보컬 직접음의 L/R 샘플 오차 1e-7 미만을 검사한다. 이는 합성 신호와 작은 입력 레벨의 회귀 검사다. 모든 음원에서 음질 손실이 없거나 체감 공간이 정확히 두 배라는 보장은 아니며, 같은 음량의 실제 음악 청취가 필요하다.

추가 확장 적용 후 구문 검사와 전체 브라우저 테스트를 실행했다. Chrome·Edge·Firefox의 새 비교 검사를 포함해 102개 통과, 기존 조건에 따른 2개 건너뜀이다. 이번 실행은 worker 수를 2로 제한했으며 별도 종료 조작 없이 정상 종료했다.

| 조건 | 직접음 | 공간 효과 | 비교 질문 |
|---|---|---|---|
| A: Original | 원본 | 없음 | 기준 경험 |
| B: Full-mix spatial | 원본 | 분리 없는 동일 공간 설정 | 분리 없이 얻는 변화 |
| C: Stem spatial | 정합 stem + residual | stem별 방향성 반사 | B 대비 분리의 이득 |
| D: Full system | C와 동일 | 반사 + lateral + BRIR late field | C 대비 추가 레이어의 기여 |

B와 C의 HRTF, 방, 반사 레벨, 대역 제한, EQ 등 공통 설정을 고정한다. D에서 변경한 레이어를 기록한다. 분리 실패 fallback을 C/D로 기록하면 안 된다. 현재 `/mushra`는 준비한 WAV를 비교하는 도구이며 B/C/D를 자동 생성하는 실험 러너는 아니다. 렌더 설정과 실제 stem 경로 활성화를 따로 검증한 후 파일을 준비한다.

## 청취 절차

1. 같은 음악의 같은 시작점과 길이로 WAV 구간을 준비한다. 잔향 꼬리 포함 여부를 통일한다. 원본과 처리 파일의 onset/지연은 외부 파형 검사로 정렬한다.
2. 공간 효과만 평가할 때 모든 조건의 외부 기기 EQ를 동일하게 고정한다. 현재 스튜디오에는 기기별 EQ 기능이 없다. EQ를 평가하려면 별도 실험 조건으로 둔다.
3. `/mushra`에서 A/D와 선택적인 B/C를 입력한다. 도구는 숨은 reference와 3.5kHz low-pass anchor를 추가하고 순서를 섞는다. 길이 차이가 50ms를 넘거나 측정에 실패하면 세션을 만들지 않는다.
4. 입력과 anchor의 서버 측 BS.1770 LUFS-I, 추정 true peak를 측정한다. 가장 조용한 입력보다 크지 않으며 모든 출력의 추정 peak가 −1dBTP 이하인 공통 목표로 재생 이득을 낮춘다. 저장 JSON에 원래 측정값과 적용 이득을 남긴다. 디코더/OS/기기 처리 이후의 음량을 측정한 것은 아니다.
5. 샘플 전환 시 현재 재생 시각을 이어받는다. 이 기능은 샘플 단위의 무중단 전환이나 파일 간 자동 지연 보정이 아니다. 헤드폰·시스템 볼륨·청취 위치를 고정한다.
6. 외재화, 폭, 깊이, 음색 보존, 아티팩트를 각각 평가한다. 잔향의 증가와 머리 밖에 위치하는 느낌을 별개로 설명하고 사전 연습을 제공한다. 본 도구는 공식 MUSHRA 적합성 검증 도구가 아니다.
7. 여러 음악·청취자·반복 세션을 사용한다. 실험 전 주 평가 항목과 비교(B↔C, C↔D), 제외 기준을 정한다. 청취자별 대응 차이와 불확실성을 보고하며 단일 평균값으로 개선을 단정하지 않는다.

파일·설정·출처·모델 버전·기기·브라우저·청취자 익명 ID·반복 순서를 보존한다. 도구의 EQ 기록은 자기보고이며 실제 파일의 EQ를 판별하거나 수정하지 않는다.

## 자동 검증과 한계

2026-09-15 Windows 로컬 검증: Python 29개, Node DSP 4개, Playwright 96개 통과·2개 조건부 건너뜀. Chrome/Edge/Firefox 전체 테스트와 WebKit smoke 테스트를 실행했다. `core.autocrlf=true`와 `false`로 각각 새 체크아웃을 만들어 자산 19개의 크기·SHA-256 일치를 확인했다. 이는 Linux 실행 결과를 대신하지 않으며 Linux 실행은 추가한 CI job에서 별도로 확인한다.

```sh
npm run check
npm run test:audio
npm run test:e2e
```

Python은 backend·자산·출력 계측·취소 처리를, Node는 합성 신호 DSP 회귀를 검사한다. Playwright는 브라우저 렌더링·합성 stem·청취 도구를 검사한다. 임펄스 QA의 `ignoreStems: true` 결과는 full-mix 경로 진단이다. Demucs 모델 추론, 실제 음악의 전 구간 품질, 사람의 청취 결과는 이 테스트만으로 검증되지 않는다.

## 2026-10-19 구조 재설계 검증

재생 명령·그래프 수명, DSP 렌더 계획, 화면 상태, 분석 작업 수명을 분리했다. 오프라인 보정은 재생 설정을 임시 변경하지 않는다. 기존 분리 모델·추론 설정·DSP 계수·CSS는 이번 재설계에서 유지했다. 설계 결정과 공식 자료는 `ARCHITECTURE.md`에 기록했다.

- `npm.cmd run check`: 통과.
- Python 33개, Node 8개 통과. 추가 검사는 분석 프레임의 독립 계산과 수치 일치, 작업 교체·취소, 대기 중 재생 명령 취소, 그래프 타이머 정리, 렌더 설정 격리와 PCM 공유를 확인한다.
- 전체 Playwright 재실행: Chrome·Edge·Firefox 및 WebKit smoke를 포함해 114개 통과, 기존 조건부 2개 건너뜀. 일시정지 글리프를 기존대로 복구하고, 소스 문자열을 세던 검사는 실제 생성된 compressor 노드 수를 검사하도록 수정했다.
- 동일 신호 5조건의 이전/이후 브라우저 렌더: 24/44.1/48/96 kHz, mono/stereo, 0/1/4/6 stem, 측정 BRIR와 합성 fallback, full/balanced/safe 조건을 분산해 검사했다. 조건별 노드 수는 94/178/204/285/127로 동일하다. 최대 절대 PCM 오차 1.87e-7, 최대 상대 RMS 오차 1.86e-6. 브라우저 네이티브 렌더의 작은 수치 차이는 남으며 비트 동일이라고 주장하지 않는다.
- 1480/1000/390px × 밝은/어두운 테마, 6-stem 로딩 상태: 시각 상태가 안정된 뒤 비스크립트 DOM 175개와 가상 요소의 computed style 일치. 애니메이션만 비교 중에 비활성화했고 스크린샷을 확인했다.

### 성능 측정 범위

동일한 194.6077초 파일(SHA-256 `c5d4302bd4c6f07ed35153527c8e739963cf63e989af0ad52cdf58701752a488`)과 기존 Demucs 분리 캐시를 사용했다. 같은 프로세스에서 양쪽을 예열한 뒤 실행 순서를 번갈아 3회씩 측정한 중앙값은 4.8435 → 4.6769초(약 3.44% 단축)다. 시간 필드를 제외한 전체 분석 payload는 동일하다. 최초 모델 추론을 다시 측정한 결과가 아니며, 최초 분석 1분 달성을 입증하지 않는다.

STFT·RMS·영교차율·chroma만 계산한 별도 180초 신호 벤치마크는 198.66 → 111.43ms, Python 추적 할당 피크는 111.18 → 53.21MB다. 출력 4종은 비트 동일하다. 전체 서버 RSS나 전체 곡 분석의 44% 단축을 뜻하지 않는다. 1초·30초 입력도 수치 일치를 확인했다. 머신 부하와 입력에 따라 시간은 달라진다.

로컬 상세 보고서는 `data/outputs/_benchmarks/redesign-feature-performance.json`, `redesign-analysis-performance.json`, `redesign-e2e-final.log`에 있다. 비교 기준은 Git HEAD가 아닌 작업 시작 시점의 `redesign-before` 스냅샷이다. 추출한 모든 모듈을 포함하면 핵심 소스 바이트는 351241 → 385053으로 증가했다. 전체 코드 절반 축소는 달성하지 않았으며 파일 분할을 코드 삭제로 계산하지 않았다. 청취상의 개선 여부는 이 구조 변경의 자동 검사만으로 결론내리지 않는다.

## 2026-10-19 v125-open-field 검증

직접음과 독립 후기장은 유지하고 초기 공간 버스·hall 반사·venue tail 비중과 공간 대역 필터를 조정했다. 상세 값·측정·논문 출처는 `BINAURAL_SCENE_RESEARCH.md`의 v125 항목을 참고한다. 렌더 키와 정적 JS URL을 갱신했다. 추가 오디오 노드나 새 실행 의존성은 없다.

구문 검사 통과. 기존 톤·보컬 위상·바이노럴 검사 15개 통과. 전체 브라우저 실행은 111개 통과·기존 조건부 2개 제외였고, 이전 공간 버스 이득 범위를 기대하던 3개는 새 목표 범위로 갱신 후 모두 통과했다(총 114개 통과). 톤 응답 허용 범위 1.5 dB와 위상·피크·중지/모드 전환 기준은 변경하지 않았다. 로그는 `data/outputs/_benchmarks/open-field-audio-tests.log`, `open-field-e2e.log`, `open-field-routing-recheck.log`에 보존했다.

48 kHz 임펄스의 이전/이후 분리 경로 비교에서 직접음과 독립 후기장 PCM은 정확히 같았으며, 공간 버스 에너지는 BRIR 유무에 따라 약 2.5~3.6 dB 감소했다. 사용자 곡의 청감 검증을 대체하지 않는다. 현재 사용자가 음악을 선택한 Chrome은 새로고침하지 않고 보존했다. 적용은 새로고침 후 음악 재선택으로 완료된다.

## 2026-10-19 v126-immersive-dynamics 검증

변경 근거·튜닝 값·제한·정량 비교는 `BINAURAL_SCENE_RESEARCH.md`의 v126 항목에 기록했다. 직접음은 유지하고 후기장의 시간 밀도·상승·주파수별 감쇠를 조정했다. 보정 첫 단계의 압축 전 피크 측정과 고정 헤드룸 이득으로 정상 재생에서의 과도한 makeup gain을 줄인다. 실제 출력의 비상 peak guard는 유지했다.

최종 비교는 브라우저 캐시를 우회해 v125와 현재 파일을 공급했고, 양쪽 FIR 길이가 모두 0.72초임을 확인했다. BRIR 유/무의 큰 burst 신호에서 출력 강약 차이는 이전 약 11.57dB에서 입력과 같은 12.04dB로 유지됐다. 상대 비선형 오차는 약 -29.5dB에서 -125dB 이하로 줄었다. 직접음 PCM 최대 차이 0, 노드 수 94/102로 동일했다. 후기장/초기장 에너지 비율은 약 0.85~0.88dB 증가했다. 고정 이득으로 피크 여유를 확보한 결과 해당 자극의 RMS 음량은 원본보다 약 1.8dB 낮았다. 전체 음원의 보편적 결과나 청취 평가를 뜻하지 않는다.

`npm.cmd run check` 통과. Python 33개·Node 8개 통과. `immersive-e2e-final.log`: 브라우저 전체 114개 통과·기존 조건부 2개 제외. 최종 FIR 길이 조정 후 `immersive-final-audio-routing.log`: 톤·위상·방향음·stem 라우팅 18개 통과. 기존 톤 범위 1.5dB와 정상 레벨 매칭 오차 0.1dB 기준을 유지했다. 처음 검증에서 발생한 0.25dB 매칭 오차를 수정한 뒤 전체 검사를 다시 실행했다. 별도의 최초 전체 실행은 Firefox 종료 대기 중 중단했고 최종 실행은 정상 완료했다. 측정 로그는 `immersive-sustained-final.log`, 요약 JSON은 `immersive-sustained-final.json`이다.

현재 열려 있는 사용자 곡은 새로고침하지 않고 보존했다. 새 렌더 버전 적용에는 새로고침 후 곡 재선택이 필요하다. 위 지표는 청취자의 개방감·자연스러움·실재감을 직접 입증하지 않는다.

## 2026-10-19 Original → Spatial 음량 맞춤

사용자가 직접 바꾼 후기장 `send: 0.4` 등 공간 설정을 유지하고 Original 재생에 곡별 고정 이득을 추가했다. 빠른 보정은 최종 톤 보정·이득을 적용한 대표 구간을 추가 렌더해 실제 출력 RMS 비율을 구한다. 정밀 보정은 기존 최종 검증 구간을 재사용하고 최종 적용 이득 차이를 반영한다. 중앙값을 `originalMatchGain`으로 보관한다. 원본의 곡 전체 추정 피크와 구간 샘플 피크를 함께 사용해 증폭 상한을 제한한다. 따라서 피크 여유가 부족하거나 곡의 구간별 특성이 다르면 음량이 완전히 같지는 않을 수 있다. RMS 기준의 대표 구간 맞춤이며 BS.1770 LUFS 전체 곡 매칭이라고 주장하지 않는다.

Original 그래프는 원본에 하나의 고정 gain만 적용하며 EQ·공간 처리·컴프레서는 없다. Transport의 fade 목표 이득에도 같은 값을 사용한다. 보정이 끝나기 전에 Original을 재생한 경우 기존 전환 경로로 새 이득을 반영한다. 이미 보정된 HQ Spatial 버퍼를 재생할 때는 Original 맞춤 이득을 적용하지 않아 이중 감쇠를 방지한다. Spatial DSP 계수와 캐시 키는 변경하지 않았다. 새 JS URL을 사용하며 적용에는 새로고침과 음악 재선택이 필요하다.

공식 [Web Audio GainNode 규격](https://www.w3.org/TR/webaudio-1.0/#GainNode)을 참고했다. 48kHz mono tone과 진폭이 다른 burst, 각각 빠른/정밀 보정의 4조건에서 Original·Spatial의 동일 2초 구간 RMS를 비교했다. 음량 차이 절댓값은 0.001dB 미만, 원본×고정이득 대비 파형 오차는 1e-7 미만이었다. 캐시 Spatial gain은 1이고 캐시 전후 음량 차이는 0이었다. 자동 검증 스크립트와 결과는 `data/outputs/_benchmarks/verify-original-match.js`, `original-match-signal-final.log`에 보존했다.

구문 검사 통과. Node 렌더 계획·수명 검사 5개 통과(추가 검사는 Original gain·PCM 공유·캐시 unity·보정 실패 fallback을 확인). Original/Spatial 맞춤·실제 전환·HQ 캐시 관련 브라우저 검사 10개 통과, 기존 조건부 2개 제외(`original-match-targeted.log`). 전체 브라우저 실행은 106개 통과·2개 제외·8개 실패였다(`original-match-e2e.log`). 실패 항목은 Chrome/Edge/Firefox의 기존 서라운드 에너지 상한·고정 send 범위와 Chrome/Edge의 공간 폭 비율 기준이다. 현재 `send: 0.4`에서 기존 튜닝 기준을 초과했으며, 이번 음량 요청에서 공간 계수나 해당 검사 기준을 변경하지 않았다. 전체 검사가 모두 통과했다고 보고하지 않는다.

## 2026-10-19 v127-natural-vocal-spread

보컬이 중심에만 붙어 있는 느낌을 완화하기 위해 `SPATIAL_SCENE_SEPARATION.envelopmentVocalLift: 0.16`을 추가했다. Stem 장면에서 `vocalSceneSum`을 이 값 × 기존 장면 이득 0.86으로 독립 후기장의 입력 gain에 추가 연결한다. 기존 venue 경로의 보컬 기여와 합쳐 후기장에 들어가는 상대 보컬 이득이 약 0.12 → 0.28이 된다. 실측 BRIR·초기 반사·직접음 경로는 바꾸지 않았다. 신호 기반 pan·ducking이나 즉시 역극성 보컬 복사도 추가하지 않았다. 사용자가 조정한 전체 send 0.4, 보컬 room scale 0.82, field 보컬 0.4 등은 유지했다. 보컬 stem이 없는 full-mix fallback에는 이 경로를 추가하지 않는다.

비교 기준은 작업 시작 시점의 `data/outputs/_benchmarks/vocal-spread-before/`다. 캐시를 우회해 이전/현재 JS를 각각 공급하고 48kHz mono 보컬 모사 신호(180/540Hz, 고정 진폭 변조), 보컬 임펄스, 악기 stem 단독을 렌더했다. 보컬의 80ms 이후 side 에너지는 약 6.934dB 증가했고 side/mid 비율은 -31.85 → -24.94dB였다. 직접음만 분리한 PCM 차이는 0, 초기 80ms 임펄스 차이는 약 9.95e-12, 악기 단독 차이는 약 2.61e-8이었다. 보컬 신호 샘플 피크는 0.04258 → 0.04359, 그래프는 127 → 128 노드로 gain 노드 하나가 추가됐다. 컨볼루션은 추가하지 않았다. 이 측정이 실제 가창 음원의 자연스러움을 보장하지는 않는다.

`npm.cmd run check` 통과, Node 수명·렌더 계획 검사 5개 통과. 보컬 위상·공통 직접음·톤·Original·모드 전환 관련 브라우저 검사 18개 통과(`vocal-spread-tests.log`). 이번에는 전체 검사를 다시 실행하지 않았으며 이전 항목의 사용자 공간 설정 관련 전체 검사 미통과 기록은 남아 있다. 신호 비교는 `vocal-spread-signal.log`, 스크립트는 `compare-vocal-spread.js`에 보존했다. 새 렌더 키와 JS URL을 적용했으므로 새로고침 후 곡 재선택이 필요하다.

## 2026-10-19 v128 사방 확산 검증

16방향 독립 공간 필드와 52ms 이후 전이 구간을 도입했다. 상세 값·연구 근거·측정 범위는 `BINAURAL_SCENE_RESEARCH.md`의 v128 항목을 참고한다. 사용자의 send 0.4를 유지했으며 직접음·원본 강약 관계·Original 음량 맞춤·컨볼버 수·FIR 길이는 보존했다.

구문 검사 통과. Node 렌더 계획·수명 검사 5개 통과. 보컬/악기 직접음·위상·톤·Original·모드 전환 관련 브라우저 검사 18개 통과(`panoramic-audio-tests.log`). 방향 수·시작/종료 지연·필터·전이 구간 여부에 대한 기존 라우팅 assertion은 새 동작에 맞춰 갱신했다. 기존 사용자 공간 계수에 따른 전체 검사 실패 기록은 그대로 남아 있으며 이번에 전체 검사를 재실행하지는 않았다.

이전/현재 직접 렌더 비교는 `compare-panoramic.js`, 강약 비교는 `compare-panoramic-dynamics.js`, 음량·캐시 비교는 `verify-original-match.js`로 실행했다. 직접음 차이 0, 첫 50ms 차이 1.57e-9 이하, 입력 강약 차이 12.0412dB 유지, 입력 대비 출력 crest 차이 약 0.02dB 이하였다. 50~80ms 독립 공간 성분이 늘고 방향 범위가 전후·상하를 포함하게 됐다. 음량 기준 4조건 차이는 0.001dB 미만이었다. 측정 결과를 주관적 공간감의 배수 증가로 환산하지 않는다.

렌더 키 `v128-panoramic-surround`와 JS URL을 갱신했다. 적용에는 열린 화면 새로고침과 음악 재선택이 필요하다. 사용자 청취 중인 화면을 강제로 새로고침하지 않았다.


## 2026-10-19 v129 large surround sphere

Request: a more distant, enclosing 360-degree sphere. The independent 16-direction field now derives arrival delays from `SPATIAL_SURROUND_SPHERE.radius = 16` metres, using `2 * radius * pathScale / speedOfSound`; path factors 0.9?1.5 produce 84?140 ms arrivals. This is a virtual reflected-field boundary, not an exact physical sphere simulation or a guarantee of perceived source distance. Direct HRTF rendering remains unchanged. Nearby coherent room gain decreases from 0.30 to 0.22; late send remains the user's 0.40. FIR cache and pipeline versions change so old processed audio is not reused.

Before/after synthetic offline renders, measured BRIR on/off (`data/outputs/_benchmarks/sphere-dynamics.log`): direct PCM error 0; late energy centroid 143 ms -> 168 ms; late IACC about 0.084?0.086 -> 0.058. Fourfold input amplitude produces 12.0412 dB output change; crest factor 18.13?18.14 dB versus input 18.02 dB; sample peak 0.8414. These measurements support timing, separation and dynamics preservation on the test signals, not a subjective listening result. Node counts remain 94/102 and FIR duration remains 0.72 s; timing measurements are noisy and do not establish a speed improvement.

Validation: npm run check; 5 Node render-plan/lifecycle tests; 18 Chrome/Edge/Firefox phase, tone, Original matching and playback transition checks pass. Additional four Original matching cases differ from Spatial by less than 0.001 dB, cached Spatial gain remains 1. Full suite not repeated; previously documented eight custom-tuning bound failures remain unresolved. Refresh and reselect the track to load the new renderer and invalidate prior cached renders.


## 2026-10-27 v130: reduced adaptive reverb and playback priority

Late field send was user-tuned to 0.57 at inspection. It is now 0.22 multiplied by a fixed per-track scale of 0.55?1 derived from section density, crest factor and vocal presence. Dense vocal material receives less added reverb than sparse dynamic material. This is deterministic feature-based tuning, not a trained preference model or an estimate of an optimal subjective setting. Late envelope decay decreases 0.78 -> 0.58 s, high-frequency decay 0.30 -> 0.24 s, measured venue-tail gain 0.24 -> 0.14. These are envelope parameters, not measured full-output RT60. Direction layout, sphere radius, user width 7.2/side energy 3.6 and direct path remain unchanged. v130 invalidates existing processed-song cache entries.

Long offline cache rendering previously could continue after playback began; its initial idle check did not protect later playback. TaskScope.renderWhenIdle schedules offline suspension checkpoints every 0.5 rendered seconds. During playing/desired playback it waits, then resumes when idle; stale renders disconnect and release at the next checkpoint. Unsupported suspend implementations skip automatic full-song cache building. Short impulse QA is deferred if playback is already active. AudioContext requests 150 ms latency (browser may choose another value); this trades a little response latency for buffering, without changing sample rate or DSP fidelity.

Validation: syntax checks; six Node render-plan/lifecycle/adaptive tests; 18 existing Chrome/Edge/Firefox phase, tone, Original matching and playback transition tests pass. A real Chromium OfflineAudioContext pauses at 0.50133 s while busy, resumes with PCM error 0, and releases a cancelled render exactly once (`adaptive-idle.log`). Additional four Original gain-matching renders differ from Spatial by <0.001 dB, cached Spatial gain stays 1 (`adaptive-original-match.log`). These checks do not establish dropout-free playback under arbitrary OS/GPU/CPU load or a subjective optimal reverb setting. Prior full-suite tuning-bound failures were not rerun. Sources for API scheduling and latency semantics: https://developer.mozilla.org/en-US/docs/Web/API/OfflineAudioContext/suspend and https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/AudioContext .


## 2026-10-27 playback continuity follow-up

The previous change prevented an offline render from competing continuously with live playback, but left the expensive real-time Spatial graph as the usual playback path when no cache was ready. Spatial start now waits for cache restore or completes the same full-quality offline render before playback. The resulting cached graph uses one buffer source instead of the full live effect graph. Cache WAV encoding is also completed before pending playback starts. Playback controls remain disabled through calibration, and stop invalidates a pending start. This can increase initial wait; long tracks beyond the cache memory cap, unsupported browsers or render failures retain live DSP. Switching from already-playing Original still uses live DSP if no cached Spatial render is ready. No claim is made that this fixes device or OS-level underruns.

Chromium synthetic 4-second integration check: Spatial started with cachedSpatial=true, cache status ready, 3 graph nodes; lifecycle stop-during-preparation test passed. Existing 18 Chrome/Edge/Firefox phase/tone/mode checks passed; no user-machine load or subjective listening test was performed.


## 2026-10-27 project optimization audit

Audited upload/analysis, FFT features, stereo placement, GPU separation, graph/calibration, transport, UI updates and HQ cache. Kept the existing model, DSP tuning, analysis window, and visual design. Stereo-band reduction now contracts directly without allocating a full weighted spectrogram per instrument and channel; tempo autocorrelation computes only supported BPM lags. Calibrated render plans reuse the same mixture-consistency measurement, invalidated when source, stem buffer or alignment changes. Automatic HQ build starts 250 ms after cache lookup instead of waiting eight seconds, while yielding to active playback. New HQ records store bounded planar Float32 chunks, removing whole-track WAV interleave and decode; previous WAV records remain readable. Buttons can be used while final calibration runs; Spatial starts after calibration and pre-render finish.

Measured locally on 60 s synthetic 22.05 kHz stereo, including stereo STFT: old 0.483/0.644 s, new 0.323/0.353 s (small sample, not a whole-pipeline speed claim); maximum rounded position output change 0.0001. Real 194.6 s fixture full result comparison: 20 numeric entries changed by at most 0.0001, all in stereo position curves; no non-numeric changes. One cold measurement gave feature time 10.276 -> 9.199 s, but is not sufficient for a reliable end-to-end speedup claim. Original NP autocorrelation and bounded-lag tempo agree on tested inputs. At 96 kHz / 50 s, new planar cache round-trip exactly reproduced PCM; legacy WAV also decoded, and store/restore single-run times were about 60/52 ms. In a separate three-run experiment old WAV encoding alone took 116?132 ms and old decode took 131?133 ms; new cache store including IndexedDB took 105?126 ms and restore including read took 49?52 ms, with storage conditions differing. Ten repeated cached mixture checks took 1.1 ms versus 6.6 ms for the first check, in one synthetic browser run; these figures are not playback CPU measurements.

Validation: npm check, 37 Python and 12 Node tests passed; real-browser large cache and legacy roundtrip passed. Full suite first run: 98 pass, 16 fail, two skip; this used the old cache test expectation before updating it, and contains stale assumptions about user tuning and live DSP graphs as well as timing failures from the previous pre-render change. After updating cache expectations and allowing first playback preparation to complete, targeted three-browser playback/cache checks passed 6/6; the entire suite has not yet been rerun. Some remaining live-graph/tuning assertions still need separate reconciliation rather than blindly relaxing safety thresholds. Hardware-load dropout and subjective sound quality require user listening. Restart the Python server for backend changes and refresh the browser for frontend changes.


Follow-up: one Edge playback-transition run exposed a NotSupportedError when a redundant target automation overlapped a previous fade curve during a rapid restart. The gain curve already ends at its target, so the extra target event was removed. The targeted transition test then passed in Chrome, Edge and Firefox. The preceding targeted phase/tone/Original/transition run had 17 passes and this one Edge failure; the entire 18-test selection was not rerun after the fix.
