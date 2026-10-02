# NEXUS ChatGPT Control Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make NEXUS persistent and controllable from any new ChatGPT conversation through a private `@NEXUS` plugin, while keeping the Render website as the main UI and requiring explicit confirmation for every destructive action.

**Architecture:** The Render web app and the ChatGPT plugin both use the same NEXUS domain API. Persistent data lives in Supabase Postgres/Storage with workspace-aware RLS. A ChatGPT Site hosts MCP tools that call the Render API; v1 uses a revocable owner credential, with interfaces already shaped for later Supabase OAuth 2.1 multi-user auth.

**Tech Stack:** Node.js 24+, native `fetch`, Node test runner, Supabase Postgres/Auth/Storage, Render, ChatGPT Sites + Plugins/MCP.

**Spec:** `docs/superpowers/specs/2026-10-02-nexus-chatgpt-control-design.md`

## Global Constraints

- NEXUS remains hosted on Render as the primary website.
- Export the live NEXUS state before any migration deploy.
- Supabase becomes the source of truth for nodes, edges, files, memberships, credentials, and audit history.
- A file may be associated with multiple nodes.
- Public read-only access must remain available.
- Owner/editor/viewer authorization must be workspace-aware; `TO authenticated` alone is not sufficient authorization.
- Never expose Supabase secret/service credentials, owner API credentials, passwords, or privileged tokens in browser JavaScript, GitHub, logs, or ChatGPT messages.
- Destructive actions use prepare/confirm and always require explicit user confirmation.
- Normal content deletion is soft-delete first (`deleted_at`), not physical deletion.
- ChatGPT plugin is private to the owner initially but interfaces must remain compatible with future multi-user OAuth.
- Use Node's built-in test runner and keep every migration/API behavior covered by a targeted test.

## Review Focus

- A stale or already-consumed destructive `confirmation_id` must not perform a deletion.
- Public graph reads must never expose private credentials, membership data, audit payloads, or deleted rows.
- One file linked to multiple nodes must survive unlinking/deleting one node when other links remain.
- A failed import or partial database write must not leave the live site switched to an incomplete Supabase state.
- A revoked owner credential must stop ChatGPT access immediately without breaking browser access to the public NEXUS.

---

## File Structure

**Existing files to modify**
- `package.json` — test/verification scripts only; keep runtime dependency surface minimal.
- `src/server.js` — reduce to server composition/static hosting and route registration.
- `public/app.js` — switch graph/file/admin operations to `/api/v2` domain endpoints.
- `public/index.html` — preserve public/admin entry points; add only UI elements needed by new auth/error states.
- `public/app.css` — only if new status/confirmation UI needs styling.

**Existing files to retire after migration validation**
- `src/store/store.js` — MemoryStore must no longer be authoritative.
- `src/store/json-store.js` — JSON persistence remains rollback-only and is not used in production.
- `src/auth/password.js` — retain only if needed for transition; final admin auth is persistent.

**New server modules**
- `src/config/env.js` — validated server-only configuration.
- `src/http/json.js` — JSON/body/error helpers.
- `src/auth/owner-token.js` — hash/verify revocable phase-1 owner API token.
- `src/auth/browser-session.js` — persistent browser admin session adapter.
- `src/db/supabase.js` — server-side Supabase HTTP client boundary.
- `src/repositories/nexus-repository.js` — graph/nodes/edges/files/activity domain persistence.
- `src/services/destructive-actions.js` — prepare/confirm lifecycle.
- `src/services/migration.js` — snapshot import/verification helpers.
- `src/routes/public.js` — health/public graph and public file reads.
- `src/routes/admin.js` — browser admin auth/write endpoints.
- `src/routes/v2.js` — authenticated ChatGPT/domain API.

**New database assets**
- `supabase/migrations/<generated>_nexus_core.sql` — schema, constraints, RLS, indexes, storage policies.
- `supabase/seed.sql` — optional deterministic local/test seed only; production state comes from live snapshot.

**New migration scripts**
- `scripts/export-live.mjs`
- `scripts/import-snapshot.mjs`
- `scripts/verify-migration.mjs`

**New tests**
- `test/env.test.js`
- `test/owner-token.test.js`
- `test/repository-contract.test.js`
- `test/destructive-actions.test.js`
- `test/routes-public.test.js`
- `test/routes-v2.test.js`
- `test/migration.test.js`
- `test/frontend-contract.test.js`

