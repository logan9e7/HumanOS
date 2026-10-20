# HumanOS release and operations

Updated: 2026-10-20. Verified locally: 39 backend tests, TypeScript, production build, release checks and zero production dependency advisories. Server-rendered checks cover all five navigation sections and privacy-control states. This is the operational record for the 1.0.0 hardening release. It does not certify the product for medical use or prove willingness to pay.

## Delivered safeguards

- Sites-authenticated, account-scoped API; server-side storage and provider consent; legacy accounts acknowledge the updated notice before new messages.
- Separate pause-memory, provider-disable, full export and active-data deletion controls.
- Cursor-based history (40 messages per page), complete exports in 200-record pages, revision checks to reject mixed exports and old-evidence retrieval.
- Per-user minute/day limits, shared service limits, separately bounded model requests and conservative token exposure, persistent HMAC usage counters and a provider circuit breaker.
- Typed provider schema, source-quote validation, maximum context/output, 22-second provider timeout and visibly labeled fallback.
- Bounded request-body reads, origin checks, method allowlists, parameterized SQL, batched hypothesis/feedback writes and response security headers.
- Request IDs, content-free application request logs and authenticated aggregate metrics.
- Patched Next.js and transitive packages identified by the production dependency audit; CI repeats the production audit.
- CI checks and hourly live-check workflow definitions in `.github/workflows/`. GitHub Actions must be enabled for the workflows to run. Workflow failure notifications follow the repository owner's GitHub notification settings; no separate paging service is configured.

## Runtime configuration

Use Sites runtime settings, not repository files. The current Groq key remains the provider credential; it must be replaced because it was previously pasted into chat. This integration cannot create or revoke Groq keys.

| Name | Current default / purpose |
| --- | --- |
| `USAGE_HASH_KEY` | Secret, cryptographically random; at least 32 characters. Keep stable so quota deletion cannot reset usage. |
| `OPS_TOKEN` | Independent random secret for `/api/ops/metrics`. |
| `AI_ENABLED` | `true`; set `false` and deploy to stop outbound model calls. |
| `AI_DAILY_REQUEST_LIMIT` | 200 model reservations across all users per UTC day. |
| `AI_DAILY_TOKEN_BUDGET` | 1,000,000 conservative reservation units per UTC day. |
| `USER_DAILY_MESSAGE_LIMIT` | 80 message attempts per user per UTC day. |
| `USER_MINUTE_MESSAGE_LIMIT` | 6 message attempts per user per UTC minute. |
| `APP_DAILY_MESSAGE_LIMIT` | 1,000 message attempts across the service per UTC day. |
| `APP_MINUTE_MESSAGE_LIMIT` | 60 message attempts across the service per UTC minute. |

A provider reservation is serialized request UTF-8 bytes plus 4,096 units, including headroom for the 1,800 maximum output tokens. Requests above 48,000 input bytes are rejected before sending. Reservations are not refunded after failures. This is deliberately conservative, not a measured tokenizer count or a dollar billing cap. Also configure a hard spending limit at the provider account if billing is enabled. Three failures in a five-minute UTC-aligned window suspend model requests until the next window; local replies continue.

`GET /api/ops/metrics` requires `Authorization: Bearer <OPS_TOKEN>` and exposes aggregate route/status/duration counters and model reservations, never conversation text or account IDs. Retrieve metrics with an operator-controlled client; do not put the token in a URL. Sites Worker logs provide the request IDs needed to correlate a failed request. A successful export is revision-consistent; concurrent writes make the export fail safely and ask for a retry.

## Data lifecycle

Conversation and inference records stay in D1 until user deletion. Pausing memory blocks new conversations, while existing records and correction controls remain available. This is not end-to-end encryption. Active deletion removes all seven user-owned table contents for that account; quotas are user-owned and removed too. Separate HMAC usage counters continue enforcing limits until expiry, avoiding a deletion/reconsent bypass. Daily counter rows expire after 48 hours, minute rows after two minutes, aggregate metrics after seven days; expired rows are cleaned in bounded batches during subsequent message activity. No background purge SLA is claimed.

