# NEXUS ChatGPT Control Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make NEXUS persistent and controllable from any new ChatGPT conversation through a private `@NEXUS` plugin, while keeping the Render website as the main UI and requiring explicit confirmation for every destructive action.

**Architecture:** The Render web app and the ChatGPT plugin both use the same NEXUS domain API. Persistent data lives in Supabase Postgres/Storage with workspace-aware authorization and RLS. A ChatGPT Site hosts MCP tools that call the Render API; v1 uses a revocable owner credential, while interfaces remain compatible with later Supabase OAuth 2.1 multi-user authentication.

**Tech Stack:** Node.js 24+, native `fetch`, Node test runner, Supabase Postgres/Auth/Storage, Render, ChatGPT Sites + Plugins/MCP.

**Spec:** `docs/superpowers/specs/2026-10-02-nexus-chatgpt-control-design.md`

## Global Constraints

- NEXUS remains hosted on Render as the primary website.
- Export the live NEXUS state before any migration deploy.
- Supabase becomes the source of truth for nodes, edges, files, memberships, browser auth state, plugin credentials, destructive confirmations, and audit history.
- A file may be associated with multiple nodes.
- Public read-only access must remain available.
- Owner/editor/viewer authorization must be workspace-aware; `TO authenticated` alone is not sufficient authorization.
- Never expose Supabase secret/service credentials, owner API credentials, passwords, password hashes, or privileged tokens in browser JavaScript, GitHub, logs, snapshots committed to Git, or ChatGPT messages.
- Destructive actions use prepare/confirm and always require explicit user confirmation.
- Normal content deletion is soft-delete first (`deleted_at`), not physical deletion.
- ChatGPT plugin is private to the owner initially but interfaces must remain compatible with future multi-user OAuth.
- Use Node's built-in test runner and keep every migration/API behavior covered by a targeted test.

## Review Focus

- A stale, wrong-user, wrong-workspace, or already-consumed destructive `confirmation_id` must never perform a deletion.
- Public graph/file reads must never expose credentials, memberships, browser sessions, audit payloads, private files, or deleted rows.
- One file linked to multiple nodes must survive unlinking/deleting one node while other links remain.
- A failed import or partial database write must not leave the live site switched to an incomplete Supabase state.
- Revoking the owner plugin credential must stop ChatGPT access immediately without breaking public website access or the owner's browser admin login.

---

## File Structure

**Existing files to modify**
- `package.json` — verification/test scripts; runtime dependencies stay minimal.
- `src/server.js` — server composition/static hosting and route registration only.
- `public/app.js` — use persistent `/api/v2` graph/file/admin flows.
- `public/index.html` — preserve visitor/admin entry points.
- `public/app.css` — only for new persistent-auth/destructive-preview UI states.

**Existing files to retire after successful cutover**
- `src/store/store.js` — MemoryStore no longer authoritative.
- `src/store/json-store.js` — rollback/local-only; never production source of truth.
- `src/auth/password.js` — may supply hashing primitives but must no longer back in-memory auth state.

**New server modules**
- `src/config/env.js` — validated server-only configuration.
- `src/http/json.js` — JSON/body/error helpers.
- `src/auth/owner-token.js` — revocable phase-1 ChatGPT credential hashing/verification.
- `src/auth/browser-auth.js` — persistent admin password/session operations.
- `src/db/supabase.js` — server-side Supabase HTTP boundary.
- `src/repositories/nexus-repository.js` — graph/nodes/edges/files/activity/domain persistence.
- `src/services/files.js` — Storage upload/download/link lifecycle.
- `src/services/destructive-actions.js` — prepare/confirm lifecycle.
- `src/services/migration.js` — snapshot import/verification helpers.
- `src/routes/public.js` — health/public graph/public file reads.
- `src/routes/admin.js` — browser admin auth/write endpoints.
- `src/routes/v2.js` — authenticated ChatGPT/domain API.