**Plugin/MCP source and operator docs**
- `mcp/nexus-tools.md` — canonical tool names, inputs, outputs, read/write/destructive annotations.
- `mcp/site-prompt.md` — exact prompt/instructions to give ChatGPT Sites when adding the MCP tools.
- `docs/NEXUS-PLUGIN-SETUP.md` — owner installation/linking/use instructions.

---

### Task 1: Establish the test harness and capture the live-state contract

**Files:**
- Modify: `package.json`
- Create: `test/frontend-contract.test.js`
- Create: `scripts/export-live.mjs`
- Create: `test/migration.test.js`

**Interfaces:**
- Produces: `exportLiveState({ baseUrl, adminCookie? }) -> { graph, files, exportedAt, sourceUrl }`
- Produces snapshot JSON shape consumed by Task 7.

- [ ] **Step 1: Write failing tests for the snapshot shape and current frontend contract**

Assert that a snapshot has `graph.nodes`, `graph.edges`, `files`, `exportedAt`, and `sourceUrl`; assert that the frontend still contains the public graph load and admin entry point before refactoring.

- [ ] **Step 2: Run tests and verify failure**

Run: `node --test test/migration.test.js test/frontend-contract.test.js`
Expected: FAIL because exporter/contract helpers do not exist.

- [ ] **Step 3: Implement `scripts/export-live.mjs` without changing production state**

Use GET-only requests to `/api/graph` and referenced `/api/files/:id`. Never trigger a deploy in this task. Save snapshots under `migration-snapshots/` only during execution, and add that directory to `.gitignore` if it can contain private files.

- [ ] **Step 4: Capture the real live snapshot before any deploy**

Run the exporter against the current live Render URL. Record node count, edge count, referenced file count, successfully downloaded file count, and failed file IDs in a local migration manifest. Do not commit private file payloads.

- [ ] **Step 5: Re-run tests**

Run: `node --test test/migration.test.js test/frontend-contract.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

Commit message: `test: add live state snapshot contract`

---

### Task 2: Create the Supabase project and core schema with RLS

**Files:**
- Create: `supabase/migrations/<generated>_nexus_core.sql`
- Create: `supabase/seed.sql`
- Create: `test/repository-contract.test.js`

**Interfaces:**
- Produces tables: `workspaces`, `profiles`, `workspace_members`, `nodes`, `edges`, `files`, `node_files`, `activity_log`, `api_credentials`, `pending_destructive_actions`.
- Produces storage bucket: `nexus-files`.

- [ ] **Step 1: Owner action — choose the Supabase organization after reviewing the reported project cost**

At execution time, call Supabase cost discovery first; repeat the cost to the user and obtain the required confirmation before project creation. Prefer region `sa-east-1` unless current Supabase availability/cost indicates otherwise.

- [ ] **Step 2: Write repository contract tests against an abstract adapter**

Cover workspace isolation, soft-deleted rows excluded by default, file-many-to-many association, public graph projection, and viewer/editor/owner permission expectations.

- [ ] **Step 3: Run tests and verify failure**

Run: `node --test test/repository-contract.test.js`
Expected: FAIL because persistent repository/schema adapter does not exist.

- [ ] **Step 4: Create the migration using Supabase-supported migration naming/CLI flow**

Enable RLS on every exposed table. Add unique/check constraints, foreign keys, indexes for `workspace_id`, `deleted_at`, node names/search fields, and edge endpoints. `node_files(node_id,file_id)` must be unique.

- [ ] **Step 5: Add policies**

Public anonymous access may read only the workspace content projection explicitly marked public. Authenticated policies must validate membership and role per workspace. Storage policies must mirror workspace/file authorization. Do not use `user_metadata` for authorization.

- [ ] **Step 6: Run Supabase security and performance advisors**

Expected: no unaddressed RLS/security warnings related to newly created NEXUS objects.

- [ ] **Step 7: Commit**

Commit message: `feat: add persistent nexus schema and rls`

---

### Task 3: Add secure server configuration and Supabase repository adapter

**Files:**
- Create: `src/config/env.js`
- Create: `src/db/supabase.js`
- Create: `src/repositories/nexus-repository.js`
- Create: `test/env.test.js`
- Expand: `test/repository-contract.test.js`

**Interfaces:**
- Produces: `loadServerConfig(env) -> ServerConfig`
- Produces: `createNexusRepository({ supabaseUrl, serverCredential, fetchImpl }) -> NexusRepository`
- Repository methods: `getPublicGraph(workspaceId)`, `getGraph(ctx)`, `getNode(ctx,id)`, `search(ctx,q)`, `createNode(ctx,input)`, `updateNode(ctx,id,patch)`, `createEdge(ctx,input)`, `linkFile(ctx,nodeId,fileId)`, `unlinkFile(ctx,nodeId,fileId)`, `writeActivity(ctx,event)`.

- [ ] **Step 1: Write failing env/repository tests**

Assert startup fails when required server-only variables are missing; assert secrets are never returned by config serialization/log helper; assert repository filters `workspace_id` and `deleted_at` on every content read.

- [ ] **Step 2: Run tests and verify failure**

Run: `node --test test/env.test.js test/repository-contract.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement the minimal adapters**

