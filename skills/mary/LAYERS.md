# LAYERS — 실패 층 정의와 정규 키

> **출처**: LLM 실패 양상 통합 분류 v3.1 (2026-07-22 스냅샷). 원본 연구 원장은 검증 완료본이 아니어서
> 공개 저장소에서 제외했고(로컬 아카이브), **이 파일이 정규 키의 단일 출처**다.
> 이 축약본도 "검증 완료본이 아니다"라는 지위를 그대로 승계한다.
>
> **용도는 두 가지뿐이다.**
> 1. FAILLOG에 적을 **층 번호와 정규 키**를 고른다
> 2. 진단 시 "지금 보이는 증상이 어느 층인가"를 좁힌다
>
> **키는 임의로 만들지 않는다.** 여기 없는 현상은 `L<n>/other`로 적고 한 줄 설명을 붙인다.
> `other`는 승격 계산에 넣지 않는다 — 이름이 없으면 재발을 셀 수 없기 때문이다.
> 같은 현상이 `other`로 3회 이상 나오면 그때 이 파일에 키를 추가한다.

---

## L0-A. 구조·인터페이스 제약
배포된 모델 인스턴스의 **입출력 계약** 때문에 남는 것. 프롬프트로 제거되지 않고 **우회만** 된다.

`frozen-weights-at-inference` · `in-context-learning-only` · `error-compounding` ·
`open-loop-generation`(기본 모델 단위 한정) · `tokenized-continuous-space` ·
`no-native-symbolic-solver` · `no-claim-level-uncertainty` · `frozen-tokenizer`

## L0-B. 학습 목적·데이터·디코딩 — 레시피에서 온 것
가역성이 균일하지 않다. **디코딩 유래**는 런타임에 개선되고, **목적함수·데이터 유래**는 완화만 된다.

`no-backtracking` · `exposure-bias` · `fluency-prior` · `ungrounded-generation` ·
`modality-gap` · `likelihood-ne-quality` · `neural-text-degeneration` ·
`sampling-nondeterminism` · `prompt-brittleness` · `option-order-bias` ·
`surface-form-competition` · `tokenization-artifacts` · `positional-extrapolation-failure`

## L0-M. 하부 메커니즘 — 증상이 아님
**FAILLOG에 쓰지 않는다.** 처방이 원리상 도출되지 않는다. 다른 층의 실패를 *설명*할 때만 인용한다.
"attention sink를 없애자"는 문장이 나오면 층을 잘못 잡은 것이다.

`superposition` · `teacher-forcing` · `attention-sink` ·
`softmax-expressivity-bottleneck` · `lm-head-gradient-bottleneck`

## L1. 학습·정렬 유인 — 보상이 만든 왜곡
모델을 못 바꾸면 프롬프트로도 거의 못 고친다. 유효 개입은 입력에서 선호 신호를 제거하는 쪽.

`sycophancy` · `answer-flipping` · `false-premise-acceptance` · `identity-conformity` ·
`social-sycophancy` · `epistemic-cowardice` · `self-preference-bias` · `sandbagging` ·
`refusal-miscalibration` · `reward-model-bias` · `goodharting` · `verbosity-bias` ·
`over-generation` · `format-bias` · `format-constraint-quality-tax` · `mode-collapse` ·
`guessing-incentive` · `clarification-suppression` · `specification-gaming` ·
`benchmark-contamination` · `annotator-bias`

## L2. 지식·사실성 — **세계** 대비
고유명사·수치·날짜는 무조건 외부 확인. 희귀 엔티티에서는 "모른다"의 사전 확률을 높게 잡는다.

`extrinsic-hallucination` · `confabulation` · `spurious-precision` ·
`long-tail-knowledge-failure` · `temporal-misalignment` · `entity-conflation` ·
`knowledge-conflict` · `prior-override` · `citation-hallucination` ·
`imitative-falsehood` · `frequency-bias` · `consensus-bias`

## L3. 충실성 — **입력** 대비
누락은 출력만 봐서는 원리상 안 보인다. 원문에서 체크리스트를 먼저 만들고 대조해야 한다.

`omission-hallucination` · `intrinsic-hallucination` · `recall-failure` ·
`ambiguity-resolution-bias` · `verbatim-copying-bias` · `constraint-violation` ·
`over-reliance-on-context` · `snippet-level-judgment` · `source-claim-misattribution` ·
`certainty-inflation` · `granularity-mismatch`

## L4. 추론 과정
CoT는 설명이 아니라 계산 예산으로만 취급한다. 자기수정은 **외부 신호가 있을 때만** 작동한다.

