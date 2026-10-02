import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSnapshot, referencedFileIds } from '../scripts/export-live.mjs';

test('live snapshot has stable migration shape', () => {
  const snapshot = normalizeSnapshot({
    graph: {nodes:[{id:'a',name:'A',x:0,y:0,fileId:'f1'}],edges:[]},
    files: [{id:'f1',name:'a.txt',ok:true}],
    sourceUrl: 'https://example.test'
  });
  assert.equal(snapshot.sourceUrl, 'https://example.test');
  assert.ok(snapshot.exportedAt);
  assert.deepEqual(snapshot.graph.nodes.map(n=>n.id), ['a']);
  assert.deepEqual(snapshot.graph.edges, []);
  assert.deepEqual(snapshot.files.map(f=>f.id), ['f1']);
});

test('referencedFileIds deduplicates graph file references', () => {
  const ids = referencedFileIds({nodes:[{fileId:'f1'},{fileId:'f1'},{fileId:'f2'},{}],edges:[]});
  assert.deepEqual(ids, ['f1','f2']);
});