Use native `fetch` against Supabase APIs to keep runtime dependency surface small unless the current Supabase docs require an SDK feature that cannot be implemented safely with HTTP. Keep privileged credentials server-side only.

- [ ] **Step 4: Run tests**

Expected: PASS.

- [ ] **Step 5: Commit**

Commit message: `feat: add supabase nexus repository`

---

### Task 4: Implement persistent owner credentials and browser admin sessions

**Files:**
- Create: `src/auth/owner-token.js`
- Create: `src/auth/browser-session.js`
- Create: `test/owner-token.test.js`
- Create/modify: `src/routes/admin.js`

**Interfaces:**
- Produces: `hashOwnerToken(rawToken) -> string`
- Produces: `authenticateOwnerToken(rawToken, credentialRows) -> ActorContext | null`
- Produces: persistent browser session methods `createSession`, `getSession`, `revokeSession`.

- [ ] **Step 1: Write failing tests**

Cover valid token, wrong token, revoked token, no token, constant-time comparison path, and browser session surviving process restart through persistence.

- [ ] **Step 2: Run tests and verify failure**

Run: `node --test test/owner-token.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement phase-1 authentication**

Generate the owner credential through a secure setup flow during execution; never print the raw token into chat, logs, or Git. Store only its hash in `api_credentials`. Browser admin auth must move away from in-memory session state.

- [ ] **Step 4: Run tests**

Expected: PASS.

- [ ] **Step 5: Commit**

Commit message: `feat: persist nexus authentication`

---

### Task 5: Implement public and authenticated v2 API routes

**Files:**
- Create: `src/http/json.js`
- Create: `src/routes/public.js`
- Create: `src/routes/v2.js`
- Modify: `src/server.js`
- Create: `test/routes-public.test.js`
- Create: `test/routes-v2.test.js`

**Interfaces:**
- Public: `GET /api/health`, `GET /api/v2/public/graph`, safe public file reads.
- Authenticated: `GET /api/v2/me`, graph/node/search/files/activity reads; node/edge/file create/update operations.
- Auth header: `Authorization: Bearer <owner credential>` for phase 1.

- [ ] **Step 1: Write failing route tests**

Cover 200 public graph, absence of deleted/private rows, 401 missing/invalid credential, 403 insufficient role, workspace isolation, create/update success, malformed body 400, and payload size limits.

- [ ] **Step 2: Run tests and verify failure**

Run: `node --test test/routes-public.test.js test/routes-v2.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement route modules and reduce `src/server.js` to composition**

Every successful write must commit data first and then append `activity_log` with source `web` or `chatgpt`. Never return credential rows or secret fields.

- [ ] **Step 4: Run route tests**

Expected: PASS.

- [ ] **Step 5: Commit**

Commit message: `feat: add nexus v2 domain api`

---

### Task 6: Add two-phase destructive actions

**Files:**
- Create: `src/services/destructive-actions.js`
- Modify: `src/routes/v2.js`
- Create: `test/destructive-actions.test.js`

**Interfaces:**
- `prepareDestructiveAction(ctx,{ action,targetId }) -> { confirmationId, preview, expiresAt }`
- `confirmDestructiveAction(ctx,confirmationId) -> { ok, affected }`
- HTTP: `POST /api/v2/destructive/prepare`, `POST /api/v2/destructive/commit`.

