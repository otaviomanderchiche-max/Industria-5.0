# NEXUS GitHub Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace all Supabase persistence in NEXUS with a private GitHub repository (`NEXUS-DATA`) while preserving the existing `/api/v2`, frontend behavior, admin mode, `@NEXUS` contract, file support, audit history, and two-step destructive confirmations.

**Architecture:** Render remains the only application/backend host. A new server-side GitHub adapter reads/writes `data/state.json` and file blobs in a separate private repository, using the current blob SHA as compare-and-swap protection. The existing domain/API layer remains stable so the frontend and plugin do not need another contract rewrite.

**Tech Stack:** Node.js 24+, native `fetch`, Node test runner, GitHub REST Git Data/Contents APIs, Render, ChatGPT Sites/Plugins.

**Spec:** `docs/superpowers/specs/2026-10-02-nexus-github-persistence-design.md`

## Global Constraints

- No Supabase, SQL database, or Render Postgres in the final runtime.
- Persistent source of truth is a separate private GitHub repository named `NEXUS-DATA`.
- `data/state.json` is authoritative; `data/public.json` is a public-safe projection only.
- File limit remains 20 MB per file in v1.
- Browser/plugin never receive the GitHub write credential.
- GitHub credential stays server-side in Render environment only and must be scoped to `NEXUS-DATA`.
- Existing `/api/v2` contracts remain stable unless a test proves an unavoidable correction.
- Every destructive action remains prepare/confirm; confirmation IDs expire after 10 minutes and are single-use.
- No raw admin password, ChatGPT owner token, GitHub credential, session secret, or privileged key may appear in Git, logs, browser JavaScript, or ChatGPT messages.
- Writes must use SHA-based optimistic concurrency; no silent last-writer-wins behavior.
- Drag/move writes occur at gesture end, not continuously.
- Use TDD for every production behavior change.

## Review Focus

- **Concurrent writers:** two actors updating different nodes from the same base SHA must not silently lose either write; the second operation retries once and returns 409 if still conflicting.
- **Shared files:** unlinking/deleting one node must not soft-delete a file still linked to another active node.
- **Public projection:** `data/public.json` and public routes must never contain hashes, sessions, membership/private auth objects, pending destructive actions, or deleted rows.
- **Repository outage/rate limit:** GitHub 403/429/5xx must fail closed without mutating local authoritative state or pretending a write succeeded.
- **Partial file operation:** a successful blob upload followed by failed `state.json` update must remain recoverable/idempotent and must not expose an unreferenced file through public APIs.

---

## File Structure

**New files**
- `src/github/client.js` — minimal authenticated GitHub REST client with structured errors and request injection for tests.
- `src/github/state-store.js` — read/write `data/state.json`, `data/public.json`, SHA/CAS retry, cache/TTL.
- `src/github/blob-store.js` — upload/read/replace file blobs under `files/<file-id>/`.
- `src/repositories/github-nexus-repository.js` — domain repository implementing the same logical methods currently used by the API/runtime.
- `src/auth/github-auth-store.js` — admin hash, browser sessions, owner credentials, pending destructive actions backed by state store.
- `scripts/seed-github-data.mjs` — initialize `NEXUS-DATA` from seed/snapshot.
- `scripts/verify-github-data.mjs` — compare source snapshot with GitHub state/files.
- `test/github-client.test.js`
- `test/github-state-store.test.js`
- `test/github-blob-store.test.js`
- `test/github-repository.test.js`
- `test/github-auth-store.test.js`
- `test/github-runtime.test.js`
- `test/github-migration.test.js`

**Existing files to modify**
- `src/config/env.js` — replace Supabase config with GitHub repository configuration.
- `src/runtime.js` (or current composition module) — instantiate GitHub adapters instead of Supabase adapters.
- `src/server.js` — keep thin entrypoint; no persistence logic.
- `src/routes/public.js` — consume unchanged repository contract only; no GitHub-specific code.
- `src/routes/v2.js` — consume unchanged repository/blob/auth interfaces only.
- `src/routes/admin.js` — consume unchanged auth store/session interfaces only.
- `scripts/export-live.mjs` — retain as source snapshot tool; add GitHub seed compatibility if required.
- `docs/NEXUS-PLUGIN-SETUP.md` — replace Supabase setup with GitHub/Render secret setup.
- `mcp/site-prompt.md` — no backend-specific secret disclosure; preserve API contract.