**New database assets**
- `supabase/migrations/<generated>_nexus_core.sql` — schema, constraints, RLS, indexes, storage policies.
- `supabase/seed.sql` — deterministic local/test seed only; production data comes from the live snapshot.

**New migration scripts**
- `scripts/export-live.mjs`
- `scripts/import-snapshot.mjs`
- `scripts/verify-migration.mjs`

**New tests**
- `test/env.test.js`
- `test/owner-token.test.js`
- `test/browser-auth.test.js`
- `test/repository-contract.test.js`
- `test/files.test.js`
- `test/destructive-actions.test.js`
- `test/routes-public.test.js`
- `test/routes-v2.test.js`
- `test/migration.test.js`
- `test/frontend-contract.test.js`

**Plugin/MCP contracts and docs**
- `mcp/nexus-tools.md`
- `mcp/site-prompt.md`
- `docs/NEXUS-PLUGIN-SETUP.md`

---

### Task 1: Establish tests and capture the live-state snapshot before any deploy

**Files:**
- Modify: `package.json`
- Create: `scripts/export-live.mjs`
- Create: `test/migration.test.js`
- Create: `test/frontend-contract.test.js`

**Interfaces:**
- Produces `exportLiveState({ baseUrl, adminCookie? }) -> { graph, files, exportedAt, sourceUrl }`.
- Snapshot shape is consumed by Task 7.

- [ ] Write failing tests asserting snapshot shape and that the current frontend still exposes visitor graph loading and the admin entry point.
- [ ] Run `node --test test/migration.test.js test/frontend-contract.test.js`; expect FAIL because exporter/helpers do not exist.
- [ ] Implement GET-only exporter for `/api/graph` plus every referenced `/api/files/:id`; exporter must never mutate or deploy.
- [ ] Add `migration-snapshots/` to `.gitignore`; never commit private file payloads.
- [ ] Run exporter against the current live Render service and record node count, edge count, referenced-file count, downloaded-file count, and failed file IDs.
- [ ] Re-run the two tests; expect PASS.
- [ ] Commit `test: add live state snapshot contract`.

---

### Task 2: Create Supabase project, schema, Storage, and RLS

**Files:**
- Create: `supabase/migrations/<generated>_nexus_core.sql`
- Create: `supabase/seed.sql`
- Create: `test/repository-contract.test.js`

**Interfaces:**
- Tables: `workspaces`, `profiles`, `workspace_members`, `workspace_admin_auth`, `browser_sessions`, `nodes`, `edges`, `files`, `node_files`, `activity_log`, `api_credentials`, `pending_destructive_actions`.
- Storage bucket: `nexus-files`.

- [ ] At execution time, discover Supabase project cost first; show it to the user and obtain required cost confirmation before creation. Ask which organization to use, as required by the Supabase connector. Prefer `sa-east-1` only if available and cost-equivalent.
- [ ] Write failing repository-contract tests for workspace isolation, soft deletes, public projection, file-many-to-many behavior, and owner/editor/viewer permissions.
- [ ] Run `node --test test/repository-contract.test.js`; expect FAIL.
- [ ] Generate the migration using the current supported Supabase migration workflow; do not invent a migration filename.
- [ ] Add constraints/indexes for workspace membership, unique node-file links, edge endpoints, `deleted_at`, search/name fields, session expiry, credential revocation, and destructive-action expiry/consumption.
- [ ] `workspace_admin_auth` stores only password hash + metadata; `browser_sessions` stores opaque session hash/expiry/revocation, never raw cookies.
- [ ] Enable RLS on every exposed table. Anonymous policies may read only the explicitly public workspace content projection; authenticated policies validate workspace membership and role. Storage policies mirror file/workspace permissions. Never authorize from `user_metadata`.
- [ ] Run Supabase security and performance advisors; resolve all NEXUS-related security findings.
- [ ] Commit `feat: add persistent nexus schema and rls`.

---

### Task 3: Implement server config and persistent repository boundary