- [ ] **Step 1: Write failing tests**

Cover prepare-does-not-delete, valid confirm soft-deletes, expired ID fails, reused ID fails, wrong actor/workspace fails, delete-node preview includes affected edges/files, unlinking one node does not delete a multiply-linked file, and revoked owner token cannot confirm.

- [ ] **Step 2: Run tests and verify failure**

Run: `node --test test/destructive-actions.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement prepare/confirm**

Use cryptographically random, single-use IDs; store only pending action payload/preview, expiry, actor/workspace, and consumed state. Default expiry: 10 minutes.

- [ ] **Step 4: Run tests**

Expected: PASS.

- [ ] **Step 5: Commit**

Commit message: `feat: require confirmation for destructive nexus actions`

---

### Task 7: Import and verify the current live state without cutting over production

**Files:**
- Create: `src/services/migration.js`
- Create: `scripts/import-snapshot.mjs`
- Create: `scripts/verify-migration.mjs`
- Expand: `test/migration.test.js`

**Interfaces:**
- `importSnapshot(repo,snapshot,workspaceId) -> MigrationReport`
- `verifyMigration(repo,snapshot,workspaceId) -> VerificationReport`

- [ ] **Step 1: Write failing migration tests**

Cover legacy ID preservation, edge remapping to UUIDs, duplicate-safe re-run/idempotency, many-to-many file links, and rollback on incomplete write.

- [ ] **Step 2: Run tests and verify failure**

Run: `node --test test/migration.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement importer/verifier**

Import into a new workspace that is not yet used by the live site. Preserve old IDs as `legacy_id`. Store a migration batch identifier in activity/audit metadata.

- [ ] **Step 4: Import the previously captured live snapshot**

Do not deploy the new backend yet.

- [ ] **Step 5: Verify counts and samples**

Require exact node and edge counts; require all successfully captured files to exist and be linked; manually sample `GERAL`, `ROBÓTICA`, `FOGUETE`, `MOBFOG` and several user-created nodes from the snapshot. Any mismatch blocks cutover.

- [ ] **Step 6: Commit code only**

Commit message: `feat: add nexus state migration tooling`

---

### Task 8: Switch the browser app to the persistent v2 API and deploy safely

**Files:**
- Modify: `public/app.js`
- Modify: `public/index.html`
- Modify if needed: `public/app.css`
- Expand: `test/frontend-contract.test.js`
- Modify: `src/server.js`

**Interfaces:**
- Browser reads from `/api/v2/public/graph` in visitor mode.
- Admin mode writes through persistent admin/v2 endpoints.
- Browser destructive UI also uses prepare → visual preview/confirm → commit.

- [ ] **Step 1: Write failing frontend contract tests**

Assert no production call remains to authoritative `/api/graph` PUT; assert visitor mode uses public v2 graph; assert destructive operations require prepare/commit; assert admin button remains present.

- [ ] **Step 2: Run tests and verify failure**

Run: `node --test test/frontend-contract.test.js`
Expected: FAIL against the current client.

- [ ] **Step 3: Refactor `public/app.js`**

Preserve current graph interactions, mobile gestures, admin button, file behavior, and public view. Change only data/auth flows needed for persistence and confirmation.

- [ ] **Step 4: Run the full local suite**

Run: `node --test`
Expected: all tests PASS.

- [ ] **Step 5: Deploy to Render only after Task 7 verification is green**

Set server-side Supabase environment values through Render secret environment configuration. Do not expose them to the browser. Keep the previous Render service/commit available for rollback.

- [ ] **Step 6: Production persistence smoke test**

Create a temporary non-critical node through admin UI, verify it, restart/redeploy the service, verify it still exists, then remove it through the confirmed destructive flow.

- [ ] **Step 7: Commit**

Commit message: `feat: switch nexus web to persistent api`

---

### Task 9: Define and build the `@NEXUS` MCP tools in ChatGPT Sites

**Files:**
- Create: `mcp/nexus-tools.md`
- Create: `mcp/site-prompt.md`
- Create: `docs/NEXUS-PLUGIN-SETUP.md`

