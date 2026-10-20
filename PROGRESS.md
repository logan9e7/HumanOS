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

## Layout and navigation update

- New collapsible desktop sidebar with a remembered device preference, section descriptions and model progress.
- Mobile navigation drawer keeps sign-in/sign-out available, contains keyboard focus and closes on Escape, outside click or section selection.
- Sticky workspace header, skip link and focused page headings support keyboard navigation.
- Shorter page headings, larger text, stronger contrast and a wider conversation panel.
- Context and evidence panels adapt to the available workspace width; parameter cards become a single column on small phones.
- Shared layout is isolated in `app/WorkspaceLayout.tsx`.

## Verification

- Expanded backend suite includes 39 tests covering launch hardening, large exports and recovery data.
- TypeScript checks and production build pass.
- Server-rendered layout checks pass for all four sections and both account states.
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

## Production hardening release

- Complete exports paginate across requests, remain within free-tier per-invocation query limits and reject concurrent revisions; verified with 10,005 messages.
- Conversation history uses stable keyset pagination with scroll anchoring and linked-evidence retrieval.
- Pause/resume memory, dedicated Data & privacy controls and public privacy/terms notices; legacy accounts acknowledge the revised notice.
- Persistent HMAC quotas survive profile deletion. User and service burst/day limits, conservative shared model reservation limits, circuit breaker and an AI kill switch are implemented.
- Request-body byte bounds, method/origin controls, batched SQL updates and security headers are enforced.
- Application request logs omit message/identity/IP/key data. Protected aggregate metrics and request IDs support diagnosis.
- CI and hourly live-check workflow definitions, secret/migration release scan, complete-export recovery test and operator recovery runbook are added.
- Operational secrets and limits are configured in Sites, separate from source. The existing Groq credential is preserved pending operator replacement/revocation.
- Real browser acceptance, hosted backup retention/restore and Groq account-level ZDR remain external verification gates. See docs/PRODUCTION.md.

- Production dependency audit now reports zero advisories after patching Next.js to 16.3.8 and targeted transitive packages. All 39 backend tests, TypeScript, release scans and production build pass.

## Internal model release — repository update, deployment pending

- Conversation and Data & privacy are the only main navigation sections.
- The normal client receives account choices, plain messages, history pagination and usage. Parameter definitions, hypotheses, evidence, scores, traces and model identifiers remain behind the server boundary.
- Public catalog/evidence/technical-feedback endpoints are removed. Explicit personal exports retain access to derived records.
- Past/current evidence is separated, full Unicode duplicate keys avoid prefix collisions, and provider observations require reviewed cues and server-derived polarity/time/context.
- Natural corrections can reference a reply; wrong interpretations are retracted, while changed preferences preserve historical evidence.
- Persisted memory participates in retrieval beyond the latest observation window; explicit response defaults honor directness/listening/length preferences.
- Expanded regression tests and CI validate the source update. Full validation results are recorded by GitHub Actions.
- Sites deployment is blocked by the unavailable execution environment. No new Sites version is claimed until the exact updated source is pushed and packaged through the supported workflow.