The interface reads 600 recent observations as a bounded inference working set, and 100 latest current hypotheses/revisions. This is an engineering limit, not a claim of exhaustive semantic recall. Every stored record remains in complete exports, and all observation links for a selected hypothesis can be loaded. Exact duplicate episodes are checked against stored history. Paid-scale retrieval and validated personality inference remain separate work.

Groq receives at most eight recent messages truncated to 1,500 characters each, the current message and up to eight provisional hypotheses. The account-level Zero Data Retention setting has not been inspected or enabled through this integration. Review https://console.groq.com/docs/your-data and enable the desired setting in the Groq organization before inviting users who require that guarantee. Do not promise that deleting D1 data recalls provider processing or erases platform backups immediately.

## Release and rollback

1. Read the current Site audience; retain public access unless explicitly changed by the owner.
2. Run `npm run check:release`, `npm run typecheck`, `npm test` and the Sites build helper. Read failures and fix them before continuing.
3. Inspect only new, unapplied migrations. Applied SQL and Drizzle snapshots/journal entries are immutable.
4. Package and push the exact source with the Sites source helper, save a version and deploy it. Sites applies schema migrations before the Worker update.
5. Run `npm run smoke`. Check the migration through the native database overview and inspect recent Worker errors. Verify the active environment revision.
6. Sync the same source tree to GitHub. Verify CI runs instead of assuming workflow files executed.

If the Worker update fails after a schema migration, do not roll back the schema blindly. The 0002 migration is additive: old code can run against the new tables/columns. Deploy the last known-good saved Worker version while diagnosing. Restore data only through the supported database recovery path below.

## Recovery procedure and actual verification boundary

Cloudflare documents automatic D1 Time Travel with plan-dependent retention (7 days on Workers Free, 30 on Paid): https://developers.cloudflare.com/d1/reference/time-travel/. The deployed database is provisioned by Sites, and this connection exposes schema/row inspection but no backup bookmark or restore operation. Therefore the exact deployment retention, a hosted backup bookmark and a hosted restore drill remain unverified. Do not claim a production database backup has been restored.

A real operator with supported Sites/Cloudflare administrative recovery access must:

1. Confirm the exact deployed database identity, storage backend, region and available recovery window through the hosting administrator. Do not assume the logical binding `DB` is the provider database identifier.
2. Record a pre-change recovery bookmark and the currently live Site version using that supported interface.
3. Recover a disposable staging database containing synthetic account records, never overwrite production for a drill. Verify message, evidence, hypothesis and consent relationships and repeat private-access checks.
4. Record the restoration duration, recovered point in time, record counts and operator in the release record.
5. Before reopening a recovered production database, reapply deletion and provider-consent revocations newer than the recovery point from an appropriately protected operator record. Recovery must not silently resurrect deleted accounts or re-enable provider sharing.

Automated tests round-trip a full account export into a clean SQLite database and verify evidence relationships. That tests application recovery data, not hosted Time Travel. User exports contain personal data and must not be uploaded to this public repository.

## Browser acceptance gate

Managed `control-browser` is unavailable in this environment. No actual sign-in, keyboard, mobile, or visual acceptance is claimed. Run this using a real browser and two test accounts before a wider launch:

- Sign in, accept storage/terms, leave external AI off, send a message and refresh.
- Enable external AI, send a new synthetic message, confirm the response's provider label and evidence trace.
- Correct a hypothesis, record a changed preference, refresh and compare the revision history.
- Load earlier messages and linked evidence; verify scroll position, focus, sidebar collapse and mobile drawer/Escape behavior.
- Pause/resume memory, disable the provider, export records, then delete. A second account must never see those records.
- Repeat with network failure, quota exhaustion, another open tab and concurrent export changes.

## Remaining launch gates

- Replace/revoke the provider key previously disclosed in chat and confirm the intended Groq data controls.
- Complete the real-browser acceptance gate.
- Verify hosting recovery access and complete a staging restore drill.
- Enable/verify GitHub Actions and failure notifications if repository settings block them.

Charging users additionally needs billing, entitlement/refund handling and evidence that personalization is useful. Current model metrics measure English Reddit text classification, not psychological validity or individual emotion accuracy. No unverified production-readiness or legal-compliance certification is asserted.
