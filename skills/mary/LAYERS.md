# LAYERS — failure-layer definitions and canonical keys

> **Source**: Unified LLM failure-mode taxonomy v3.1 (2026-07-22 snapshot). The original research
> ledger is not a verified artifact and was excluded from the public repository (kept in a local
> archive); **this file is the single source of canonical keys.**
> This digest inherits that status: it, too, is not a verified artifact.
>
> **It has exactly two uses.**
> 1. Choosing the **layer number and canonical key** to write in the FAILLOG
> 2. Narrowing "which layer is the symptom I am seeing" during diagnosis
>
> **Keys are never invented.** A phenomenon not listed here is written as `L<n>/other` with a
> one-line description. `other` never counts toward promotion — what has no name cannot have its
> recurrence counted. When the same phenomenon shows up as `other` three or more times, add a key here.

---

## L0-A. Structural / interface constraints
What remains because of the **input–output contract** of a deployed model instance. Prompts do not
remove these; they only route around them.

`frozen-weights-at-inference` · `in-context-learning-only` · `error-compounding` ·
`open-loop-generation` (base-model level only) · `tokenized-continuous-space` ·
`no-native-symbolic-solver` · `no-claim-level-uncertainty` · `frozen-tokenizer`

## L0-B. Training objective, data, decoding — what the recipe causes
Reversibility is uneven. **Decoding-born** issues improve at runtime; **objective/data-born**
issues are only mitigated.

`no-backtracking` · `exposure-bias` · `fluency-prior` · `ungrounded-generation` ·
`modality-gap` · `likelihood-ne-quality` · `neural-text-degeneration` ·
`sampling-nondeterminism` · `prompt-brittleness` · `option-order-bias` ·
`surface-form-competition` · `tokenization-artifacts` · `positional-extrapolation-failure`

## L0-M. Underlying mechanisms — not symptoms
**Never written in the FAILLOG.** No prescription can be derived from them in principle. Cite only
to *explain* failures in other layers. If a sentence like "let's remove the attention sink"
appears, the layer was chosen wrong.

`superposition` · `teacher-forcing` · `attention-sink` ·
`softmax-expressivity-bottleneck` · `lm-head-gradient-bottleneck`

## L1. Training/alignment incentives — distortions reward created
If the model cannot be changed, prompts barely fix these either. Effective interventions remove
preference signals from the input.

`sycophancy` · `answer-flipping` · `false-premise-acceptance` · `identity-conformity` ·
`social-sycophancy` · `epistemic-cowardice` · `self-preference-bias` · `sandbagging` ·
`refusal-miscalibration` · `reward-model-bias` · `goodharting` · `verbosity-bias` ·
`over-generation` · `format-bias` · `format-constraint-quality-tax` · `mode-collapse` ·
`guessing-incentive` · `clarification-suppression` · `specification-gaming` ·
`benchmark-contamination` · `annotator-bias`

## L2. Knowledge / factuality — against the **world**
Proper nouns, figures, and dates are always externally checked. For rare entities, set a high
prior on "I don't know".

`extrinsic-hallucination` · `confabulation` · `spurious-precision` ·
`long-tail-knowledge-failure` · `temporal-misalignment` · `entity-conflation` ·
`knowledge-conflict` · `prior-override` · `citation-hallucination` ·
`imitative-falsehood` · `frequency-bias` · `consensus-bias`

## L3. Faithfulness — against the **input**
Omissions are invisible from the output alone, in principle. Build the checklist from the original
first, then compare.

`omission-hallucination` · `intrinsic-hallucination` · `recall-failure` ·
`ambiguity-resolution-bias` · `verbatim-copying-bias` · `constraint-violation` ·
`over-reliance-on-context` · `snippet-level-judgment` · `source-claim-misattribution` ·
`certainty-inflation` · `granularity-mismatch`

## L4. Reasoning process
Treat CoT as compute budget, not as explanation. Self-correction works **only with an external signal**.