**Interfaces:**
- Read tools: `nexus_get_graph`, `nexus_search`, `nexus_get_node`, `nexus_list_children`, `nexus_list_connections`, `nexus_list_files`, `nexus_get_activity`.
- Non-destructive write tools: `nexus_create_node`, `nexus_update_node`, `nexus_move_node`, `nexus_connect_nodes`, `nexus_update_connection`, `nexus_upload_file`, `nexus_replace_file`.
- Destructive tools: paired `nexus_prepare_*` and `nexus_confirm_*` operations.

- [ ] **Step 1: Write exact MCP tool contracts in `mcp/nexus-tools.md`**

For every tool specify name, purpose, JSON input shape, output shape, whether it is read/write/destructive, and the matching Render API endpoint. Confirm tools must accept the `confirmationId` returned by prepare and must not accept arbitrary delete payloads.

- [ ] **Step 2: Create `mcp/site-prompt.md`**

The prompt must tell ChatGPT Sites to add an MCP server that calls the deployed Render API, stores the owner credential only as a server-side connected secret/connection, never displays it, and exposes exactly the tool contracts above.

- [ ] **Step 3: Owner action in ChatGPT Sites**

Create/open a Site, ask ChatGPT/Codex to add the MCP server using `mcp/site-prompt.md`, connect the owner credential through the secure connection flow, test with non-production test data, and publish the Site. Publishing creates/updates the linked plugin.

- [ ] **Step 4: Install the generated plugin and set permissions**

Install it from the plugin card/Plugins > Personal. Configure permission mode so reads may proceed while writes require approval as desired; regardless of plugin permission mode, NEXUS destructive tools still enforce their own prepare/confirm contract.

- [ ] **Step 5: Test in a brand-new chat**

Run: `@NEXUS procure MOBFOG` → expect current node data. Then create a test node → expect it to appear in the site. Then request deletion → expect preview first and no deletion until explicit confirmation.

- [ ] **Step 6: Commit docs/contracts**

Commit message: `docs: add nexus plugin and mcp setup`

---

### Task 10: Final security, rollback, and acceptance verification

**Files:**
- Modify: `README.md`
- Modify: `docs/NEXUS-PLUGIN-SETUP.md`
- Modify: `scripts/verify-migration.mjs` if acceptance checks reveal gaps.

**Interfaces:**
- Produces a final operational runbook and rollback checklist.

- [ ] **Step 1: Run the complete automated suite**

Run: `node --test`
Expected: all tests PASS.

- [ ] **Step 2: Run Supabase advisors again**

Expected: no unresolved security findings caused by NEXUS schema/policies.

- [ ] **Step 3: Verify secrets**

Search tracked source for Supabase secrets, raw owner tokens, passwords, and accidental snapshot payloads. Expected: none.

- [ ] **Step 4: Verify live acceptance cases**

Site→ChatGPT sync, ChatGPT→site sync, restart persistence, public read-only view, revoked token behavior, viewer/editor/owner isolation where test users are available, multi-node file association, and destructive confirmation lifecycle.

- [ ] **Step 5: Exercise rollback without destroying production data**

Verify prior Render commit/service can be selected, current snapshot is retained, Supabase remains inspectable, and revoking plugin credential does not break the public website.

- [ ] **Step 6: Update user instructions**

Document: install plugin, connect once, use `@NEXUS` in any new chat, examples for search/create/connect/upload, deletion confirmation behavior, how to revoke/reconnect access, and future sharing limitation for personal accounts.

- [ ] **Step 7: Final commit**

Commit message: `docs: finalize nexus chatgpt control runbook`

---

## Execution Order / Cutover Gates

1. Tasks 1–6 may be built/tested without changing the live NEXUS data source.
2. Task 7 must show a clean migration verification before any production cutover.
3. Task 8 is the only task that switches the live website to Supabase.
4. Task 9 begins only after the persistent site is proven stable.
5. Task 10 must pass before declaring the integration complete.

## Manual Owner Actions Required

- Choose the Supabase organization and confirm any reported project cost before creation.
- Complete secure Supabase/Render secret setup when credentials cannot be transferred through connected tools.
- In ChatGPT Sites, publish the Site that hosts the MCP tools and install/connect the generated private plugin.
- Approve destructive actions when prompted; raw credentials must never be pasted into chat.
