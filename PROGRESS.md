# HumanOS progress — 2026-10-20

## Working product

- Public website with ChatGPT sign-in for private per-user records.
- Conversation-led profile with 50 starting parameters; no personality questionnaire.
- Real server routes and D1 database with seven application tables.
- Trained GoEmotions TF-IDF/logistic-regression model: 43,410 training examples; held-out micro-F1 0.5454.
- Evidence references, context/time attribution, counter-evidence and alternative interpretations.
- Current hypotheses plus versioned correction and user-change history.
- Groq neural dialogue and structured extraction using openai/gpt-oss-20b, with exact-evidence validation.
- Provider credentials stored only in Sites secrets, not GitHub.
- Explicit per-user choice before external model processing; visible fallback.
- Private export/deletion, per-user locks, idempotency and daily message limit.

## Verification

- 22 backend tests pass.
- TypeScript checks pass.
- Real Groq model-list request succeeds.
- Real synthetic inference through the adapter succeeds with a structured reply and valid observation.
- Prior deployment: live health/catalog/homepage succeed, anonymous private API returns 401, and seven D1 tables verified.
- Provider update deployment follows the Sites workflow; check the live health endpoint for the active provider/model.
- Actual browser sign-in/conversation QA remains unverified because the managed browser capability is unavailable.

## Next work

- Evaluate inference, correction quality and response usefulness with consenting users.
- Broaden English-only baseline coverage and temporal/event attribution.
- Improve semantic memory retrieval and narrative change testing.
- Calibrate uncertainty on appropriate real-user evaluation data before interpreting numerical confidence.
- Validate retention and willingness to pay before adding billing.

## Important interpretation limits

Text-classification scores are not psychological measurements. Hypotheses are tentative and context-dependent. No hormone concentration, clinical diagnosis or fixed personality score is inferred. Novel-based character exercises can test belief revision but cannot validate human psychology.