**Files:**
- Create: `src/config/env.js`
- Create: `src/db/supabase.js`
- Create: `src/repositories/nexus-repository.js`
- Create: `test/env.test.js`
- Expand: `test/repository-contract.test.js`

**Interfaces:**
- `loadServerConfig(env) -> ServerConfig`.
- `createNexusRepository({ supabaseUrl, serverCredential, fetchImpl }) -> NexusRepository`.
- Repository methods: `getPublicGraph`, `getGraph`, `getNode`, `search`, `createNode`, `updateNode`, `createEdge`, `updateEdge`, `linkFile`, `unlinkFile`, `writeActivity`, plus auth/session/credential persistence methods needed by Tasks 4–6.

- [ ] Write failing tests for missing required environment values, redacted config output, workspace filtering, and `deleted_at is null` filtering.
- [ ] Run `node --test test/env.test.js test/repository-contract.test.js`; expect FAIL.
- [ ] Implement minimal native-`fetch` Supabase adapter unless current docs require an SDK feature unavailable safely over HTTP.
- [ ] Privileged server credential may be used only inside Render backend; every privileged repository method must receive an already-authorized `ActorContext` and enforce workspace scope before mutation. RLS remains defense-in-depth and enables later user-scoped OAuth clients.
- [ ] Re-run tests; expect PASS.
- [ ] Commit `feat: add supabase nexus repository`.

---

### Task 4: Persist browser admin auth and revocable ChatGPT owner credential

**Files:**
- Create: `src/auth/owner-token.js`
- Create: `src/auth/browser-auth.js`
- Create: `src/routes/admin.js`
- Create: `test/owner-token.test.js`
- Create: `test/browser-auth.test.js`

**Interfaces:**
- `hashOwnerToken(rawToken) -> string`.
- `authenticateOwnerToken(rawToken, rows) -> ActorContext | null`.
- `verifyAdminPassword(password, storedHash) -> boolean`.
- `createBrowserSession(actor) -> { cookieValue, expiresAt }` where only a hash of `cookieValue` is stored.
- `resolveBrowserSession(cookieValue) -> ActorContext | null`.

- [ ] Write failing tests for valid/invalid/revoked owner token, constant-time comparison path, persistent admin password hash, persistent browser session surviving process restart, expired session, revoked session, and logout.
- [ ] Run `node --test test/owner-token.test.js test/browser-auth.test.js`; expect FAIL.
- [ ] Implement owner token generation/setup without ever printing raw token into chat/logs/Git; persist only hash in `api_credentials`.
- [ ] Migrate admin password hash from volatile memory to `workspace_admin_auth`; preserve the existing password-only admin UX.
- [ ] Store browser sessions persistently in `browser_sessions`; browser cookie remains HttpOnly, SameSite=Strict, Secure in production.
- [ ] Re-run tests; expect PASS.
- [ ] Commit `feat: persist nexus authentication`.

---

### Task 5: Implement files and the public/authenticated v2 API

**Files:**
- Create: `src/http/json.js`
- Create: `src/services/files.js`
- Create: `src/routes/public.js`
- Create: `src/routes/v2.js`
- Modify: `src/server.js`
- Create: `test/files.test.js`
- Create: `test/routes-public.test.js`
- Create: `test/routes-v2.test.js`

**Interfaces:**
- Public: `GET /api/health`, `GET /api/v2/public/graph`, safe public file reads where explicitly public.
- Owner/plugin auth: `Authorization: Bearer <owner credential>`.
- Authenticated domain endpoints: `/api/v2/me`, graph/node/search/files/activity reads, node/edge/file create/update/link operations.
- File methods: `uploadFile`, `replaceFile`, `readFile`, `linkFile`, `unlinkFile`.

