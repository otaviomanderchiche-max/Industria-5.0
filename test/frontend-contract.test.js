import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('current frontend keeps public graph load and admin entry point', async () => {
  const app = await readFile(new URL('../public/app.js', import.meta.url),'utf8');
  const html = await readFile(new URL('../public/index.html', import.meta.url),'utf8');
  assert.match(app, /api\('\/api\/graph'\)|api\('\/api\/graph',/);
  assert.match(html, /id="adminBtn"/);
  assert.match(html, /Acessar modo administrativo/);
});