**Files to retire after cutover verification**
- `src/db/supabase.js`
- Supabase-specific repository/storage/auth modules, if present.
- `supabase/` migrations/assets, after final branch verification confirms no runtime reference.

---

### Task 1: Build the GitHub REST client boundary

**Files:**
- Create: `src/github/client.js`
- Create: `test/github-client.test.js`
- Modify: `src/config/env.js`
- Test: `test/env.test.js`

**Interfaces:**
- Produces `createGitHubClient({ owner, repo, branch, token, fetchImpl })`.
- Client methods: `getContent(path)`, `putContent(path,{contentBase64,sha,message})`, `deleteContent(path,{sha,message})`, `createBlob({content,encoding})`, `getBlob(sha)`, `getRef()`, `createTree({baseTreeSha,entries})`, `createCommit({message,treeSha,parentSha})`, `updateRef({sha})`.
- Config produces `githubOwner`, `githubRepo`, `githubBranch`, `githubToken` from server-only environment.

- [ ] **Step 1: Write failing GitHub client/config tests**

Test names/assertions:
- `github client sends bearer auth and API version headers`.
- `github client maps 409/422 stale-sha responses to GitHubConflictError`.
- `github client exposes retry-after metadata for 403/429 rate-limit responses`.
- `server config requires NEXUS_GITHUB_OWNER, NEXUS_GITHUB_REPO, NEXUS_GITHUB_TOKEN`.
- `serialized config never includes githubToken`.

- [ ] **Step 2: Run RED tests**

Run: `node --test test/github-client.test.js test/env.test.js`
Expected: FAIL because GitHub client/config fields do not exist.

- [ ] **Step 3: Implement minimal client/config**

No Octokit dependency unless native `fetch` proves insufficient. All GitHub-specific HTTP logic stays in `src/github/client.js`.

- [ ] **Step 4: Run GREEN tests and full suite**

Run: `node --test test/github-client.test.js test/env.test.js && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

Commit: `feat: add github persistence client`

---

### Task 2: Implement SHA-safe state storage and public projection

**Files:**
- Create: `src/github/state-store.js`
- Create: `test/github-state-store.test.js`

**Interfaces:**
- Produces `createGitHubStateStore({ client, statePath='data/state.json', publicPath='data/public.json', cacheTtlMs=2000 })`.
- Methods: `readState({fresh?}) -> {state,sha}`, `mutate(mutator,{message,actor,source}) -> {state,sha}`, `readPublic()`, `writePublicProjection(state,{expectedSha?})`.
- `mutate` retries one time after stale-SHA conflict, then throws domain `ConflictError` for HTTP 409 mapping.

- [ ] **Step 1: Write failing state-store tests**

Cover:
- first read returns parsed state + SHA;
- cache is used inside TTL and `fresh:true` bypasses it;
- mutation writes using the read SHA;
- stale SHA causes one re-read/reapply;
- second conflict raises `ConflictError` and does not claim success;
- public projection excludes `apiCredentials`, `browserSessions`, `adminSettings`, `pendingDestructiveActions`, members/profiles not explicitly public, and `deletedAt` rows;
- GitHub 403/429/5xx propagates as failure without updating cache as if write succeeded.

- [ ] **Step 2: Run RED test**

Run: `node --test test/github-state-store.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement state store and projection**

Every successful content mutation must update authoritative state first, then public projection; if public projection fails, mark/report projection stale but do not roll back an already committed authoritative write.

- [ ] **Step 4: Run GREEN + full suite**

Run: `node --test test/github-state-store.test.js && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

Commit: `feat: add sha-safe github state store`

---

### Task 3: Replace Supabase domain persistence with `GitHubNexusRepository`

**Files:**
- Create: `src/repositories/github-nexus-repository.js`
- Create: `test/github-repository.test.js`
- Modify: repository contract tests to run against GitHub adapter.

**Interfaces:**
- Produces `createGitHubNexusRepository({ stateStore, now, idFactory })`.
- Must satisfy existing runtime/API methods for graph, nodes, edges, file metadata/linking, activity, migration upserts, and destructive preview/apply.
- All writes go through `stateStore.mutate` and append one activity event atomically in the same authoritative state commit.

- [ ] **Step 1: Write failing contract tests**

Cover existing repository behavior plus:
- create/update/search/get graph preserves `/api/v2` shapes;
- activity event is included in the same successful state commit;
- workspace isolation is enforced in domain methods even though v1 has one owner workspace;
- soft-deleted nodes/edges/files are excluded by default;
- unlinking one node does not delete a multiply-linked file;
- `previewDestructive` accurately lists affected edges/file links;
- concurrent operation conflict becomes domain 409, not silent overwrite.

- [ ] **Step 2: Run RED**

Run: `node --test test/github-repository.test.js test/repository-contract.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement repository using state-store mutations only**

