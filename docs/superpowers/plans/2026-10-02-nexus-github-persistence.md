# NEXUS GitHub Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace all Supabase persistence in NEXUS with a private GitHub repository (`NEXUS-DATA`) while preserving `/api/v2`, frontend behavior, admin mode, `@NEXUS`, files, audit history, and destructive confirmation.

**Architecture:** Render remains the application/backend host. A server-side GitHub adapter stores authoritative state in `data/state.json` and binary files under `files/`. Every mutation builds one Git commit containing the new `state.json`, `public.json`, an activity event, and any file blob changes; the branch head is updated only if based on the expected parent commit. This gives atomic multi-file writes plus optimistic concurrency without changing the public API contract.

**Tech Stack:** Node.js 24+, native `fetch`, Node test runner, GitHub REST Git Data/Contents APIs, Render, ChatGPT Sites/Plugins.

**Spec:** `docs/superpowers/specs/2026-10-02-nexus-github-persistence-design.md`

## Global Constraints

- No Supabase, SQL database, or Render Postgres in final runtime.
- Persistent source of truth: private GitHub repo `NEXUS-DATA`.
- `data/state.json` is authoritative; `data/public.json` is a public-safe projection only.
- Every mutation that changes persistent content writes state + public projection + activity event in one Git commit.
- Files are capped at 20 MB in v1.
- Browser/plugin never receive the GitHub write credential.
- GitHub credential stays server-side in Render and is scoped only to `NEXUS-DATA`.
- Existing `/api/v2` contracts remain stable.
- Destructive actions remain prepare/confirm; confirmations are actor-bound, single-use, and expire after 10 minutes.
- No raw password, ChatGPT owner token, GitHub credential, or privileged secret may appear in Git, logs, browser JS, or ChatGPT messages.
- Concurrent writes use optimistic concurrency; no silent last-writer-wins.
- Dragging a node persists at gesture end, not on every pointer move.
- TDD is mandatory for production behavior changes.

## Review Focus

- **Concurrent writers:** stale parent commit causes one re-read/reapply; a second conflict returns 409 without losing data.
- **Shared files:** unlink/delete of one node cannot delete a file still linked elsewhere.
- **Public projection:** public state/routes never expose hashes, sessions, private membership/auth state, pending confirmations, or deleted rows.
- **GitHub outage/rate limit:** 403/429/5xx fails closed and never claims a successful write.
- **Partial file write:** orphaned unreferenced blobs may exist, but cannot become visible unless the atomic state commit succeeds.

---

## File Structure

**Create**
- `src/github/client.js` — minimal authenticated GitHub REST client.
- `src/github/state-store.js` — state/public/activity atomic commit + cache + concurrency.
- `src/github/blob-store.js` — binary blob read/write/replace.
- `src/repositories/github-nexus-repository.js` — domain repository over state store.
- `src/auth/github-auth-store.js` — admin/session/token/confirmation persistence.
- `scripts/seed-github-data.mjs`
- `scripts/verify-github-data.mjs`
- `test/github-client.test.js`
- `test/github-state-store.test.js`
- `test/github-blob-store.test.js`
- `test/github-repository.test.js`
- `test/github-auth-store.test.js`
- `test/github-runtime.test.js`
- `test/github-migration.test.js`

**Modify**
- `src/config/env.js`
- runtime composition module (`src/runtime.js` if present)
- `src/server.js` only if config/entrypoint wiring requires it
- `src/routes/public.js`, `src/routes/v2.js`, `src/routes/admin.js` only through existing abstractions
- `scripts/export-live.mjs` if seed compatibility requires it
- `docs/NEXUS-PLUGIN-SETUP.md`
- `mcp/site-prompt.md` only if backend-specific wording exists

**Retire after cutover tests**
- `src/db/supabase.js`
- Supabase-specific repository/storage/auth modules
- `supabase/` assets if no runtime/test path still needs them

---

### Task 1: GitHub REST client and server-only configuration

**Files:** create `src/github/client.js`, `test/github-client.test.js`; modify `src/config/env.js`, `test/env.test.js`.

**Interfaces:**
- `createGitHubClient({ owner, repo, branch, token, fetchImpl })`
- methods: `getContent(path)`, `getBlob(sha)`, `getRef()`, `getCommit(sha)`, `createBlob({content,encoding})`, `createTree({baseTreeSha,entries})`, `createCommit({message,treeSha,parentSha})`, `updateRef({sha,expectedParentSha})`.
- config fields: `githubOwner`, `githubRepo`, `githubBranch`, `githubToken`.

