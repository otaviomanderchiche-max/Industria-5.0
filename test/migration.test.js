import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSnapshot, referencedFileIds } from '../scripts/export-live.mjs';
import { importSnapshot, verifyMigration } from '../src/services/migration.js';

test('live snapshot has stable migration shape', () => {
  const snapshot = normalizeSnapshot({graph:{nodes:[{id:'a',name:'A',x:0,y:0,fileId:'f1'}],edges:[]},files:[{id:'f1',name:'a.txt',ok:true}],sourceUrl:'https://example.test'});
  assert.equal(snapshot.sourceUrl,'https://example.test');assert.ok(snapshot.exportedAt);assert.deepEqual(snapshot.graph.nodes.map(n=>n.id),['a']);assert.deepEqual(snapshot.files.map(f=>f.id),['f1']);
});

test('referencedFileIds deduplicates graph file references',()=>assert.deepEqual(referencedFileIds({nodes:[{fileId:'f1'},{fileId:'f1'},{fileId:'f2'},{}],edges:[]}),['f1','f2']));

test('importSnapshot preserves legacy ids, remaps edges and is idempotent through repository upserts',async()=>{
  const nodes=new Map(),edges=new Map(),files=new Map(),links=new Set();let seq=0;
  const repo={
    async upsertLegacyNode(_w,legacy,data){if(!nodes.has(legacy))nodes.set(legacy,{id:`n${++seq}`,legacyId:legacy,...data});return nodes.get(legacy)},
    async upsertLegacyEdge(_w,key,data){if(!edges.has(key))edges.set(key,{id:`e${edges.size+1}`,...data});return edges.get(key)},
    async upsertLegacyFile(_w,legacy,data){if(!files.has(legacy))files.set(legacy,{id:`f${files.size+1}`,legacyId:legacy,...data});return files.get(legacy)},
    async linkFile(_ctx,nodeId,fileId){links.add(`${nodeId}:${fileId}`)},async getMigrationCounts(){return{nodes:nodes.size,edges:edges.size,files:files.size,links:links.size}}
  };
  const snapshot={graph:{nodes:[{id:'a',name:'A',x:0,y:0,fileId:'oldf'},{id:'b',name:'B',x:1,y:2}],edges:[{source:'a',target:'b'}]},files:[{id:'oldf',ok:true,name:'x.txt',mime:'text/plain',size:3,path:'files/oldf.bin'}]};
  const ctx={workspaceId:'w1',userId:'u1',role:'owner'};await importSnapshot(repo,snapshot,ctx);await importSnapshot(repo,snapshot,ctx);
  assert.equal(nodes.size,2);assert.equal(edges.size,1);assert.equal(files.size,1);assert.equal(links.size,1);assert.equal(nodes.get('a').legacyId,'a');assert.equal(edges.values().next().value.source,'n1');
});

test('verifyMigration reports count mismatches',async()=>{const repo={getMigrationCounts:async()=>({nodes:1,edges:0,files:0,links:0})};const snapshot={graph:{nodes:[{id:'a'},{id:'b'}],edges:[]},files:[]};const report=await verifyMigration(repo,snapshot,{workspaceId:'w1'});assert.equal(report.ok,false);assert.equal(report.expected.nodes,2);assert.equal(report.actual.nodes,1)});