Do not import GitHub HTTP client directly here; repository only knows the state-store abstraction.

- [ ] **Step 4: Run GREEN + full suite**

Run: `node --test test/github-repository.test.js test/repository-contract.test.js && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

Commit: `feat: replace nexus repository with github state`

---

### Task 4: Implement GitHub file blob storage with recoverable writes

**Files:**
- Create: `src/github/blob-store.js`
- Create: `test/github-blob-store.test.js`
- Modify: file-related repository/API tests as needed without changing route contracts.

**Interfaces:**
- Produces `createGitHubBlobStore({ client, stateStore, maxBytes=20*1024*1024 })`.
- Methods: `putFile({fileId,name,mime,buffer,actor})`, `getFile(fileRecord)`, `replaceFile({fileId,name,mime,buffer,actor})`.
- Git path: `files/<file-id>/<sanitized-name>`; metadata remains authoritative in `state.json`.

- [ ] **Step 1: Write failing blob tests**

Cover:
- rejects >20 MB before GitHub call;
- filename sanitization prevents path traversal;
- upload creates Git blob/tree commit and records resulting blob/path metadata in state;
- read retrieves exact binary bytes;
- replacement creates new blob and updates state only after commit succeeds;
- blob/tree succeeds but state mutation fails: retry is idempotent and orphan is not visible through API/public projection;
- no physical delete occurs during ordinary soft-delete/unlink.

- [ ] **Step 2: Run RED**

Run: `node --test test/github-blob-store.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement blob store**

Use Git Data API primitives for binary-safe blobs and commits. Never place base64 file content in `state.json`.

- [ ] **Step 4: Run GREEN + full suite**

Run: `node --test test/github-blob-store.test.js && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

Commit: `feat: store nexus files in github blobs`

---

### Task 5: Persist authentication/session/destructive state in GitHub state

**Files:**
- Create: `src/auth/github-auth-store.js`
- Create: `test/github-auth-store.test.js`
- Modify: `src/auth/browser-session.js`, `src/auth/owner-token.js`, `src/services/destructive-actions.js` only where adapter wiring requires it.

**Interfaces:**
- Produces `createGitHubAuthStore({ stateStore })` with `getAdminHash`, `setAdminHash`, `create/get/revokeBrowserSession`, `list/create/revokeApiCredential`, `put/get/consumePendingDestructiveAction`.
- Raw password/token values never enter persisted state.

- [ ] **Step 1: Write failing auth tests**

Cover:
- browser session survives new process/adapter instance;
- revoked owner token stops authenticating immediately on fresh state read;
- only hashed credential is persisted;
- expired sessions and destructive confirmations fail closed;
- consumed confirmation cannot be reused;
- public projection never exposes auth/session/pending data.

- [ ] **Step 2: Run RED**

Run: `node --test test/github-auth-store.test.js test/owner-token.test.js test/destructive-actions.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement adapter and wire existing auth services**

Keep scrypt password hashing and existing owner-token hashing behavior unchanged.

- [ ] **Step 4: Run GREEN + full suite**

