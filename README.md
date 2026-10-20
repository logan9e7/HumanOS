# HumanOS — conversational user model

HumanOS now has a real server API, a D1 SQL database, per-user identity, 50 parameters, a trained text classifier, a versioned hypothesis ledger, correction/change feedback, and an interface connected to those records. Public hosting is preserved; personal records require ChatGPT sign-in and storage consent. There are no personality questionnaires.

See [release and operations](docs/PRODUCTION.md) for release checks, runtime limits, recovery and the remaining external launch gates.

## What works now

- Dispatch-owned ChatGPT sign-in; user IDs are read from Sites-injected request headers.
- Per-user messages, observations, hypotheses, feedback and revision records in D1.
- A 50-parameter catalog; unknown values stay unknown.
- Trained CPU-only GoEmotions classifier with server-side weights, plus conservative explicit-signal extraction.
- Exact conversation quotes and message IDs for observations; negation is counter-evidence.
- Historical experiences remain historical; work, family and social contexts are separate.
- Provisional hypotheses with supporting evidence, counter-evidence and alternative interpretations.
- Distinct feedback for an incorrect interpretation versus a user who has changed.
- Time-dependent relevance, duplicate-evidence suppression, and transparent model labels.
- Full paginated data export without a per-table cutoff, cursor-based history, memory pause/resume and deletion from the active database.
- Public privacy/terms pages and a dedicated Data & privacy section.
- Persistent per-user and shared usage limits, bounded AI reservations, circuit breaker, protected operational metrics and release/live-check workflows.
- Idempotent message requests, per-user update locks and a limit of 80 messages per UTC day.
- Groq structured-output extraction/dialogue, strictly server-side and separately opt-in per user; the Gemini adapter remains available.

## Runtime and free-tier architecture

The site uses the supplied Vinext/React/Cloudflare Workers server runtime with Sites-provisioned D1. No separate Render, Neon, Supabase or model service was provisioned. The baseline classifier has no per-request external API cost. Sites access/hosting remains subject to the user's existing platform terms and quotas.

The public site can be loaded anonymously. `/api/catalog` and `/api/health` are public. All user data endpoints require the stable Sites-authenticated user ID, and every query includes that user ID. Caller-supplied body IDs never establish identity. Cross-origin mutations are rejected. D1 migrations run through Sites before the Worker is deployed. No schema is created during requests.

## Exact AI status

**Running:** TF-IDF + one-vs-rest logistic regression trained on Google Research's GoEmotions train split. English Reddit text is not a validated proxy for a person's internal state. A high model output is an uncalibrated text-classification score, not a probability that the person has an emotion. Baseline extraction abstains on quotations, hypothetical text and obvious third-person reports. Some explicitly stated parameters are captured by reviewed patterns. Most parameters will remain unknown until supporting language appears. A single mood never becomes a fixed personality score.

**Fallback replies:** authored templates chosen from the supported context when external processing is off or a provider request fails. Each message identifies its actual model or baseline.

**Configured provider:** Groq, using `openai/gpt-oss-20b`. The key is stored only as a secret in Sites runtime settings. A real synthetic-input request through `server/provider.ts` returned a valid reply and a grounded anxiety observation. The key is never included in this repository, frontend bundle, model artifact, documentation, or logs.

Each signed-in user explicitly enables external processing. The provider receives the current message, up to eight recent messages (each capped at 1,500 characters), and up to eight provisional hypotheses. This choice is visible directly above the conversation and can be disabled under Behind the model. No private conversation is used to retrain the baseline.

Server-only configuration:

- `AI_PROVIDER=groq`
- `GROQ_API_KEY`: secret, set in Sites runtime settings.
- `GROQ_MODEL=openai/gpt-oss-20b`

The optional Gemini adapter uses `AI_PROVIDER=gemini`, `GEMINI_API_KEY`, and `GEMINI_MODEL`. Provider selection is explicit and fail-closed: an unknown provider cannot redirect a key to another service.

Groq requests use its official Chat Completions endpoint with strict JSON Schema and constrained output. Every observation is then independently checked against the 50-parameter catalog and exact source text. Unsupported or invented evidence is discarded. Requests have a timeout and a visible local-ML fallback. Regular tests mock provider responses; `scripts/verify-provider.mjs` can make one real synthetic request when a key is supplied through hidden stdin. The supplied key was verified with the provider model catalog and the real inference request.

## Repository and current progress

Source: https://github.com/logan9e7/HumanOS

Live app: https://humanos-personality-lab.daringscout1.chatgpt.site

The repository contains the interface, server API, D1 schema/migrations, trained model weights, reproducible training script, and backend tests. Sites retains the deployment source repository; the GitHub repository is a synchronized source snapshot, not an automatic deployment pipeline. Runtime secrets and private database contents are not synchronized to GitHub.

