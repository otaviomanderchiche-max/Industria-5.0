import test from 'node:test';
import assert from 'node:assert/strict';
import { buildInitialGitHubState } from '../scripts/seed-github-data.mjs';
import { verifyGitHubMigration } from '../scripts/verify-github-data.mjs';
const snapshot={graph:{nodes:[{id:'geral',name:'GERAL',type:'root',x:0,y:0},{id:'foguete',name:'FOGUETE',type:'area',x:1,y:2,fileId:'f1'}],edges:[{source:'geral',target:'foguete'}]},files:[{id:'f1',ok:true,name:'relatorio.pdf',mime:'application/pdf',size:10,path:'files/f1.bin'}]};
test('buildInitialGitHubState preserves legacy ids and file links',()=>{const state=buildInitialGitHubState(snapshot,{workspaceId:'w1',ownerUserId:'u1'});assert.deepEqual(state.nodes.map(n=>n.id),['geral','foguete']);assert.equal(state.edges[0].source,'geral');assert.equal(state.edges[0].target,'foguete');assert.equal(state.files[0].id,'f1');assert.deepEqual(state.nodeFiles,[{nodeId:'foguete',fileId:'f1'}]);assert.equal(state.members[0].userId,'u1');assert.equal(state.workspace.id,'w1');});
test('verifyGitHubMigration reports exact content count mismatch',()=>{const state=buildInitialGitHubState(snapshot,{workspaceId:'w1',ownerUserId:'u1'});assert.equal(verifyGitHubMigration(snapshot,state).ok,true);state.edges=[];const report=verifyGitHubMigration(snapshot,state);assert.equal(report.ok,false);assert.equal(report.expected.edges,1);assert.equal(report.actual.edges,0);});