Run: `node --test test/github-auth-store.test.js test/owner-token.test.js test/destructive-actions.test.js && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

Commit: `feat: persist nexus auth in github state`

---

### Task 6: Switch runtime from Supabase to GitHub and remove runtime references

**Files:**
- Modify: `src/runtime.js` or current composition module.
- Modify: `src/server.js` only if entrypoint config names changed.
- Modify: `src/config/env.js`.
- Create: `test/github-runtime.test.js`.
- Remove after tests: `src/db/supabase.js` and all runtime-only Supabase adapters.
- Remove after tests: `supabase/` directory if no test/tool still consumes it.

**Interfaces:**
- Runtime composition creates `client -> stateStore -> repository/blobStore/authStore -> routes/server`.
- Existing route/public/admin/plugin contracts remain unchanged.

- [ ] **Step 1: Write failing runtime tests**

Cover:
- runtime starts with only GitHub config and no Supabase variables;
- repository/blob/auth implementations are GitHub-backed;
- `/api/v2/public/graph`, authenticated node write, file read, admin login/session, and destructive prepare/confirm work through injected GitHub fakes;
- runtime source contains no Supabase client/config import;
- restarting runtime against same fake GitHub state preserves data/session.

- [ ] **Step 2: Run RED**

Run: `node --test test/github-runtime.test.js`
Expected: FAIL.

- [ ] **Step 3: Switch composition and remove Supabase runtime code**

Do not change frontend/MCP route names.

- [ ] **Step 4: Run complete verification**

Run: `npm test && npm run verify`
Expected: all tests/verification PASS; grep/static checks find no production Supabase reference.

- [ ] **Step 5: Commit**

Commit: `refactor: run nexus entirely on github persistence`

---

### Task 7: Seed `NEXUS-DATA`, stage on Render, verify, then cut over

**Files:**
- Create: `scripts/seed-github-data.mjs`
- Create: `scripts/verify-github-data.mjs`
- Create: `test/github-migration.test.js`
- Modify: `docs/NEXUS-PLUGIN-SETUP.md`
- Modify: `mcp/site-prompt.md` only if secret/config wording is backend-specific.

**Interfaces:**
- `buildInitialGitHubState(snapshot,{workspaceId,ownerUserId}) -> StateV1`.
- `verifyGitHubMigration(source,target) -> {ok,counts,missing,extra}`.

- [ ] **Step 1: Write failing migration tests**

Cover:
- seed preserves legacy node IDs or stores deterministic `legacyId` mapping;
- edges remain valid after import;
- one file linked to multiple nodes remains one file record with multiple links;
- seed is idempotent when target is already initialized;
- secret-like fields from source are never copied as raw values;
- verifier detects node/edge/file/link count mismatch and sample-content mismatch.

- [ ] **Step 2: Run RED**

Run: `node --test test/github-migration.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement seed/verifier and documentation**

Document exact required Render variables:
- `NEXUS_GITHUB_OWNER`
- `NEXUS_GITHUB_REPO=NEXUS-DATA`
- `NEXUS_GITHUB_BRANCH=main`
- `NEXUS_GITHUB_TOKEN` (secret only)
- existing owner/workspace/server variables still required by runtime.

- [ ] **Step 4: User action — create private repository `NEXUS-DATA`**

Because the available GitHub connector cannot create a repository, the user creates it as **Private**, under the primary account, with an initial README/main branch. After creation, reconnect/refresh GitHub app repository access if the repository is not visible to the connector.

- [ ] **Step 5: Initialize real data repository**

Use the connected GitHub tools or seed script to create `data/state.json`, `data/public.json`, `README.md`, and any recoverable files from the best available snapshot. Never commit the GitHub write credential or raw ChatGPT owner token.

- [ ] **Step 6: Verify migration before Render cutover**

Compare node/edge/file/link counts and manually sample at least `GERAL`, `ROBÓTICA`, `FOGUETE`, and the MOBFOG project if present.
Expected: verifier `ok:true` or an explicit documented list of unrecoverable items accepted by the user.

- [ ] **Step 7: Create a staging Render service with auto-deploy disabled or separate staging branch**

Configure GitHub secret server-side, deploy the GitHub-persistence branch, and test:
- public graph read;
- admin login;
- create/edit/move node;
- upload/read file;
- destructive prepare/confirm;
- restart/redeploy and verify persistence;
- revoked ChatGPT token fails.

- [ ] **Step 8: End-to-end ChatGPT test**

Connect the private `@NEXUS` plugin to staging, then from a fresh chat create a uniquely named test node. Confirm it appears on staging site; edit it on site and confirm a fresh plugin read sees the edit; delete through explicit confirmation.

- [ ] **Step 9: Production cutover**

Only after staging passes: configure production Render GitHub variables, deploy the verified commit, confirm health/public graph/admin/files, and keep the prior Render commit available for rollback.

- [ ] **Step 10: Rollback drill**

Verify application rollback to previous Render commit and data rollback instructions from a prior `state.json` Git commit without actually discarding new production data.

- [ ] **Step 11: Final verification and commit**

Run: `npm test && npm run verify`
Expected: PASS.

Commit: `docs: finalize github persistence migration and operations`
