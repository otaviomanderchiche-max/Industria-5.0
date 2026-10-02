import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGitHubClient } from '../src/github/client.js';
import { projectPublicState } from '../src/github/state-store.js';
import { sanitizeFileName } from '../src/github/blob-store.js';
import { verifyGitHubMigration } from './verify-github-data.mjs';

const b64=v=>Buffer.from(typeof v==='string'?v:JSON.stringify(v)).toString('base64');

export function buildInitialGitHubState(snapshot,{workspaceId,ownerUserId,isPublic=true,now=()=>Date.now()}={}){
  if(!workspaceId||!ownerUserId)throw new Error('workspaceId e ownerUserId obrigatórios');
  if(!snapshot?.graph||!Array.isArray(snapshot.graph.nodes)||!Array.isArray(snapshot.graph.edges))throw new Error('Snapshot inválido');
  const createdAt=new Date(now()).toISOString();
  const nodes=snapshot.graph.nodes.map(n=>({id:String(n.id),legacyId:String(n.id),workspaceId,name:n.name||'Sem nome',type:n.type||'project',meta:n.meta||'',note:n.note||'',x:Number.isFinite(n.x)?n.x:0,y:Number.isFinite(n.y)?n.y:0,createdBy:ownerUserId,createdAt,updatedAt:createdAt,deletedAt:null}));
  const nodeIds=new Set(nodes.map(n=>n.id));
  const edges=snapshot.graph.edges.map((e,i)=>{if(!nodeIds.has(String(e.source))||!nodeIds.has(String(e.target)))throw new Error(`Dangling edge ${e.source}->${e.target}`);return{id:String(e.id||`edge-${i+1}`),legacyKey:`${e.source}->${e.target}`,workspaceId,source:String(e.source),target:String(e.target),type:e.type||'related',createdBy:ownerUserId,createdAt,deletedAt:null}});
  const files=(snapshot.files||[]).filter(f=>f.ok).map(f=>({id:String(f.id),legacyId:String(f.id),workspaceId,name:f.name||String(f.id),storagePath:`files/${encodeURIComponent(String(f.id))}/${sanitizeFileName(f.name||String(f.id))}`,mime:f.mime||'application/octet-stream',size:f.size||0,blobSha:null,createdBy:ownerUserId,createdAt,updatedAt:createdAt,deletedAt:null,sourcePath:f.path||null}));
  const fileIds=new Set(files.map(f=>f.id)),nodeFiles=[];
  for(const n of snapshot.graph.nodes){for(const fileId of [n.fileId,...(Array.isArray(n.fileIds)?n.fileIds:[])].filter(Boolean)){if(fileIds.has(String(fileId))&&!nodeFiles.some(l=>l.nodeId===String(n.id)&&l.fileId===String(fileId)))nodeFiles.push({nodeId:String(n.id),fileId:String(fileId)})}}
  return{schemaVersion:1,workspace:{id:workspaceId,name:'NEXUS',isPublic},profiles:[],members:[{userId:ownerUserId,workspaceId,role:'owner'}],nodes,edges,files,nodeFiles,activity:[],apiCredentials:[],browserSessions:[],adminSettings:{},pendingDestructiveActions:[]};
}

export async function seedGitHubRepository({client,snapshot,workspaceId,ownerUserId,snapshotDir,now=()=>Date.now()}){
  const state=buildInitialGitHubState(snapshot,{workspaceId,ownerUserId,now});
  const extraEntries=[];
  for(const file of state.files){
    const source=(snapshot.files||[]).find(f=>String(f.id)===file.id&&f.ok);
    if(!source?.path||!snapshotDir)continue;
    const bytes=await readFile(path.resolve(snapshotDir,source.path));
    if(bytes.length>20*1024*1024)throw new Error(`Arquivo ${file.name} excede 20 MB`);
    const blob=await client.createBlob({content:bytes.toString('base64'),encoding:'base64'});file.blobSha=blob.sha;file.size=bytes.length;extraEntries.push({path:file.storagePath,sha:blob.sha});
  }
  const ref=await client.getRef(),parentSha=ref.object.sha,commit=await client.getCommit(parentSha),baseTreeSha=commit.tree.sha;
  const publicState=projectPublicState(state);
  const committed=await client.commitAtomic({parentSha,baseTreeSha,message:'nexus: initialize persistent data',entries:[{path:'data/state.json',contentBase64:b64(JSON.stringify(state,null,2))},{path:'data/public.json',contentBase64:b64(JSON.stringify(publicState,null,2))},...extraEntries]});
  return{state,commitSha:committed.sha,verification:verifyGitHubMigration(snapshot,state)};
}

async function main(){
  const [snapshotPath]=process.argv.slice(2);if(!snapshotPath)throw new Error('Uso: node scripts/seed-github-data.mjs <snapshot.json>');
  for(const key of ['NEXUS_GITHUB_OWNER','NEXUS_GITHUB_REPO','NEXUS_GITHUB_TOKEN','NEXUS_WORKSPACE_ID','NEXUS_OWNER_USER_ID'])if(!process.env[key])throw new Error(`Missing ${key}`);
  const snapshot=JSON.parse(await readFile(snapshotPath,'utf8'));
  const client=createGitHubClient({owner:process.env.NEXUS_GITHUB_OWNER,repo:process.env.NEXUS_GITHUB_REPO,branch:process.env.NEXUS_GITHUB_BRANCH||'main',token:process.env.NEXUS_GITHUB_TOKEN});
  const result=await seedGitHubRepository({client,snapshot,workspaceId:process.env.NEXUS_WORKSPACE_ID,ownerUserId:process.env.NEXUS_OWNER_USER_ID,snapshotDir:path.dirname(path.resolve(snapshotPath))});
  console.log(JSON.stringify({commitSha:result.commitSha,verification:result.verification},null,2));
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(e=>{console.error(e.message);process.exitCode=1});

export { verifyGitHubMigration } from './verify-github-data.mjs';
