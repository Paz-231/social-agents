# Replit deployment preparation — review service

## Verified scope and release boundary

The Replit entrypoint is a **review-only API and queue-monitor worker**. It persists
approval drafts in PostgreSQL and exposes protected queue/status reads. It does not
run the legacy dashboard, LLM agent, CreatorOS worker, Postiz calls, ClickUp calls,
approvals, publication or social scheduling. There is no switch that enables these
actions. SOCIAL_OS_ENABLE_PUBLISHING=true fails startup.

This is a staging foundation, not a claim that the complete Social Media OS is
ready for production. The existing dashboard is a local, unauthenticated tool with
agent chat and stays bound to localhost. Do not expose it through a Replit port or
reverse proxy. Legacy `npm run worker` executes skills and must not be substituted
for `replit:start` without separately reviewed action restrictions and permission.

## Runtime and configuration

Use Node >=22.12.0 and the committed lockfile. Import the PR branch into Replit;
`.replit` supplies build/run and a 3000-to-80 port mapping. In Publishing, select
**Reserved VM**, web server, one instance. The queue-monitor runs in the same Node
process as the API. Autoscale can sleep and is unsuitable for its continuous tick.
Deployment type is selected in the Replit UI; the config intentionally does not
invent an undocumented Reserved VM deploymentTarget value.

Build: `npm ci && npm run typecheck`.
Run: `npm run replit:start`.
There is no interactive onboarding, browser launch or runtime package installation.

Set these in Replit **deployment Secrets**, including separately for staging:

| Name | Required | Purpose |
| --- | --- | --- |
| DATABASE_URL | yes | Dedicated PostgreSQL database; use the provider's verified TLS connection string |
| SOCIAL_OS_ADMIN_TOKEN | yes | Independent random token, >=32 non-whitespace characters; generate with `openssl rand -hex 32` |
| SOCIAL_OS_WORKSPACE | yes | Explicit brand slug; `pasara-surf` for pilot |
| PORT | default 3000 | Must match the mapped port |
| SOCIAL_OS_TICK_MS | default 30000 | Queue monitor interval, 1000–60000 ms |
| SOCIAL_OS_ENABLE_PUBLISHING | false | Only false/unset is allowed |

Never paste real secrets into `.replit`, source, tickets, PRs or screenshots.
`.env.example` contains placeholders only; do not use its token as a real secret.
The review service does not need POSTIZ_API_KEY, CREATOROS_API_KEY, AI credentials
or ClickUp credentials. Do not copy them into this deployment. Rotate the admin
token in deployment Secrets and restart the service to revoke previous access.
The HTTP API accepts the token only through `Authorization: Bearer ...`, not URLs.
Use HTTPS through Replit. It has no browser login UI; access through a trusted API
client without persisting the token in shared client settings.

## Persistent state and migration

Provision a dedicated staging PostgreSQL database first. Replit published files
are not the source of durable state. Use durable object storage for future media;
no media upload or local asset persistence is implemented in this review service.

Run `npm run replit:migrate` manually against the selected database before starting
the service. It creates two namespaced tables idempotently, under a transaction
and migration lock, and initializes the explicit workspace. It does not drop or
alter existing data. Future schema upgrades need versioned migrations and rollback
review; this is the initial schema only.

`social_os_state` stores the workspace's approval queue and history. Updates lock
the brand row in a transaction, so concurrent imports preserve existing drafts.
`social_os_ticks` stores the latest monitor counts and heartbeat. The scheduler
starts with a database tick, then runs serially without overlapping local ticks.
Multiple processes serialize snapshots through the database row lock. Missed ticks
are coalesced into one fresh snapshot after restart; there is no social job backlog.

The legacy file queue/history and JSONL journal are not silently migrated. Before
importing a real workspace, validate its records, IDs, approvals, evidence and
account mapping, back up the database, and build a reviewed importer. Published
history must not be synthesized from scheduled posts. No history writer runs in
this review-only deployment because no publication is observed.

## PASARA-SURF pilot

No PASARA-SURF configuration was present in PR #1 at the reviewed head
`da940f0271854620b70c3201ec127a359aea1fe6`. The new
`templates/pasara-surf/pilot.json` is an **unverified editorial skeleton**: seven
unique days, seven pillars, two reels, pending approval. It supplies no invented
location, qualification, price, testimonial, performance result or offer.

After migrating a staging database with SOCIAL_OS_WORKSPACE=pasara-surf, run
`npm run replit:stage-pilot`. It strictly validates the fixture, checks similarity
against queue/history, and atomically appends seven pending records. Running it
again rejects duplicates without overwriting drafts. This command only writes to
the local application's database; it never creates a Postiz draft or schedule.

