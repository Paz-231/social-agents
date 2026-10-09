# Replit: multi-brand draft service

## Release boundary

The Replit entrypoint serves an authenticated brand console and a continuous monitor.
It can store exact draft approvals and explicitly export **drafts only** to Postiz.
It has no publish, schedule, delete or status-promotion capability. Setting
SOCIAL_OS_ENABLE_PUBLISHING to anything other than false fails startup.
The legacy dashboard, agent, CreatorOS worker and ClickUp integrations are never loaded.
Do not expose the legacy dashboard or replace the deployment entrypoint with npm start/worker.
This implementation is not evidence of a verified Replit deployment.

## Setup and secrets

Use Node >=22.12, the committed lockfile, and a single Reserved VM web instance
for the continuous monitor. Autoscale sleeping is unsuitable for a continuous tick.
Replit selects deployment type in Publishing; .replit specifies build/run/port only.
Build: npm ci && npm run typecheck. Run: npm run replit:start.
No merge or live deployment is authorized until exact-head tests pass and the user accepts.

Configure these separately in development/staging and deployment Secrets:

| Secret | Meaning |
| --- | --- |
| DATABASE_URL | Persistent dedicated PostgreSQL, provider-verified TLS URL |
| SOCIAL_OS_BRANDS | JSON array with exactly PASARA SURF (slug pasara-surf, provider instagram) and RunMyCamp (slug runmycamp, provider instagram-standalone), each with the real, unique Postiz integrationId and display name |
| SOCIAL_OS_PRINCIPALS | JSON array of id, strong random token (at least 32 non-whitespace characters), and explicit workspaces grants; use separate tokens for people/services |
| POSTIZ_API_KEY | Server-side Postiz key; not exposed to the browser |
| POSTIZ_API_URL | Optional HTTPS API root; defaults to https://api.postiz.com/public/v1 |
| PORT | 3000 |
| SOCIAL_OS_TICK_MS | 30000 default, 1000–60000 allowed |
| SOCIAL_OS_ENABLE_PUBLISHING | false |

.env.example contains structural placeholders, never valid evidence of channel ownership.
Inspect actual integrations and confirm which immutable ID belongs to each brand.
Do not infer identity from display names alone. Rotate principal tokens by updating
Secrets and restarting. The console keeps bearer tokens only in memory, clears them
on logout, and never stores them in URLs, cookies or localStorage. All granted users
can edit DNA/media, create drafts and approve/export drafts within their grants.
There is no separate editor/reviewer role or independent second-person approval yet.
Use HTTPS and private Replit access controls. Replit access controls and external
alert destinations must be configured and verified by an operator.

## Migration and isolation

Back up the selected DB before running npm run replit:migrate. Migration is additive,
transactional and locked. It initializes social_os_brands, social_os_assets,
social_os_drafts and social_os_events. Existing bindings cannot be silently remapped;
changing the configured channel ID/type/name requires a reviewed migration.
All SQL reads/writes use the authorized workspace, and transactions serialize on its
brand row. Media IDs are uniquely registered with a brand, immutable HTTPS path and
source/rights evidence. The service does not download user-supplied URLs.
A provider asset ID/path must be registered before using it in that brand's draft.
Operator-supplied evidence is stored, not independently verified by this service.

Brand DNA is versioned with source evidence. Drafts capture its version; approvals
capture exact payload, media, channel and revision in the event history. Concurrent
or stale approvals/exports fail. Updating DNA invalidates unexported approvals.
Older drafts must be recreated against current DNA. Drafts are immutable; a changed
caption/media requires a new draft and approval. Exact duplicate payloads are rejected
within a brand. Semantic similarity checking and a generative AI pipeline are not wired
into this deployment; the existing legacy weekly planner is not silently invoked.
No generated brand claims or placeholder brand DNA are treated as verified facts.

The old social_os_state/social_os_ticks and file queues remain separate. The legacy
pilot importer does not populate the new console. Do not migrate approvals implicitly.
A reviewed importer with evidence checks remains necessary for any legacy history.

## Draft-only workflow

1. Connect with a principal token. Only authorized brands appear.
2. Select the explicit brand/channel. The UI clears prior data immediately and ignores
   stale responses; there is no server-side global active-brand variable.