- [ ] Write failing tests for public projection safety, 401 missing/invalid token, 403 insufficient role, workspace isolation, malformed bodies, payload limits, upload/replace, multi-node link/unlink, and private file denial.
- [ ] Run `node --test test/files.test.js test/routes-public.test.js test/routes-v2.test.js`; expect FAIL.
- [ ] Implement Storage operations and route modules; never expose storage service credentials or unrestricted bucket URLs.
- [ ] Reduce `src/server.js` to server composition/static allowlist/route registration and shared security headers.
- [ ] Every successful write commits domain data first and then appends `activity_log` with source `web` or `chatgpt`.
- [ ] Re-run route/file tests; expect PASS.
- [ ] Commit `feat: add nexus v2 domain api`.

---

### Task 6: Implement two-phase destructive actions

**Files:**
- Create: `src/services/destructive-actions.js`
- Modify: `src/routes/v2.js`
- Create: `test/destructive-actions.test.js`

**Interfaces:**
- `prepareDestructiveAction(ctx,{ action,targetId }) -> { confirmationId, preview, expiresAt }`.
- `confirmDestructiveAction(ctx,confirmationId) -> { ok, affected }`.
- HTTP: `POST /api/v2/destructive/prepare`, `POST /api/v2/destructive/commit`.

- [ ] Write failing tests for prepare-without-delete, valid soft-delete, expiry, reuse, wrong actor/workspace, revoked token, node preview impact, and multi-linked-file survival.
- [ ] Run `node --test test/destructive-actions.test.js`; expect FAIL.
- [ ] Implement cryptographically random one-use IDs bound to actor/workspace/action with 10-minute expiry.
- [ ] Confirm operation must derive payload from the stored pending action; it must not accept a fresh arbitrary delete target from the caller.
- [ ] Re-run tests; expect PASS.
- [ ] Commit `feat: require confirmation for destructive nexus actions`.

---

### Task 7: Import and verify the captured live state without production cutover

**Files:**
- Create: `src/services/migration.js`
- Create: `scripts/import-snapshot.mjs`
- Create: `scripts/verify-migration.mjs`
- Expand: `test/migration.test.js`

**Interfaces:**
- `importSnapshot(repo,snapshot,workspaceId) -> MigrationReport`.
- `verifyMigration(repo,snapshot,workspaceId) -> VerificationReport`.

- [ ] Write failing tests for legacy ID preservation, UUID remapping, idempotent re-run, many-to-many file links, and transactional/compensating rollback on partial failure.
- [ ] Run `node --test test/migration.test.js`; expect FAIL.
- [ ] Implement importer into a new not-yet-live workspace; preserve old node IDs in `legacy_id` and record migration batch metadata.
- [ ] Import the previously captured live snapshot without deploying the new backend.
- [ ] Verify exact node and edge counts and every successfully captured file; manually sample `GERAL`, `ROBÓTICA`, `FOGUETE`, `MOBFOG`, and several user-created nodes from the snapshot. Any mismatch blocks cutover.
- [ ] Commit code only as `feat: add nexus state migration tooling`; never commit private snapshot contents.

---

### Task 8: Switch browser app to persistent v2 API and cut over Render safely

**Files:**
- Modify: `public/app.js`
- Modify: `public/index.html`
- Modify if needed: `public/app.css`
- Expand: `test/frontend-contract.test.js`
- Modify: `src/server.js`

**Interfaces:**
- Visitor mode reads `/api/v2/public/graph`.
- Admin writes use persistent admin/v2 endpoints.
- Browser deletions also use prepare → preview/confirm → commit.

- [ ] Write failing frontend-contract tests asserting no authoritative production PUT to old `/api/graph`, visitor v2 reads, persistent admin auth, and prepare/confirm destructive flow.
- [ ] Run `node --test test/frontend-contract.test.js`; expect FAIL.
- [ ] Refactor `public/app.js` while preserving current graph rendering, pan/pinch, node drag, search, admin button, file actions, and mobile behavior.
- [ ] Run full suite with `node --test`; expect all PASS.
- [ ] Configure Render server-side Supabase values through secret environment settings only after Task 7 is green.
- [ ] Deploy while retaining the prior service/commit for rollback.
- [ ] Production smoke test: create a temporary node, verify it, restart/redeploy Render, verify persistence, then remove it through the confirmed destructive flow.
- [ ] Commit `feat: switch nexus web to persistent api`.