`cot-unfaithfulness` · `post-hoc-rationalization` · `premature-commitment` ·
`silent-error-correction` · `encoded-reasoning` · `anchoring` · `error-propagation` ·
`hallucination-snowballing` · `reversal-curse` · `compositionality-gap` ·
`shortcut-learning` · `intrinsic-self-correction-failure` · `introspection-failure` ·
`overthinking` · `underthinking` · `symbol-binding-failure` ·
`counterfactual-task-collapse` · `theory-of-mind-brittleness` · `plan-execution-mismatch` ·
`in-problem-distractor-sensitivity` · `cognitive-bias-mimicry` · `intra-output-self-contradiction`

## L5. Context and length (input **and output**)
Shorten before lengthening. Key information at both ends. Split multi-needle queries into single ones.

`context-rot` · `attention-dilution` · `lost-in-the-middle` · `position-bias` ·
`compaction-loss` · `context-distraction` · `context-clash` · `context-poisoning` ·
`effective-context-shortfall` · `multi-needle-degradation` · `distractor-sensitivity` ·
`kv-cache-loss` · `chunk-boundary-loss` · `instruction-hierarchy-confusion` ·
`generation-length-coherence-decay`

## L6. State, long-running execution, agents
Irreversible actions need a whitelist + a confirmation gate. Without re-validation **between**
confirmation and execution, the gate is pierced.

`cross-session-inconsistency` · `instruction-drift` · `goal-drift` ·
`multi-turn-degradation` · `tool-use-hallucination` · `tool-invocation-decision-failure` ·
`error-swallowing` · `thrashing` · `runaway-cost` · `environment-state-desync` ·
`irreversible-action-without-confirmation` · `partial-failure-state` ·
`non-idempotent-retry` · `closed-loop-control-instability` · `toctou-stale-precondition` ·
`delegation-dilution` · `multi-agent-echo` · `premature-closure` · `credit-assignment-failure`

## L7. Calibration and abstention
Behavior-based signals over verbalized confidence. Agreement rates are at best a conditional proxy
with **weak positive correlation**.

`miscalibration` · `failure-to-abstain` · `epistemic-aleatoric-conflation` ·
`post-rlhf-calibration-loss` · `verbalized-confidence-gap` ·
`hedging-as-pseudo-calibration` · `confidence-difficulty-inversion` ·
`repeated-error-confidence` · `calibration-domain-transfer-failure`

## L8. Verification asymmetry
A verifier is only a signal when it is **a different model family or non-LLM**
(compiler, tests, real execution, original sources).

`generator-verifier-gap` · `weak-verifier` · `no-grounding-signal` · `jagged-frontier` ·
`verifier-generator-correlation` · `non-verifiable-domain`

## L9. Human-side failures
**The layer in direct tension with this harness's prime rule ("never make the user do the work").**
A structure where Claude drafts everything structurally amplifies anchoring and automation bias.

`automation-bias` · `fluency-induced-overtrust` · `anchoring-on-first-draft` ·
`deskilling` · `responsibility-diffusion` · `verification-theater` ·
`parasocial-dependence` · `delusion-reinforcement` · `moral-offloading` ·
`liars-dividend` · `competence-generalization-error`

## L10. Language and culture
That answers diverge between two languages does **not by itself establish L10** — it is a
diagnostic signal only. Local statutes, institutions, and precedents: original text, no exceptions.

`cross-lingual-knowledge-asymmetry` · `pivot-language-leakage` ·
`non-latin-tokenization-penalty` · `language-conditioned-safety-inconsistency` ·
`weird-default` · `localization-hallucination` · `honorific-instability` ·
`script-normalization-failure` · `code-switching-failure` · `locale-format-failure`

## L11. Self-model
A model's statements about itself (version, capabilities, whether it performed something) are
**all subject to external verification**. Verify "I did it" by directly observing side effects.

`evaluation-awareness` · `self-knowledge-hallucination` · `capability-misreporting` ·
`phantom-execution` · `self-reference-contamination` · `persona-instability` ·
`anthropomorphic-slippage` · `stated-vs-revealed-gap`

## L12. Adversarial and safety
Prompt-level defenses are not trusted (they lose to best-of-N). Defenses that **sever conditions**
and defenses that **reduce damage** are different kinds.

