import { randomUUID } from 'node:crypto';

const arr=(s,k)=>Array.isArray(s[k])?s[k]:(s[k]=[]);
const active=r=>r&&!r.deletedAt;
const nodeView=n=>n?({id:n.id,...(n.legacyId?{legacyId:n.legacyId}:{}),name:n.name,type:n.type||'project',meta:n.meta||'',note:n.note||'',x:n.x??0,y:n.y??0}):null;
const edgeView=e=>e?({id:e.id,source:e.source,target:e.target,type:e.type||'related'}):null;
const fileView=f=>f?({id:f.id,...(f.legacyId?{legacyId:f.legacyId}:{}),name:f.name,storagePath:f.storagePath,mime:f.mime||'application/octet-stream',size:f.size||0,...(f.sha256?{sha256:f.sha256}:{}),...(f.blobSha?{blobSha:f.blobSha}:{})}):null;
const activityView=a=>a?({id:a.id,source:a.source,action:a.action,targetType:a.targetType,targetId:a.targetId??null,before:a.before??null,after:a.after??null,createdAt:a.createdAt}):null;

function ensureWorkspace(state,workspaceId){
  if(!workspaceId||state.workspace?.id!==workspaceId)throw new Error('Workspace inválido');
}
function event(ctx,action,targetType,targetId,before=null,after=null){return{workspaceId:ctx.workspaceId,actorId:ctx.userId,source:ctx.source||'system',action,targetType,targetId,before,after};}

