# Social Media OS architecture

- Source: Paz-231/social-agents
- Publisher: Postiz via connected integration and platform-specific schema
- Brand workspace: Business DNA, account mapping, asset library, fingerprints, approval queue, metrics
- Flow: research → weekly plan → native variants → creative QA → draft approval → Postiz draft → explicit schedule approval → publish → analytics
- Hard boundaries: no auto-publish, no cross-brand account mixing, no unverified performance claims.
- Runtime: this skill describes a workflow; recurring autonomous execution requires a separately deployed scheduler and credentials.
- Existing incremental implementation: src/providers/, src/content/; Draft PR #1.