- [ ] Write failing tests for auth/version headers, binary blob handling, 409/422 conflict mapping, 403/429 retry metadata, required env vars, and secret-safe config serialization.
- [ ] Run `node --test test/github-client.test.js test/env.test.js`; expect FAIL.
- [ ] Implement minimal native-`fetch` client and config.
- [ ] Run targeted tests + `npm test`; expect PASS.
- [ ] Commit `feat: add github persistence client`.

---

### Task 2: Atomic state/public/activity commits with optimistic concurrency

**Files:** create `src/github/state-store.js`, `test/github-state-store.test.js`.

**Interfaces:**
- `createGitHubStateStore({ client, statePath='data/state.json', publicPath='data/public.json', activityRoot='data/activity', cacheTtlMs=2000 })`
- `readState({fresh?}) -> {state,stateBlobSha,headCommitSha,treeSha}`
- `mutate(mutator,{message,actor,source,extraTreeEntries=[]}) -> {state,headCommitSha}`
- `readPublic()`
- `mutate` creates blobs for `state.json`, `public.json`, and `data/activity/YYYY-MM-DD/<event-id>.json`, creates one tree/commit from the previously read head, and advances the branch ref only from that expected parent.

- [ ] Write failing tests: initial read, TTL cache, fresh bypass, one atomic tree contains state+public+activity, stale head retries once, second conflict -> domain 409, public projection strips private/deleted fields, 403/429/5xx does not poison cache.
- [ ] Run `node --test test/github-state-store.test.js`; expect FAIL.
- [ ] Implement state store and public projection.
- [ ] Run targeted + full suite; expect PASS.
- [ ] Commit `feat: add atomic github state store`.

---

### Task 3: GitHub-backed domain repository

**Files:** create `src/repositories/github-nexus-repository.js`, `test/github-repository.test.js`; update repository contract tests.

**Interfaces:**
- `createGitHubNexusRepository({ stateStore, now, idFactory })`
- satisfy current graph/node/edge/file-metadata/link/activity/migration/destructive repository contract used by routes/runtime.
- all persistent mutations occur through `stateStore.mutate`.

- [ ] Write failing tests for graph/search shapes, create/update, workspace isolation, soft-delete filtering, multiply-linked file survival, destructive previews, migration upserts, activity API results, and concurrent conflict -> 409.
- [ ] Run `node --test test/github-repository.test.js test/repository-contract.test.js`; expect FAIL.
- [ ] Implement repository without importing GitHub HTTP directly.
- [ ] Run targeted + full suite; expect PASS.
- [ ] Commit `feat: replace nexus repository with github state`.

---

### Task 4: GitHub binary blob storage

**Files:** create `src/github/blob-store.js`, `test/github-blob-store.test.js`; adjust existing file API tests only as needed.

**Interfaces:**
- `createGitHubBlobStore({ client, stateStore, maxBytes=20*1024*1024 })`
- `putFile({fileId,name,mime,buffer,actor})`
- `getFile(fileRecord)`
- `replaceFile({fileId,name,mime,buffer,actor})`
- path: `files/<file-id>/<sanitized-name>`.
- upload/replacement passes file blob tree entries into the same atomic `stateStore.mutate` commit that updates metadata/public/activity.

- [ ] Write failing tests: >20 MB rejected before GitHub call, path traversal sanitized, exact binary round-trip, upload state+blob committed together, replacement updates metadata+blob together, failed ref update leaves no visible file, retry is idempotent, normal unlink/soft-delete never physically deletes blob.
- [ ] Run `node --test test/github-blob-store.test.js`; expect FAIL.
- [ ] Implement via Git Data blobs/tree/commit; never store base64 payload in state JSON.
- [ ] Run targeted + full suite; expect PASS.
- [ ] Commit `feat: store nexus files in github blobs`.

---

### Task 5: GitHub-backed admin/session/plugin/destructive auth state

**Files:** create `src/auth/github-auth-store.js`, `test/github-auth-store.test.js`; modify `browser-session.js`, `owner-token.js`, `destructive-actions.js` only for adapter wiring.

**Interfaces:**
- `createGitHubAuthStore({ stateStore })`
- methods: admin hash get/set; browser session create/get/revoke; API credential list/create/revoke; pending destructive action put/get/consume.

