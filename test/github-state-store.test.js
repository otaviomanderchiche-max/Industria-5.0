import test from 'node:test';
import assert from 'node:assert/strict';
import { createGitHubStateStore, ConflictError, projectPublicState } from '../src/github/state-store.js';
import { GitHubConflictError } from '../src/github/client.js';

function encodeJson(v){return Buffer.from(JSON.stringify(v)).toString('base64')}
function fakeClient(initialState={schemaVersion:1,workspace:{id:'w1',isPublic:true},nodes:[],edges:[],files:[],nodeFiles:[],activity:[],apiCredentials:[],browserSessions:[],adminSettings:{},pendingDestructiveActions:[]}){
  let head='c1', tree='t1', state=structuredClone(initialState), publicState=projectPublicState(initialState), commits=0, conflictCount=0;
  return {
    get snapshot(){return {head,state:structuredClone(state),publicState:structuredClone(publicState),commits}},setConflicts(n){conflictCount=n},
    async getRef(){return {object:{sha:head}}},async getCommit(sha){assert.equal(sha,head);return {tree:{sha:tree}}},
    async getContent(path,{ref}={}){assert.equal(ref,head);const value=path==='data/state.json'?state:publicState;return {content:encodeJson(value)}},
    async commitAtomic({entries,message,parentSha,baseTreeSha}){if(conflictCount>0){conflictCount--;throw new GitHubConflictError('stale',{status:422});}assert.equal(parentSha,head);assert.equal(baseTreeSha,tree);for(const e of entries){if(e.path==='data/state.json')state=JSON.parse(Buffer.from(e.contentBase64,'base64'));if(e.path==='data/public.json')publicState=JSON.parse(Buffer.from(e.contentBase64,'base64'));}commits++;head=`c${commits+1}`;tree=`t${commits+1}`;return {sha:head,treeSha:tree,message};}
  };
}

test('readState returns parsed state and head sha and uses cache inside TTL',async()=>{let now=1000;const client=fakeClient();let refs=0;const original=client.getRef.bind(client);client.getRef=async()=>{refs++;return original()};const store=createGitHubStateStore({client,now:()=>now,cacheTtlMs:2000});const a=await store.readState(),b=await store.readState();assert.equal(a.headSha,'c1');assert.equal(a.state.workspace.id,'w1');assert.equal(refs,1);assert.equal(b.headSha,'c1');now=4000;await store.readState();assert.equal(refs,2);await store.readState({fresh:true});assert.equal(refs,3);});

test('mutation commits state, public projection and activity atomically',async()=>{const client=fakeClient();const store=createGitHubStateStore({client,cacheTtlMs:0,idFactory:()=> 'evt1',now:()=>Date.parse('2026-10-02T12:00:00Z')});const r=await store.mutate(draft=>{draft.nodes.push({id:'n1',workspaceId:'w1',name:'Secret?',type:'project',deletedAt:null});return{result:'ok',activityEvents:[{actorId:'u1',source:'web',action:'create',targetType:'node',targetId:'n1'}]}},{message:'nexus: create node'});assert.equal(r.result,'ok');const snap=client.snapshot;assert.equal(snap.commits,1);assert.equal(snap.state.nodes.length,1);assert.equal(snap.state.activity.length,1);assert.equal(snap.publicState.nodes.length,1);});

test('stale branch retries once then succeeds; second stale conflict becomes ConflictError',async()=>{const client=fakeClient();const store=createGitHubStateStore({client,cacheTtlMs:0});client.setConflicts(1);await store.mutate(d=>{d.nodes.push({id:'n1',workspaceId:'w1',name:'A'});return{result:'ok'}},{message:'x'});assert.equal(client.snapshot.state.nodes.length,1);client.setConflicts(2);await assert.rejects(()=>store.mutate(d=>{d.nodes.push({id:'n2',workspaceId:'w1',name:'B'});return{result:'x'}},{message:'y'}),ConflictError);assert.equal(client.snapshot.state.nodes.some(n=>n.id==='n2'),false);});

test('public projection strips secrets, pending actions and deleted rows',()=>{const state={schemaVersion:1,workspace:{id:'w1',isPublic:true},profiles:[{id:'p1',public:true,name:'Public'},{id:'p2',public:false,name:'Private'}],members:[{id:'m1'}],nodes:[{id:'n1',deletedAt:null},{id:'n2',deletedAt:'x'}],edges:[{id:'e1',deletedAt:null},{id:'e2',deletedAt:'x'}],files:[{id:'f1',deletedAt:null},{id:'f2',deletedAt:'x'}],nodeFiles:[{nodeId:'n1',fileId:'f1'}],apiCredentials:[{tokenHash:'x'}],browserSessions:[{id:'s'}],adminSettings:{passwordHash:'x'},pendingDestructiveActions:[{id:'p'}]};const pub=projectPublicState(state);assert.deepEqual(pub.profiles.map(p=>p.id),['p1']);assert.deepEqual(pub.nodes.map(n=>n.id),['n1']);assert.deepEqual(pub.files.map(f=>f.id),['f1']);for(const key of ['members','apiCredentials','browserSessions','adminSettings','pendingDestructiveActions'])assert.equal(key in pub,false);});
