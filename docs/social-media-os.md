# Social Media OS — MVP

The agent harness owns strategy, memory, variation, review and learning. Postiz is a replaceable publishing provider.

## Weekly loop

1. Read BRAND.md and recent content fingerprints.
2. Research candidate topics.
3. Fill a seven-slot weekly mix (problem, education, product, insight, social proof, behind the scenes, founder).
4. Reject near-duplicate ideas.
5. Generate a native Instagram, TikTok and/or Facebook variant for each approved idea.
6. Review facts, brand fit, repetition, CTA and platform fit.
7. Keep every item in approval-required state.
8. Only after explicit human approval, create drafts/scheduled posts through Postiz.
9. Read performance data and append learnings for the next weekly plan.

## Safety

The Postiz provider refuses immediate autonomous publishing. A request must either be a draft or have an explicit future schedule plus separate scheduling authorization in the adapter. The MVP keeps human approval mandatory for every planned post.

## Environment

- POSTIZ_API_KEY
- POSTIZ_API_URL (optional; defaults to https://api.postiz.com/public/v1)

CreatorOS remains available while the provider migration is incremental.

## Replit preparation

The isolated review service persists drafts in PostgreSQL and never calls Postiz. See [deployment and limitations](replit-deployment.md). Live media/settings approval, provider credentials and real staging verification remain release prerequisites.