3. Store verified Brand DNA and register owned, durable Postiz media references.
4. Create an exact caption/media draft. Review the content, then approve the draft.
5. Explicitly select “Als Postiz-Entwurf speichern”. The server rechecks the current
   Postiz ID/provider before claiming the approved revision in the database.
6. A single POST uses type=draft and exact __type/post_type. The returned integration
   must match. The ID is persisted, then a date-bounded GET verifies DRAFT and the
   same integration/provider. Only then is the local state exported.

This approval is not publication approval and contains no schedule time. The API
rejects unknown fields, including schedule/publish arguments. There is no timed social
job or automatic draft export. The monitor only verifies channels, reconciles known
IDs through GET, and refreshes isolated channel analytics every 15 minutes.
Analytics retain collection timestamps; missing/unsupported metrics are not invented.
There is no observed published-post history import or performance optimization yet.

A timeout/crash/invalid response leaves exporting. Never automatically repeat POST.
Known IDs are read-only reconciled by the monitor; unknown IDs require an operator to
inspect Postiz and match exact brand/content/media/time. Preserve the unresolved event
and DB state. No automatic reset, deletion, adoption or retry endpoint exists.

## Monitoring and recovery

GET /healthz returns minimal process liveness. GET /readyz requires both brands to
have successful provider verification and a DB heartbeat newer than 120 seconds;
it fails during drain, DB/provider failure or stale monitor. A failed analytics fetch
marks the cycle unhealthy and preserves old data/timestamp. Readiness is not proof
of correct editorial claims, media rights or production release acceptance.
Authenticated GET /api/workspaces lists grants; brand snapshot/dna/assets/drafts
routes are scoped below /api/workspaces/:slug. Mutations require a matching
X-Social-OS-Workspace header and JSON content; cross-origin mutations are blocked.
Requests are bounded to 64 KiB. Provider redirects are rejected and calls time out.
Logs use generic errors or brand slugs, never raw provider bodies or credentials.
Shutdown stops ticks, drains HTTP/DB work and closes the pool with a 10-second deadline.
Uncertain exports remain durable across forced shutdown. Multiple replicas can duplicate
read-only polling; use one VM. Draft export claims serialize across replicas.

Configure external liveness/readiness alerts and inspect authenticated snapshots for
exporting records and stale analytics. No alert delivery has been provisioned yet.
Backups/PITR, retention and RPO/RTO require operator configuration. Use pg_dump and
restore with pg_restore into a separate DB, verify each brand's DNA/draft/event counts,
then test restart, readiness and reconciliation. A restore drill is still required.
Rollback application code to the previous verified commit while retaining tables and
unresolved exports; do not drop data as rollback. Preserve a pre-migration backup.
A reviewed migration/backfill policy is needed before moving existing production data.

## Verification and acceptance

CI runs Node 22, typecheck, full tests, real PostgreSQL 16 integration and production
dependency audit. TEST_DATABASE_URL is only for a disposable DB named social_os_test;
never point it at staging/production. Without it, DB integration suites skip. A local
pass alone does not verify PostgreSQL or Replit persistence.

Before live deployment, collect evidence at the exact commit:
- Full CI and audit pass, including both DB integration suites.
- Unpublished Replit environment uses the exact commit and intended secret names.
- Real Postiz GET verifies both immutable channel IDs/types and permissions.
- Draft-only E2E for each brand with owned media; verify returned DRAFT state/channel.
- Foreign-workspace access, changed DNA, stale revisions and duplicate export blocked.
- Restart/redeploy retains both brands; DB/provider outage gives 503 then recovers.
- Restore drill passes in an isolated database; external alerts are observed.
- Remaining pipeline/UX/security limitations are explicitly accepted or implemented.
- User explicitly accepts the concrete release; only then merge/live deploy separately.

No real Postiz draft, schedule, publication, ClickUp action, merge or Replit deployment
is performed merely by changing this repository.

## Primary references

- https://docs.replit.com/features/publishing/deployment-types
- https://docs.postiz.com/public-api/posts/create
- https://docs.postiz.com/public-api/posts/list
- https://docs.postiz.com/public-api/providers/instagram
- https://docs.postiz.com/public-api/providers/instagram-standalone
- https://docs.postiz.com/public-api/analytics/platform

TypeSafe skill: exact permissions and execution remain deterministic code. Typed model
judgments cannot grant deployment/social permissions. No TypeSafe inference has been
run and no TypeSafe key is required for the implemented deterministic draft workflow.