`cot-unfaithfulness` · `post-hoc-rationalization` · `premature-commitment` ·
`silent-error-correction` · `encoded-reasoning` · `anchoring` · `error-propagation` ·
`hallucination-snowballing` · `reversal-curse` · `compositionality-gap` ·
`shortcut-learning` · `intrinsic-self-correction-failure` · `introspection-failure` ·
`overthinking` · `underthinking` · `symbol-binding-failure` ·
`counterfactual-task-collapse` · `theory-of-mind-brittleness` · `plan-execution-mismatch` ·
`in-problem-distractor-sensitivity` · `cognitive-bias-mimicry` · `intra-output-self-contradiction`

## L5. 컨텍스트·길이 (입력 **및 출력**)
길이를 늘리기 전에 줄인다. 핵심 정보는 앞·뒤 양끝에. 다중 needle은 단일 질의로 쪼갠다.

`context-rot` · `attention-dilution` · `lost-in-the-middle` · `position-bias` ·
`compaction-loss` · `context-distraction` · `context-clash` · `context-poisoning` ·
`effective-context-shortfall` · `multi-needle-degradation` · `distractor-sensitivity` ·
`kv-cache-loss` · `chunk-boundary-loss` · `instruction-hierarchy-confusion` ·
`generation-length-coherence-decay`

## L6. 상태·장기 실행·에이전트
비가역 행동은 화이트리스트 + 확인 게이트. 확인과 실행 **사이**에 재검증을 넣지 않으면 게이트는 뚫린다.

`cross-session-inconsistency` · `instruction-drift` · `goal-drift` ·
`multi-turn-degradation` · `tool-use-hallucination` · `tool-invocation-decision-failure` ·
`error-swallowing` · `thrashing` · `runaway-cost` · `environment-state-desync` ·
`irreversible-action-without-confirmation` · `partial-failure-state` ·
`non-idempotent-retry` · `closed-loop-control-instability` · `toctou-stale-precondition` ·
`delegation-dilution` · `multi-agent-echo` · `premature-closure` · `credit-assignment-failure`

## L7. 보정·기권
언어화된 확신도 대신 행동 기반 신호. 단 합의도는 **약한 양의 상관**을 갖는 조건부 대리 지표일 뿐이다.

`miscalibration` · `failure-to-abstain` · `epistemic-aleatoric-conflation` ·
`post-rlhf-calibration-loss` · `verbalized-confidence-gap` ·
`hedging-as-pseudo-calibration` · `confidence-difficulty-inversion` ·
`repeated-error-confidence` · `calibration-domain-transfer-failure`

## L8. 검증 비대칭
검증자는 **다른 계열 모델 또는 비-LLM**(컴파일러·테스트·실제 실행·원문)이어야 신호가 된다.

`generator-verifier-gap` · `weak-verifier` · `no-grounding-signal` · `jagged-frontier` ·
`verifier-generator-correlation` · `non-verifiable-domain`

## L9. 인간 측 실패
**이 하네스의 대원칙("사용자에게 일을 시키지 않는다")과 정면으로 상충하는 층이다.**
Claude가 먼저 다 채우는 구조는 anchoring과 automation bias를 구조적으로 키운다.

`automation-bias` · `fluency-induced-overtrust` · `anchoring-on-first-draft` ·
`deskilling` · `responsibility-diffusion` · `verification-theater` ·
`parasocial-dependence` · `delusion-reinforcement` · `moral-offloading` ·
`liars-dividend` · `competence-generalization-error`

## L10. 언어·문화
한/영 답이 갈렸다는 사실 하나로 L10을 **판정하지 않는다** — 진단 신호일 뿐이다.
국내 법령·제도·판례는 예외 없이 원문 확인.

`cross-lingual-knowledge-asymmetry` · `pivot-language-leakage` ·
`non-latin-tokenization-penalty` · `language-conditioned-safety-inconsistency` ·
`weird-default` · `localization-hallucination` · `honorific-instability` ·
`script-normalization-failure` · `code-switching-failure` · `locale-format-failure`

## L11. 자기모델
모델의 자기 서술(버전·능력·수행 여부)은 **전부 외부 확인 대상**. "했다"는 부작용을 직접 관측해 검증.

`evaluation-awareness` · `self-knowledge-hallucination` · `capability-misreporting` ·
`phantom-execution` · `self-reference-contamination` · `persona-instability` ·
`anthropomorphic-slippage` · `stated-vs-revealed-gap`

## L12. 적대적·안전
프롬프트 수준 방어는 신뢰하지 않는다(best-of-N에 진다). 조건을 **끊는** 방어와
피해를 **줄이는** 방어는 종류가 다르다.

`lethal-trifecta` · `confused-deputy` · `indirect-prompt-injection` ·
`agent-hijack-irreversible` · `memory-poisoning` · `many-shot-jailbreak` ·
`crescendo-jailbreak` · `best-of-n-jailbreak` · `encoding-obfuscation` ·
`refusal-direction-ablation` · `finetuning-safety-degradation` · `backdoor-persistence` ·
`poisoning-sample-count-scaling` · `emergent-misalignment` · `alignment-faking`

