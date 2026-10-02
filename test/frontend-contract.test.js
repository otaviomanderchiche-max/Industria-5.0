import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('frontend uses persistent v2 API and keeps admin entry point',async()=>{
  const app=(await readFile(new URL('../public/app.js',import.meta.url),'utf8'))+(await readFile(new URL('../public/admin-ui.js',import.meta.url),'utf8'));
  const html=await readFile(new URL('../public/index.html',import.meta.url),'utf8');
  assert.match(app,/\/api\/v2\/public\/graph/);
  assert.match(app,/\/api\/v2\/nodes/);
  assert.match(app,/\/api\/v2\/edges/);
  assert.match(app,/\/api\/v2\/files/);
  assert.match(app,/\/api\/v2\/destructive\/prepare/);
  assert.match(app,/\/api\/v2\/destructive\/commit/);
  assert.match(app,/confirmDestructive\('disconnect_edge'/);
  assert.doesNotMatch(app,/confirmDestructive\('disconnect_nodes'/);
  assert.doesNotMatch(app,/api\('\/api\/graph'/);
  assert.match(html,/id="adminBtn"/);
  assert.match(html,/Acessar modo administrativo/);
});

test('admin UI exposes secure ChatGPT credential management without embedding a token',async()=>{
  const app=(await readFile(new URL('../public/app.js',import.meta.url),'utf8'))+(await readFile(new URL('../public/admin-ui.js',import.meta.url),'utf8'));
  const html=await readFile(new URL('../public/index.html',import.meta.url),'utf8');
  assert.match(html,/id="chatgptAccess"/);
  assert.match(html,/Acesso ChatGPT/);
  assert.match(app,/\/api\/auth\/plugin-token/);
  assert.match(app,/\/api\/auth\/plugin-credentials/);
  assert.doesNotMatch(app,/nxs_[A-Za-z0-9_-]{16,}/);
});
