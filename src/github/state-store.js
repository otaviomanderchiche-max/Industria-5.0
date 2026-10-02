import { randomUUID } from 'node:crypto';
import { GitHubConflictError } from './client.js';

export class ConflictError extends Error {
  constructor(message='Conflito de gravação'){super(message);this.name='ConflictError';this.status=409;}
}

const b64=v=>Buffer.from(typeof v==='string'?v:JSON.stringify(v)).toString('base64');
const parseContent=raw=>JSON.parse(Buffer.from(String(raw||'').replace(/\s/g,''),'base64').toString('utf8'));
const active=row=>!row?.deletedAt;
const safeArray=v=>Array.isArray(v)?v:[];

export function projectPublicState(state){
  const workspace=state.workspace?.isPublic===false?null:structuredClone(state.workspace||{});
  const nodes=safeArray(state.nodes).filter(active).map(x=>structuredClone(x));
  const nodeIds=new Set(nodes.map(n=>n.id));
  const edges=safeArray(state.edges).filter(e=>active(e)&&nodeIds.has(e.source)&&nodeIds.has(e.target)).map(x=>structuredClone(x));
  const files=safeArray(state.files).filter(active).map(x=>structuredClone(x));
  const fileIds=new Set(files.map(f=>f.id));
  const nodeFiles=safeArray(state.nodeFiles).filter(l=>nodeIds.has(l.nodeId)&&fileIds.has(l.fileId)).map(x=>structuredClone(x));
  return {
    schemaVersion:state.schemaVersion||1,
    workspace,
    profiles:safeArray(state.profiles).filter(p=>p.public===true).map(x=>structuredClone(x)),
    nodes,edges,files,nodeFiles,
    generatedAt:new Date().toISOString()
  };
}

export function createGitHubStateStore({client,statePath='data/state.json',publicPath='data/public.json',cacheTtlMs=2000,now=()=>Date.now(),idFactory=randomUUID}={}){
  if(!client)throw new Error('client obrigatório');
  let cache=null;
  async function loadFresh(){
    const ref=await client.getRef();const headSha=ref?.object?.sha;if(!headSha)throw new Error('GitHub ref sem SHA');
    const commit=await client.getCommit(headSha);const baseTreeSha=commit?.tree?.sha;if(!baseTreeSha)throw new Error('GitHub commit sem tree SHA');
    const content=await client.getContent(statePath,{ref:headSha});
    const state=parseContent(content.content);
    cache={state:structuredClone(state),headSha,baseTreeSha,loadedAt:now()};
    return {state:structuredClone(state),headSha,baseTreeSha};
  }
  async function readState({fresh=false}={}){
    if(!fresh&&cache&&now()-cache.loadedAt<cacheTtlMs)return {state:structuredClone(cache.state),headSha:cache.headSha,baseTreeSha:cache.baseTreeSha};
    return loadFresh();
  }
  async function readPublic(){
    const {headSha}=await readState();
    try{const content=await client.getContent(publicPath,{ref:headSha});return parseContent(content.content)}catch{return projectPublicState((await readState()).state)}
  }
  async function commitMutation(mutator,options,attempt){
    const base=await readState({fresh:true});
    const draft=structuredClone(base.state);
    draft.schemaVersion=draft.schemaVersion||1;
    draft.activity=safeArray(draft.activity);
    const change=(await mutator(draft))||{};
    const events=safeArray(change.activityEvents).map(evt=>({id:evt.id||idFactory(),createdAt:evt.createdAt||new Date(now()).toISOString(),...evt}));
    draft.activity.push(...events);
    const publicState=projectPublicState(draft);
    const entries=[
      {path:statePath,contentBase64:b64(JSON.stringify(draft,null,2))},
      {path:publicPath,contentBase64:b64(JSON.stringify(publicState,null,2))}
    ];
    for(const evt of events){
      const day=String(evt.createdAt).slice(0,10)||'unknown';
      entries.push({path:`data/activity/${day}/${evt.id}.json`,contentBase64:b64(JSON.stringify(evt,null,2))});
    }
    for(const entry of safeArray(change.extraEntries))entries.push(entry);
    try{
      const committed=await client.commitAtomic({entries,message:options.message||'nexus: update state',parentSha:base.headSha,baseTreeSha:base.baseTreeSha});
      cache={state:structuredClone(draft),headSha:committed.sha,baseTreeSha:committed.treeSha,loadedAt:now()};
      return {result:change.result,state:structuredClone(draft),headSha:committed.sha};
    }catch(err){
      cache=null;
      if(err instanceof GitHubConflictError){
        if(attempt<1)return commitMutation(mutator,options,attempt+1);
        throw new ConflictError();
      }
      throw err;
    }
  }
  return {
    readState,readPublic,
    async mutate(mutator,options={}){return commitMutation(mutator,options,0)},
    clearCache(){cache=null}
  };
}