export function createGitHubNexusRepository({stateStore,idFactory=randomUUID,now=()=>Date.now()}={}){
  if(!stateStore?.readState||!stateStore?.mutate)throw new Error('stateStore obrigatório');
  async function read(ctxOrWorkspace){
    const workspaceId=typeof ctxOrWorkspace==='string'?ctxOrWorkspace:ctxOrWorkspace?.workspaceId;
    const {state}=await stateStore.readState();ensureWorkspace(state,workspaceId);return state;
  }
  async function graphFromState(state,workspaceId){
    ensureWorkspace(state,workspaceId);
    const nodes=arr(state,'nodes').filter(n=>n.workspaceId===workspaceId&&active(n)).map(nodeView);
    const ids=new Set(nodes.map(n=>n.id));
    const edges=arr(state,'edges').filter(e=>e.workspaceId===workspaceId&&active(e)&&ids.has(e.source)&&ids.has(e.target)).map(edgeView);
    return{nodes,edges};
  }
  const repo={
    async getPublicGraph(workspaceId){
      const state=await stateStore.readPublic();if(!state.workspace||state.workspace.id!==workspaceId)throw new Error('Workspace is not public');
      return graphFromState(state,workspaceId);
    },
    async listPublicFiles(workspaceId,nodeId){
      const state=await stateStore.readPublic();if(!state.workspace||state.workspace.id!==workspaceId)throw new Error('Workspace is not public');
      const ids=new Set(arr(state,'nodeFiles').filter(l=>l.nodeId===nodeId).map(l=>l.fileId));
      return arr(state,'files').filter(f=>f.workspaceId===workspaceId&&active(f)&&ids.has(f.id)).map(fileView);
    },
    async getPublicFile(workspaceId,id){
      const state=await stateStore.readPublic();if(!state.workspace||state.workspace.id!==workspaceId)throw new Error('Workspace is not public');
      return fileView(arr(state,'files').find(f=>f.workspaceId===workspaceId&&f.id===id&&active(f))||null);
    },
    async getGraph(ctx){return graphFromState(await read(ctx),ctx.workspaceId)},
    async getNode(ctx,id){const state=await read(ctx);return nodeView(arr(state,'nodes').find(n=>n.workspaceId===ctx.workspaceId&&n.id===id&&active(n))||null)},
    async search(ctx,q){
      const state=await read(ctx),needle=String(q||'').trim().toLocaleLowerCase('pt-BR');
      return arr(state,'nodes').filter(n=>n.workspaceId===ctx.workspaceId&&active(n)&&(!needle||`${n.name||''} ${n.meta||''} ${n.note||''}`.toLocaleLowerCase('pt-BR').includes(needle))).map(nodeView);
    },
    async createNode(ctx,input){
      const id=idFactory(),createdAt=new Date(now()).toISOString();let view;
      const out=await stateStore.mutate(state=>{ensureWorkspace(state,ctx.workspaceId);const row={id,workspaceId:ctx.workspaceId,name:input.name,type:input.type||'project',meta:input.meta||'',note:input.note||'',x:input.x??0,y:input.y??0,createdBy:ctx.userId,createdAt,updatedAt:createdAt,deletedAt:null};arr(state,'nodes').push(row);view=nodeView(row);return{result:view,activityEvents:[event(ctx,'create','node',id,null,view)]}},{message:`nexus: create node ${input.name}`});
      return out.result;
    },
    async updateNode(ctx,id,patch){
      let result=null;
      const out=await stateStore.mutate(state=>{ensureWorkspace(state,ctx.workspaceId);const row=arr(state,'nodes').find(n=>n.workspaceId===ctx.workspaceId&&n.id===id&&active(n));if(!row)return{result:null};const before=nodeView(row);for(const k of ['name','type','meta','note','x','y','legacyId'])if(patch[k]!==undefined)row[k]=patch[k];row.updatedAt=new Date(now()).toISOString();result=nodeView(row);return{result,activityEvents:[event(ctx,'update','node',id,before,result)]}},{message:`nexus: update node ${id}`});return out.result;
    },
    async createEdge(ctx,input){
      const id=idFactory(),createdAt=new Date(now()).toISOString();
      const out=await stateStore.mutate(state=>{ensureWorkspace(state,ctx.workspaceId);const nodes=arr(state,'nodes');for(const n of [input.source,input.target])if(!nodes.some(x=>x.workspaceId===ctx.workspaceId&&x.id===n&&active(x)))throw new Error('Nó da conexão não encontrado');const duplicate=arr(state,'edges').find(e=>e.workspaceId===ctx.workspaceId&&active(e)&&e.source===input.source&&e.target===input.target&&(e.type||'related')===(input.type||'related'));if(duplicate)return{result:edgeView(duplicate)};const row={id,workspaceId:ctx.workspaceId,source:input.source,target:input.target,type:input.type||'related',createdBy:ctx.userId,createdAt,deletedAt:null};arr(state,'edges').push(row);const view=edgeView(row);return{result:view,activityEvents:[event(ctx,'create','edge',id,null,view)]}},{message:`nexus: connect ${input.source} -> ${input.target}`});return out.result;
    },
    async linkFile(ctx,nodeId,fileId){
      const out=await stateStore.mutate(state=>{ensureWorkspace(state,ctx.workspaceId);if(!arr(state,'nodes').some(n=>n.id===nodeId&&n.workspaceId===ctx.workspaceId&&active(n)))throw new Error('Nó não encontrado');if(!arr(state,'files').some(f=>f.id===fileId&&f.workspaceId===ctx.workspaceId&&active(f)))throw new Error('Arquivo não encontrado');const links=arr(state,'nodeFiles');if(!links.some(l=>l.nodeId===nodeId&&l.fileId===fileId))links.push({nodeId,fileId});return{result:{nodeId,fileId}}},{message:`nexus: link file ${fileId} -> ${nodeId}`});return out.result;
    },
    async unlinkFile(ctx,nodeId,fileId){
      const out=await stateStore.mutate(state=>{ensureWorkspace(state,ctx.workspaceId);state.nodeFiles=arr(state,'nodeFiles').filter(l=>!(l.nodeId===nodeId&&l.fileId===fileId));return{result:{ok:true}}},{message:`nexus: unlink file ${fileId} -> ${nodeId}`});return out.result;
    },
    async createFile(ctx,input){
      const id=input.id||idFactory(),createdAt=new Date(now()).toISOString();
      const out=await stateStore.mutate(state=>{ensureWorkspace(state,ctx.workspaceId);const row={id,workspaceId:ctx.workspaceId,name:input.name,storagePath:input.storagePath,mime:input.mime||'application/octet-stream',size:input.size||0,sha256:input.sha256??null,blobSha:input.blobSha??null,createdBy:ctx.userId,createdAt,updatedAt:createdAt,deletedAt:null};arr(state,'files').push(row);const view=fileView(row);return{result:view,activityEvents:[event(ctx,'create','file',id,null,view)],extraEntries:input.blobSha&&input.storagePath?[{path:input.storagePath,sha:input.blobSha}]:[]}},{message:`nexus: create file ${input.name}`});return out.result;
    },
    async getFile(ctx,id){const state=await read(ctx);return fileView(arr(state,'files').find(f=>f.workspaceId===ctx.workspaceId&&f.id===id&&active(f))||null)},
    async updateFile(ctx,id,patch){
      const out=await stateStore.mutate(state=>{ensureWorkspace(state,ctx.workspaceId);const row=arr(state,'files').find(f=>f.workspaceId===ctx.workspaceId&&f.id===id&&active(f));if(!row)return{result:null};const before=fileView(row);for(const k of ['name','mime','size','sha256','storagePath','blobSha'])if(patch[k]!==undefined)row[k]=patch[k];row.updatedAt=new Date(now()).toISOString();const after=fileView(row);return{result:after,activityEvents:[event(ctx,'update','file',id,before,after)],extraEntries:patch.blobSha&&row.storagePath?[{path:row.storagePath,sha:patch.blobSha}]:[]}},{message:`nexus: update file ${id}`});return out.result;
    },
    async listFiles(ctx,nodeId){const state=await read(ctx),ids=new Set(arr(state,'nodeFiles').filter(l=>l.nodeId===nodeId).map(l=>l.fileId));return arr(state,'files').filter(f=>f.workspaceId===ctx.workspaceId&&active(f)&&ids.has(f.id)).map(fileView)},
    async listActivity(ctx,limit=50){const state=await read(ctx),safe=Math.max(1,Math.min(100,Number(limit)||50));return arr(state,'activity').filter(a=>!a.workspaceId||a.workspaceId===ctx.workspaceId).slice().sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt))).slice(0,safe).map(activityView)},
    async writeActivity(ctx,evt){
      const out=await stateStore.mutate(state=>{ensureWorkspace(state,ctx.workspaceId);return{result:{ok:true},activityEvents:[event(ctx,evt.action,evt.targetType,evt.targetId,evt.before??null,evt.after??null)]}},{message:`nexus: activity ${evt.action}`});return out.result;
    },
    async upsertLegacyNode(workspaceId,legacyId,data){
      const out=await stateStore.mutate(state=>{ensureWorkspace(state,workspaceId);let row=arr(state,'nodes').find(n=>n.workspaceId===workspaceId&&n.legacyId===legacyId);if(!row){row={id:idFactory(),workspaceId,legacyId,name:data.name,type:data.type||'project',meta:data.meta||'',note:data.note||'',x:data.x??0,y:data.y??0,createdBy:data.createdBy??null,createdAt:new Date(now()).toISOString(),deletedAt:null};arr(state,'nodes').push(row)}else{Object.assign(row,{name:data.name,type:data.type||row.type,meta:data.meta??row.meta,note:data.note??row.note,x:data.x??row.x,y:data.y??row.y,deletedAt:null})}return{result:nodeView(row)}} ,{message:`nexus: migrate node ${legacyId}`});return out.result;
    },
    async upsertLegacyEdge(workspaceId,legacyKey,data){
      const out=await stateStore.mutate(state=>{ensureWorkspace(state,workspaceId);let row=arr(state,'edges').find(e=>e.workspaceId===workspaceId&&e.legacyKey===legacyKey);if(!row){row={id:idFactory(),workspaceId,legacyKey,source:data.source,target:data.target,type:data.type||'related',createdBy:data.createdBy??null,createdAt:new Date(now()).toISOString(),deletedAt:null};arr(state,'edges').push(row)}else{Object.assign(row,{source:data.source,target:data.target,type:data.type||row.type,deletedAt:null})}return{result:edgeView(row)}} ,{message:`nexus: migrate edge ${legacyKey}`});return out.result;
    },
    async upsertLegacyFile(workspaceId,legacyId,data){
      const out=await stateStore.mutate(state=>{ensureWorkspace(state,workspaceId);let row=arr(state,'files').find(f=>f.workspaceId===workspaceId&&f.legacyId===legacyId);if(!row){row={id:idFactory(),workspaceId,legacyId,name:data.name,storagePath:data.path||`files/${legacyId}/${data.name}`,mime:data.mime||'application/octet-stream',size:data.size||0,createdBy:data.createdBy??null,createdAt:new Date(now()).toISOString(),deletedAt:null};arr(state,'files').push(row)}else{Object.assign(row,{name:data.name||row.name,storagePath:data.path||row.storagePath,mime:data.mime||row.mime,size:data.size??row.size,deletedAt:null})}return{result:fileView(row)}} ,{message:`nexus: migrate file ${legacyId}`});return out.result;
    },
    async getMigrationCounts(workspaceId){const state=await read(workspaceId);return{nodes:arr(state,'nodes').filter(n=>n.workspaceId===workspaceId&&active(n)).length,edges:arr(state,'edges').filter(e=>e.workspaceId===workspaceId&&active(e)).length,files:arr(state,'files').filter(f=>f.workspaceId===workspaceId&&active(f)).length,links:arr(state,'nodeFiles').length}},
    async previewDestructive(ctx,action,targetId){
      const state=await read(ctx);
      if(action==='delete_node'){
        const row=arr(state,'nodes').find(n=>n.workspaceId===ctx.workspaceId&&n.id===targetId&&active(n));if(!row)throw new Error('Nó não encontrado');
        return{action,node:nodeView(row),edges:arr(state,'edges').filter(e=>e.workspaceId===ctx.workspaceId&&active(e)&&(e.source===targetId||e.target===targetId)).map(edgeView),fileLinks:arr(state,'nodeFiles').filter(l=>l.nodeId===targetId).map(l=>({nodeId:l.nodeId,fileId:l.fileId}))};
      }
      if(action==='delete_file'){
        const row=arr(state,'files').find(f=>f.workspaceId===ctx.workspaceId&&f.id===targetId&&active(f));if(!row)throw new Error('Arquivo não encontrado');
        return{action,file:fileView(row),fileLinks:arr(state,'nodeFiles').filter(l=>l.fileId===targetId).map(l=>({nodeId:l.nodeId,fileId:l.fileId}))};
      }
      if(action==='disconnect_edge'){
        const row=arr(state,'edges').find(e=>e.workspaceId===ctx.workspaceId&&e.id===targetId&&active(e));if(!row)throw new Error('Conexão não encontrada');return{action,edge:edgeView(row)};
      }
      throw new Error('Ação destrutiva desconhecida');
    },
    async applyDestructive(ctx,action,targetId){
      const stamp=new Date(now()).toISOString();
      const out=await stateStore.mutate(state=>{ensureWorkspace(state,ctx.workspaceId);
        if(action==='delete_node'){
          const row=arr(state,'nodes').find(n=>n.workspaceId===ctx.workspaceId&&n.id===targetId&&active(n));if(!row)throw new Error('Nó não encontrado');const before=nodeView(row);row.deletedAt=stamp;for(const e of arr(state,'edges'))if(e.workspaceId===ctx.workspaceId&&active(e)&&(e.source===targetId||e.target===targetId))e.deletedAt=stamp;state.nodeFiles=arr(state,'nodeFiles').filter(l=>l.nodeId!==targetId);return{result:{nodes:1},activityEvents:[event(ctx,'delete','node',targetId,before,null)]};
        }
        if(action==='delete_file'){
          const row=arr(state,'files').find(f=>f.workspaceId===ctx.workspaceId&&f.id===targetId&&active(f));if(!row)throw new Error('Arquivo não encontrado');const before=fileView(row);row.deletedAt=stamp;state.nodeFiles=arr(state,'nodeFiles').filter(l=>l.fileId!==targetId);return{result:{files:1},activityEvents:[event(ctx,'delete','file',targetId,before,null)]};
        }
        if(action==='disconnect_edge'){
          const row=arr(state,'edges').find(e=>e.workspaceId===ctx.workspaceId&&e.id===targetId&&active(e));if(!row)throw new Error('Conexão não encontrada');const before=edgeView(row);row.deletedAt=stamp;return{result:{edges:1},activityEvents:[event(ctx,'delete','edge',targetId,before,null)]};
        }
        throw new Error('Ação destrutiva desconhecida');
      },{message:`nexus: ${action} ${targetId}`});return out.result;
    }
  };
  return repo;
}