Clean local clone (Node 24 and the pinned pnpm version):

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm dev
```

The clean clone selects the portable profile automatically. Generate/build and apply local D1 migrations using the supplied starter commands before testing persistent writes locally. Local and hosted databases are separate. The local-only sign-in shim never ships in production.

## ML artifact and evaluation

See `ai/models/model-card.json` for exact metrics, source, limitations and SHA-256. The trained weights are in `ai/models/emotion-model.json`; only the server imports them.

- Training examples: 43,410
- Development examples: 5,426
- Held-out test examples: 5,427
- Labels: 28 (27 emotions plus neutral)
- Features: 7,000 TF-IDF unigrams/bigrams
- Test micro-F1: 0.5454
- Test macro-F1: 0.4175
- Test micro-precision: 0.5245
- Test micro-recall: 0.5680

Thresholds were selected on the development split only. Conservative profile suggestions use a higher minimum score and remain tentative. A parity test compares JavaScript inference to separately exported scikit-learn predictions. Metrics measure this dataset task, not personality inference, medical accuracy, or product usefulness.

Reproduce training with Python, NumPy and scikit-learn using `ai/training/train.py`. Download the official `train.tsv`, `dev.tsv`, `test.tsv`, and `emotions.txt` files from Google Research's GoEmotions `data/` folder and supply the directory with `--data`. Private data is not an input. Current training script works with one process to avoid read-only memory-map incompatibilities in this runtime. Model artifact distribution retains the upstream Apache-2.0 license and attribution; source texts originate from Reddit.

Primary references:

- Dataset/paper: https://aclanthology.org/2020.acl-main.372/
- Source/data: https://github.com/google-research/google-research/tree/master/goemotions
- Gemini structured output: https://ai.google.dev/gemini-api/docs/structured-output

## Parameter groups (10 each)

- Emotion: stress, anxiety, sadness, anger, frustration, loneliness, emptiness, joy, excitement, calmness.
- Appraisal: perceived control, uncertainty, belonging, perceived rejection, disappointment, hope, overwhelm, self-confidence, nostalgia, regret.
- Resources: energy, sleep quality, mental load, motivation, interest, boredom, need for connection, rest, autonomy and achievement.
- Patterns: novelty seeking, planning preference, spontaneity, social engagement, reflection, assertiveness, conflict avoidance, reassurance seeking, persistence, direct-feedback preference.
- Life and memory: positive news, negative news, trip memory, dance memory, meaningful memory, proud moment, loss/separation, relationship change, current goal, life transition.

These are a versioned starting catalog, not clinical scales. Hormone levels and diagnoses are excluded. State evidence uses a shorter relevance half-life than preference evidence; all half-lives and evidence-strength thresholds are initial engineering heuristics. They need real-user evaluation. The hypotheses are generated from retrieved evidence, not automatically validated psychological beliefs. Similar paraphrases may still be separate episodes; current duplicate suppression handles normalized exact repeats.

## Data model

`db/schema.ts` defines seven user-owned tables (`profiles`, `messages`, `observations`, `hypotheses`, `feedback`, `revisions`, `quotas`) and two operational tables (`usage_buckets`, `app_metrics`). Append-only migrations live in `drizzle/`, including Drizzle metadata. Do not edit applied migrations. User correction retracts the affected interpretation's observation links; the original message remains available in the private export. Old hypothesis versions are retained with `superseded_at`. User change and wrong inference are stored as different revision kinds. The UI loads 40 messages per cursor page, 600 recent working observations and 100 current hypotheses/revisions. All linked evidence for a hypothesis can be loaded. Complete exports use revision-checked pages of 200 records per request with no table cutoff; concurrent changes abort the export safely. Operational counters are excluded from personal exports and contain no message content.

Mutations use a per-user D1 lock with a stale-lock deadline. Provider calls have a shorter timeout. Profile updates, messages and evidence are committed together via D1 batch transactions. Model requests are bounded. Anonymous visitors cannot access or mutate a user profile. User-input text is rendered by React as text; no raw HTML interpolation is used.

## Source map

- `server/parameters.ts`: versioned 50-parameter catalog and observation contract.
- `server/classifier.ts`: CPU-only inference from trained weights.
- `server/inference.ts`: explicit evidence extraction, negation, timeframe/context handling, relevance and hypothesis building.
- `server/provider.ts`: Groq/Gemini structured-output adapters and bounded provider calls.
- `server/history.ts`, `lib/export-data.ts`: paginated history and complete, revision-consistent export.
- `server/operations.ts`: HMAC quotas, model budgets, circuit breaker and aggregate metrics.
- `docs/PRODUCTION.md`: operations, recovery and honest release gates.
- `server/api.ts`: auth boundaries, limits, D1 operations, corrections, exports and deletion.
- `app/api/[...path]/route.ts`: hosted server route.
- `db/schema.ts`, `drizzle/`: database definitions and migration history.
- `app/HumanOS.tsx`: connected chat, 50-parameter explorer, hypothesis/evidence/revision views and data controls.
- `tests/backend.test.ts`: integration tests against real in-memory SQLite implementing the D1 interface.
- `ai/training/train.py`, `ai/models/`: reproducible training and real learned model artifacts.

## Validation

```
npm run typecheck
npm test
```

The expanded backend suite covers model parity, unknowns, attribution, negation, historical evidence, consent, authentication, cross-origin rejection, private user isolation, persistence, idempotency, duplicate evidence, correction versus change, confirmed preferences, full deletion, update locks, quotas, provider validation and provider fallback.

Build through the Sites helper; retain the `sites()` integration in `vite.config.ts`. Browser/visual QA is unavailable because the managed control-browser skill is not installed. No actual browser-flow verification is claimed. Anonymous live HTTP health/auth checks and native D1 provisioning checks should be performed after deployment.

The earlier Mira character sandbox exists in Git history. Its device-local fictional world is not silently imported into this human profile; it is not evidence about the user.