- [ ] Write failing tests: session survives process restart, revoked owner token fails on fresh read, only hashes persist, expired session/confirmation fail closed, confirmation cannot be reused, public projection contains none of these objects.
- [ ] Run `node --test test/github-auth-store.test.js test/owner-token.test.js test/destructive-actions.test.js`; expect FAIL.
- [ ] Implement adapter preserving existing scrypt/token hashing behavior.
- [ ] Run targeted + full suite; expect PASS.
- [ ] Commit `feat: persist nexus auth in github state`.

---

### Task 6: Switch runtime completely from Supabase to GitHub

**Files:** modify runtime composition, `src/config/env.js`, optionally `src/server.js`; create `test/github-runtime.test.js`; remove Supabase runtime modules only after green tests.

**Interfaces:** runtime composition becomes `GitHubClient -> GitHubStateStore -> GitHubNexusRepository/GitHubBlobStore/GitHubAuthStore -> routes/server`.

- [ ] Write failing runtime test proving GitHub-only config, public graph, admin login/session, authenticated node write, file read, destructive prepare/confirm, and persistence across runtime restart using GitHub fakes.
- [ ] Assert production runtime source has no Supabase import/config requirement.
- [ ] Run RED.
- [ ] Switch composition; retire Supabase runtime code/assets that are no longer referenced.
- [ ] Run `npm test && npm run verify`; expect PASS and no production Supabase references.
- [ ] Commit `refactor: run nexus entirely on github persistence`.

---

### Task 7: Seed private `NEXUS-DATA`, stage, verify, and cut over

**Files:** create `scripts/seed-github-data.mjs`, `scripts/verify-github-data.mjs`, `test/github-migration.test.js`; update plugin/setup docs.

**Interfaces:**
- `buildInitialGitHubState(snapshot,{workspaceId,ownerUserId}) -> StateV1`
- `verifyGitHubMigration(source,target) -> {ok,counts,missing,extra}`

- [ ] Write failing migration tests: legacy IDs/mapping, valid edges, one file-many-node links, idempotent seed, raw secrets excluded, verifier catches count/content mismatch.
- [ ] Run RED.
- [ ] Implement seed/verifier and document Render vars: `NEXUS_GITHUB_OWNER`, `NEXUS_GITHUB_REPO=NEXUS-DATA`, `NEXUS_GITHUB_BRANCH=main`, `NEXUS_GITHUB_TOKEN` (secret only).
- [ ] **User action:** create private `NEXUS-DATA` under the primary GitHub account with initial README/main branch, because the available connector does not expose repository creation. Refresh GitHub app repository access if needed.
- [ ] Initialize `data/state.json`, `data/public.json`, `README.md`, and recoverable file blobs from the best available snapshot.
- [ ] Verify nodes/edges/files/links and sample `GERAL`, `ROBÓTICA`, `FOGUETE`, MOBFOG if present; unresolved missing items must be explicitly listed before cutover.
- [ ] Create staging Render service/branch with production auto-deploy unaffected; configure GitHub secret server-side.
- [ ] Staging tests: public graph, admin login, create/edit/move node, file upload/read, destructive confirmation, restart persistence, revoked plugin token.
- [ ] Fresh-chat `@NEXUS` E2E: create unique test node -> see on site; edit on site -> read via plugin; delete only after confirmation.
- [ ] Production cutover only after staging passes; keep prior Render commit available for rollback.
- [ ] Verify rollback instructions for application and prior `state.json` commit without discarding current production data.
- [ ] Run final `npm test && npm run verify`; expect PASS.
- [ ] Commit `docs: finalize github persistence migration and operations`.

## Self-Review Result

- Spec coverage: all persistence, files, auth, public projection, activity files, concurrency, migration, rollback, staging, plugin and acceptance requirements mapped to tasks.
- Type/interface consistency: runtime consumes only the GitHub adapters defined in Tasks 1–5; route contracts remain unchanged.
- Atomicity correction: state, public projection, activity event and optional file tree entries are committed together in one Git commit before branch ref advancement.
- Review Focus coverage: concurrency Task 2/3; shared files Task 3/4; public projection Task 2/5; outage Task 1/2; partial file write Task 4.
- Scope/YAGNI: no LFS, SQL, vector search, realtime collaboration, or files >20 MB.