`lethal-trifecta` · `confused-deputy` · `indirect-prompt-injection` ·
`agent-hijack-irreversible` · `memory-poisoning` · `many-shot-jailbreak` ·
`crescendo-jailbreak` · `best-of-n-jailbreak` · `encoding-obfuscation` ·
`refusal-direction-ablation` · `finetuning-safety-degradation` · `backdoor-persistence` ·
`poisoning-sample-count-scaling` · `emergent-misalignment` · `alignment-faking`

## L13. Multimodal
Handle OCR and layout with dedicated parsers; hand the LLM **structured results only**.
Reading every character but in the wrong **order** is a failure OCR accuracy metrics miss.

`ocr-chart-hallucination` · `document-layout-misparse` · `resolution-downscaling-loss` ·
`text-over-vision-bias` · `spatial-relational-failure` · `typographic-attack` ·
`audio-hallucination-on-silence` · `diarization-confusion` · `video-frame-sampling-loss`

## L14. Code
Tests derive from the spec **before** implementation. Review diffs by **unit of intent**, not per file.
Hallucinated packages are not detected by "is it in the registry" — attackers register them.

`package-hallucination` · `version-drift` · `plausible-but-wrong-code` ·
`vulnerable-pattern-reproduction` · `secret-leakage` · `unit-dimension-error` ·
`concurrency-edge-case-blindness` · `environment-assumption-error` ·
`repo-scale-incoherence` · `test-to-implementation-fitting` · `silent-scope-creep`

## L15. Social bias and memorization
Disparity is invisible in a single run, in principle. It requires control runs varying only names,
dialects, or groups.

`stereotype-amplification` · `implicit-bias` · `demographic-performance-disparity` ·
`dialect-penalty` · `group-conditioned-over-refusal` · `pii-regurgitation` ·
`copyright-regurgitation`

## L16. Distributional collapse — population-scale pathologies
**Invisible to per-output inspection, in principle.** Never report majority agreement as a
standalone confidence score.

`typicality-regression` · `population-scale-homogenization` · `correlated-failure` ·
`example-repetition` · `model-collapse` · `synthetic-citation-laundering` ·
`performative-feedback` · `epistemic-monoculture`

## L17. Implementation and product layer
**Symptoms are indistinguishable from L0–L8. Diagnosis always starts here** — without first ruling
out truncation, caches, model IDs, and filters, a pipeline bug gets misdiagnosed as a model limit
and the prompt gets tuned forever.

`no-cross-session-state` · `max-tokens-truncation` · `silent-context-truncation` ·
`no-wall-clock-access` · `silent-model-swap` · `quantization-degradation` ·
`system-prompt-leakage` · `memory-recall-error` · `cache-staleness` ·
`rag-index-staleness` · `pipeline-filter-false-positive` · `tool-schema-permission-mismatch` ·
`retrieval-acl-bypass` · `prompt-log-retention-leak` · `deletion-non-propagation` ·
`cross-user-attribution-error`

## L18. Evaluation and measurement
"Performance is bad" and "the performance measurement is bad" are different problems.
**The FAILLOG itself is exposed to this layer** — it counts only what was observed, not the true distribution.

`construct-validity-failure` · `benchmark-saturation` · `llm-judge-structural-bias` ·
`single-metric-reduction` · `eval-deployment-mismatch` · `non-reproducibility` ·
`human-eval-competence-gap`

---

## Commonly confused pairs

| Confusable pair | Deciding question |
|---|---|
| L2 ↔ L3 | Is the mismatch against the **world** (L2) or the **provided input** (L3)? Check both — factually-true-but-unfaithful output is the most common |
| L0–L8 ↔ L17 | Was the model wrong, or did the **pipeline** truncate? Rule out L17 first |
| L0-A ↔ L1 | **Cannot do** (structure) or **will not do** (incentive)? The prescriptions are opposites |
| L0-B ↔ L0-M | A symptom, or the **machinery underneath** it? L0-M is never written in the FAILLOG |
| L4 ↔ L5 | Is the irrelevant clause **inside the problem statement** (L4) or **in the context** (L5)? |
| L6 ↔ L11 | Covering a failure and reporting success (L6), or reporting completion with no execution at all (L11 phantom-execution)? |
| L8 ↔ L16 | Is the verifier weak (L8), or do verifier and generator **share the same bias** (L16)? |
