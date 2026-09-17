# Phase 0 evidence

## Locked text AI provider

- Provider: MiniMax OpenAI-compatible Chat Completions API.
- Base URL: `https://api.minimaxi.com/v1`.
- Model: `MiniMax-M3`.
- Authentication: reuse the existing server-only `MINIMAX_API_KEY`; do not expose it to the browser.
- Output contract: request exactly three JSON hypotheses with types `pain`, `benefit`, and `scene`; validate with the application schema before persisting or compiling an H3 recipe.
- Image understanding is not part of the V1 text planner contract. The planner receives structured SKU facts and Brand Kit data only.
- Official API reference: https://platform.minimaxi.com/docs/api-reference/text-chat-openai
- The text endpoint was validated on 2026-08-04 with a minimal structured-output request.
- The response returned HTTP 200, `model=MiniMax-M3`, and `object=chat.completion`.
- `reasoning_split=true` separated reasoning from `message.content`; the content parsed as JSON with exactly `pain`, `benefit`, and `scene`.
- The minimum JSON contract has been verified; the experiment records real token usage for the cost baseline.

## Market inputs

- The feasibility experiment uses three real, publicly documented SKUs: Dior Sauvage Elixir, Sony WH-1000XM6/B, and Nespresso Vertuo Pop+ Titan.
- Product facts and primary images come from the manufacturers’ public product pages. They are used only for internal feasibility validation and must not be published as customer work or proof of commercial rights.
- Alipay, WeChat Pay, and Stripe were considered. The product owner selected WeChat Pay Native for the mainland-China beta; target-customer and merchant-account validation remain pending.

## Official model price baseline

Source: https://platform.minimaxi.com/docs/guides/pricing-paygo

- MiniMax-M3 standard input up to 512k tokens: ¥2.10 / 1M tokens.
- MiniMax-M3 standard output: ¥8.40 / 1M tokens.
- MiniMax-M3 cached input: ¥0.42 / 1M tokens.
- MiniMax-H3 768P output: ¥0.50 / generated second.
- The Phase 0 experiment uses nine 5-second H3 outputs: 45 generated seconds, ¥22.50 H3 list-price baseline before retries.

## Three-SKU feasibility result

Output directory:

```text
/Users/gjy/Desktop/Phase0-SKU-Creative-Test-2026-08-04T04-37-22-871Z
```

Results:

- MiniMax-M3 produced nine schema-valid hypotheses for Dior Sauvage Elixir, Sony WH-1000XM6/B, and Nespresso Vertuo Pop+ Titan.
- All hypotheses used known approved claim IDs and passed the disallowed-claim string check.
- Nine of nine 5-second MiniMax-H3 tasks succeeded.
- All nine MP4 files decode as H.264 and have an observed duration of 5.167 seconds.
- A blind MiniMax-M3 video review found at least two clearly distinct treatments for every SKU.
- Eight of nine outputs were usable as candidates.
- Dior candidate-01 was rejected because H3 introduced a generic second bottle, contradicting the single-product rule. This proves deterministic file checks are insufficient and a product-fidelity quality gate is required.

Decision: **Go with constraints.** The three-direction concept passed the technical distinguishability gate, but target-customer review is still required to prove commercial value.

## Ten-run cost and latency baseline

- H3 attempts: 10.
- H3 succeeded: 10 (100% in this small sample; not a production SLA).
- Generated duration: 49 seconds at 768P.
- Official H3 list-price cost: ¥24.50.
- Average observed H3 completion time: 161.73 seconds.
- Minimum: 111.87 seconds.
- Maximum: 336.94 seconds.
- Three MiniMax-M3 planning calls: 5,877 tokens, estimated ¥0.03294.
- Three blind video-review calls: 28,297 tokens, estimated ¥0.03906.
- Total measured model cost: approximately ¥24.572 before COS, payment fees, customer support, and production retry reserve.

Artifacts:

```text
manifest.json
answer-key.json
blind-review.csv
blind-model-review.json
technical-probe.json
phase0-summary.json
tenth-h3-run.json
candidate-01.mp4 … candidate-09.mp4
```

## Product-positioning correction

The first Phase 0 interpretation was rejected after reviewing customer utility:

```text
4–5 second H3 output = internal shot asset
30 second assembled advertisement = customer deliverable
```

The Focus ¥19.9 / Compare ¥34.9 / Full ¥49.9 hypotheses have been withdrawn and removed from the public pricing page. They priced model calls instead of a usable advertisement.

The revised product unit is one SKU Ad Pack:

```text
3 distinct 5-second Hook shots
+ 4 shared 5-second body shots
+ 1 deterministic 5-second CTA end card
= 3 assembled 30-second ads with a shared body and different Hooks
```

Unique H3 generation is 35 seconds, or ¥17.50 at the official 768P list price. Reserving two failed-shot retries adds ¥5.00. An internal ¥99 package hypothesis would leave approximately 77% model-cost gross margin before COS, music licensing, payment, assembly, support, and refunds. It must not be published before the 30-second vertical slice passes.

Launch market remains mainland China and the primary payment candidate remains WeChat Pay Native. Merchant credentials and target-customer payment validation are still blocked.

## Revised product contract

```text
SKU Product Brief
→ validate approved facts and constraints
→ rank three evidence-eligible Creative Angles and select one
→ produce 3 controlled Hook variants for the selected angle
→ generate 3 Hook shots and 4 shared body shots
→ create a deterministic CTA end card
→ assemble three 30-second 9:16 advertisements
→ quality checks
→ compare, approve, and download the SKU Ad Pack
```

The three Hook variants change only the first five seconds. The selected angle, product facts, approved claims, brand treatment, 20-second body, 5-second CTA, captions, and music remain constant.

Subsequent Reddit research found no basis for making `pain / benefit / scene` universal product categories. They remain valid Phase 0 experiment fixtures and optional Angle Library entries. The product contract now ranks SKU-appropriate angles first, then varies Hooks inside one selected angle.