---

### Task 9: Define, build, publish, and install the `@NEXUS` plugin through ChatGPT Sites

**Files:**
- Create: `mcp/nexus-tools.md`
- Create: `mcp/site-prompt.md`
- Create: `docs/NEXUS-PLUGIN-SETUP.md`

**Interfaces:**
- Read tools: `nexus_get_graph`, `nexus_search`, `nexus_get_node`, `nexus_list_children`, `nexus_list_connections`, `nexus_list_files`, `nexus_get_activity`.
- Non-destructive writes: `nexus_create_node`, `nexus_update_node`, `nexus_move_node`, `nexus_connect_nodes`, `nexus_update_connection`, `nexus_upload_file`, `nexus_replace_file`.
- Destructive pairs: `nexus_prepare_delete_node`/`nexus_confirm_delete_node`, `nexus_prepare_delete_file`/`nexus_confirm_delete_file`, `nexus_prepare_disconnect_nodes`/`nexus_confirm_disconnect_nodes`.

- [ ] Document exact JSON input/output contract and matching Render endpoint for every tool; `confirm_*` accepts only `confirmationId` returned by prepare.
- [ ] Write `mcp/site-prompt.md` instructing ChatGPT Sites to add an MCP server that calls the deployed Render API and stores the owner credential only through the Site/plugin secure connection flow.
- [ ] In ChatGPT Sites, create/open an owned Site, ask ChatGPT/Codex to add the MCP tools using the contract, test against non-critical data, then publish/re-publish the Site so the linked plugin is created/updated.
- [ ] Install the generated plugin from its card or Plugins > Personal; complete its connection flow.
- [ ] Set plugin permissions so reads can be allowed while writes can require approval; NEXUS destructive prepare/confirm remains mandatory regardless of ChatGPT permission mode.
- [ ] In a brand-new chat, test `@NEXUS procure MOBFOG`, create a test node, verify it appears on the website, request deletion and confirm that preview occurs before deletion.
- [ ] Commit contracts/docs as `docs: add nexus plugin and mcp setup`.

---

### Task 10: Final verification, security review, rollback runbook, and user instructions

**Files:**
- Modify: `README.md`
- Modify: `docs/NEXUS-PLUGIN-SETUP.md`
- Modify: `scripts/verify-migration.mjs` only if acceptance checks reveal a missing assertion.

- [ ] Run `node --test`; expect all PASS.
- [ ] Run Supabase security/performance advisors again; resolve all NEXUS-related security findings.
- [ ] Search tracked source for Supabase secrets, raw owner token, passwords, session values, and snapshot payloads; expect none.
- [ ] Verify live site→ChatGPT sync, ChatGPT→site sync, restart persistence, public read-only behavior, revoked-token behavior, multi-node file association, and destructive confirmation lifecycle.
- [ ] Verify rollback: prior Render commit/service remains selectable, snapshot remains retained outside Git, Supabase remains inspectable, and revoking plugin access does not affect visitor website access.
- [ ] Document installation, one-time connection, `@NEXUS` usage examples, deletion confirmation, credential revocation/reconnect, and personal-account plugin sharing limitation.
- [ ] Commit `docs: finalize nexus chatgpt control runbook`.

---

## Execution Order / Cutover Gates

1. Tasks 1–6 may be built/tested without switching the live NEXUS data source.
2. Task 7 must produce a clean verification report before production cutover.
3. Task 8 is the only task that switches the live website to Supabase.
4. Task 9 starts only after persistence and API behavior are proven stable.
5. Task 10 must pass before declaring the integration complete.

## Manual Owner Actions Required

- Choose the Supabase organization and approve any reported project cost before creation.
- Complete any secure Supabase/Render secret configuration that cannot be transferred through connected tools.
- In ChatGPT Sites, publish/re-publish the Site that hosts the MCP tools and install/connect the generated private plugin.
- Approve destructive actions when prompted; never paste raw credentials into chat.