## L13. 다중모달
OCR·레이아웃은 전용 파서로 처리하고 LLM에는 **구조화된 결과만** 넘긴다.
글자를 다 읽었는데 **읽기 순서**가 틀리는 실패는 OCR 정확도 지표로 안 잡힌다.

`ocr-chart-hallucination` · `document-layout-misparse` · `resolution-downscaling-loss` ·
`text-over-vision-bias` · `spatial-relational-failure` · `typographic-attack` ·
`audio-hallucination-on-silence` · `diarization-confusion` · `video-frame-sampling-loss`

## L14. 코드
테스트는 구현 **이전에** 명세에서 도출. diff는 파일 단위가 아니라 **변경 의도 단위**로 리뷰.
환각 패키지는 "레지스트리에 있는지"로 판별되지 않는다 — 공격자가 등록해 두기 때문이다.

`package-hallucination` · `version-drift` · `plausible-but-wrong-code` ·
`vulnerable-pattern-reproduction` · `secret-leakage` · `unit-dimension-error` ·
`concurrency-edge-case-blindness` · `environment-assumption-error` ·
`repo-scale-incoherence` · `test-to-implementation-fitting` · `silent-scope-creep`

## L15. 사회적 편향·기억
disparity는 단일 실행으로 원리상 안 보인다. 이름·방언·집단만 바꾼 대조군 실행이 필요하다.

`stereotype-amplification` · `implicit-bias` · `demographic-performance-disparity` ·
`dialect-penalty` · `group-conditioned-over-refusal` · `pii-regurgitation` ·
`copyright-regurgitation`

## L16. 분포 붕괴 — 집합 규모의 병리
**개별 출력 검사로는 원리상 안 보이는 층.** 다수결 합의도를 단독 신뢰도 점수로 보고하지 않는다.

`typicality-regression` · `population-scale-homogenization` · `correlated-failure` ·
`example-repetition` · `model-collapse` · `synthetic-citation-laundering` ·
`performative-feedback` · `epistemic-monoculture`

## L17. 구현·제품층
**증상이 L0~L8과 구별되지 않는다. 진단은 항상 여기부터** — 잘림·캐시·모델 ID·필터를 먼저 배제하지 않으면
파이프라인 버그를 모델 한계로 오진하고 영원히 프롬프트를 고치게 된다.

`no-cross-session-state` · `max-tokens-truncation` · `silent-context-truncation` ·
`no-wall-clock-access` · `silent-model-swap` · `quantization-degradation` ·
`system-prompt-leakage` · `memory-recall-error` · `cache-staleness` ·
`rag-index-staleness` · `pipeline-filter-false-positive` · `tool-schema-permission-mismatch` ·
`retrieval-acl-bypass` · `prompt-log-retention-leak` · `deletion-non-propagation` ·
`cross-user-attribution-error`

## L18. 평가·측정
"성능이 나쁘다"와 "성능 측정이 나쁘다"는 다른 문제다.
**FAILLOG 자신이 이 층의 위험에 노출돼 있다** — 관측된 것만 세므로 실제 분포가 아니다.

`construct-validity-failure` · `benchmark-saturation` · `llm-judge-structural-bias` ·
`single-metric-reduction` · `eval-deployment-mismatch` · `non-reproducibility` ·
`human-eval-competence-gap`

---

## 층을 고를 때 자주 틀리는 지점

| 헷갈리는 짝 | 가르는 질문 |
|---|---|
| L2 ↔ L3 | 어긋난 대상이 **세계**인가(L2) **제공된 입력**인가(L3). 둘 다 확인한다 — 사실이면서 불충실한 출력이 가장 흔하다 |
| L0~L8 ↔ L17 | 모델이 틀린 건가, **파이프라인**이 자른 건가. 먼저 L17을 배제한다 |
| L0-A ↔ L1 | **못 하는 것**(구조)인가 **안 하는 것**(유인)인가. 처방이 정반대다 |
| L0-B ↔ L0-M | 증상인가 그 증상을 만드는 **하부 기계**인가. L0-M은 FAILLOG에 쓰지 않는다 |
| L4 ↔ L5 | 무관한 절이 **문제 본문 안**에 있나(L4) **맥락 쪽**에 있나(L5) |
| L6 ↔ L11 | 실패를 덮고 성공 보고(L6)인가, 애초에 실행 없이 완료 보고(L11 phantom-execution)인가 |
| L8 ↔ L16 | 검증자가 약한 것(L8)인가, 검증자와 생성자가 **같은 편향을 공유**하는 것(L16)인가 |