Before any eventual live pilot: confirm brand identity and timezone, offers and
claims with source evidence, real channel IDs and ownership, rights and consent
for media/testimonials, platform media/settings, native copy, and exact dates.
Safety guidance about surfing requires qualified editorial review. The pilot is
not approved for publication or scheduling by importing it.

## Postiz adapter findings and limits

The adapter uses the documented `/integrations`, POST `/posts`, and date-bounded
GET `/posts` contracts. It verifies `state` from a matching returned ID instead of
calling an undocumented GET `/posts/:id`. Redirects are rejected, requests time
out, and provider error bodies are not echoed into logs.

Immediate publication remains blocked. Scheduling additionally requires an
explicit `allowScheduling: true` constructor argument in separately reviewed
calling code; the Replit service never constructs a provider. Each request is
limited to one integration so additional returned IDs cannot be silently ignored.
Provider settings must include `__type`; Instagram/TikTok require media. Detailed
platform settings and actual uploaded media still need live contract validation.
The weekly orchestrator has no approved-media/settings workflow yet and is not a
production-ready Instagram/TikTok path. Do not infer live readiness from mocks.

The orchestrator preserves prior staged weeks and claims `submitting` before an
external call. It saves a returned provider ID before attempting verification.
A timeout, crash or rejected verification leaves a non-retryable unresolved
submission. Reconcile that item manually in Postiz and the database; never reset
it to approved or retry a POST merely because the client saw an error. A local
file repository only serializes within one process; cloud callers must inject
the PostgreSQL repository. No cross-process file safety is claimed.

## Health, monitoring and shutdown

- GET `/healthz`: minimal process liveness, no credentials required.
- GET `/readyz`: database heartbeat is at most 120 seconds old; 503 on stale DB,
  database outage or draining. No queue content is exposed.
- GET `/api/status`: token required; review mode and persisted monitor counts.
- GET `/api/queue`: token required; full approval drafts (treat as private).
- Non-GET requests: 405. No approval/schedule/publish endpoint exists.

Monitor liveness and readiness independently. Ready means the review service and
queue monitor work; it does not imply provider connectivity or publish readiness.
SIGTERM/SIGINT stops ticks, drains HTTP and current database work, closes the pool;
a 10-second deadline terminates an unresponsive drain. Errors do not log URLs,
credentials or provider response bodies.

## Verification and release procedure

1. `npm ci`, `npm run typecheck`, `npm test`, and
   `npm audit --omit=dev --audit-level=high` must pass for the exact PR head.
2. CI starts PostgreSQL 16 and runs real persistence tests through
   TEST_DATABASE_URL. Without that variable the DB integration test is skipped;
   a local pass alone is not database verification.
3. Against staging only: migrate, stage pilot, start service; verify 200 probes,
   401 without token, seven pending drafts with token, 405 mutation routes.
4. Restart and redeploy staging with the same database; confirm drafts survive.
   Stop the DB and verify readiness fails. Restore it and verify recovery.
5. Set publishing=true in a disposable startup test; verify startup is rejected.
6. Record exact commit, CI run, staging probe results, restart/restore evidence and
   unresolved limitations; report to the user before requesting production action.

No merge, production deployment, social scheduling/publication or ClickUp mutation
is authorized by this preparation. Production must wait for user feedback and
separate action authorization. Staging rollout itself has not been performed by
adding this configuration.

## Backup and recovery

Before migration/import, export with `pg_dump "$DATABASE_URL" --format=custom
--file=BACKUP_PATH` into a private location outside Git (do not put the real URL
in shell history). Enable managed database backups/PITR where supported. Decide
retention, recovery point and recovery time with the operator before production.
Verify a restore using `pg_restore --dbname="$RESTORE_DATABASE_URL" BACKUP_PATH`
against an isolated database, then compare workspace queue IDs/counts and rerun
readiness checks. Keep secrets out of backup filenames and logs. A backup is not
verified until its restore has been exercised.

Rollback: stop the service, point Publishing at the previously verified commit,
retain the database and workspace slug, and recheck probes and counts. Initial
migration is additive; never drop tables as an application rollback. Preserve
unresolved submissions for manual reconciliation. Media backup/restore remains
pending until durable media storage is implemented.

## Official references checked during preparation

- [Replit deployment types](https://docs.replit.com/features/publishing/deployment-types)
- [Replit configuration](https://docs.replit.com/features/project-setup/configuration)
- [Replit SQL database](https://docs.replit.com/features/data-and-storage/sql-database)
- [Postiz create](https://docs.postiz.com/public-api/posts/create)
- [Postiz list](https://docs.postiz.com/public-api/posts/list)

Per the requested TypeSafe skill, deterministic permissions, migrations and
release gates stay in code/tests. No semantic model judgment can authorize
publishing, ClickUp mutation or deployment; no TypeSafe API key is needed here.
