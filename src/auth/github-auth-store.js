export function createGitHubAuthStore({stateStore,workspaceId,now=()=>Date.now()}={}){
  if(!stateStore?.readState||!stateStore?.mutate)throw new Error('stateStore obrigatório');
  if(!workspaceId)throw new Error('workspaceId obrigatório');
  const read=async()=>{const {state}=await stateStore.readState({fresh:true});if(state.workspace?.id!==workspaceId)throw new Error('Workspace inválido');return state};
  return {
    async getAdminHash(){const state=await read();return state.adminSettings?.passwordHash||null},
    async setAdminHash(passwordHash){await stateStore.mutate(state=>{if(state.workspace?.id!==workspaceId)throw new Error('Workspace inválido');state.adminSettings={...(state.adminSettings||{}),workspaceId,passwordHash,updatedAt:new Date(now()).toISOString()};return{result:{ok:true}}},{message:'nexus: update admin password hash'})},
    async listActiveCredentials(){const state=await read();return (state.apiCredentials||[]).filter(r=>r.workspace_id===workspaceId&&!r.revoked_at).map(r=>structuredClone(r))},
    async putCredential(row){await stateStore.mutate(state=>{state.apiCredentials=Array.isArray(state.apiCredentials)?state.apiCredentials:[];state.apiCredentials.push({...row,workspace_id:workspaceId,created_at:row.created_at||new Date(now()).toISOString(),revoked_at:row.revoked_at??null});return{result:{ok:true}}},{message:`nexus: create api credential ${row.id}`})},
    async revokeCredential(id){await stateStore.mutate(state=>{const row=(state.apiCredentials||[]).find(r=>r.workspace_id===workspaceId&&r.id===id&&!r.revoked_at);if(row)row.revoked_at=new Date(now()).toISOString();return{result:{ok:!!row}}},{message:`nexus: revoke api credential ${id}`})},
    async putSession(row){await stateStore.mutate(state=>{state.browserSessions=Array.isArray(state.browserSessions)?state.browserSessions:[];const index=state.browserSessions.findIndex(r=>r.id===row.id&&r.workspace_id===workspaceId);const value={...row,workspace_id:workspaceId};if(index>=0)state.browserSessions[index]=value;else state.browserSessions.push(value);return{result:{ok:true}}},{message:'nexus: persist browser session'})},
    async getSession(id){const state=await read();const row=(state.browserSessions||[]).find(r=>r.workspace_id===workspaceId&&r.id===id);return row?structuredClone(row):null},
    async revokeSession(id){await stateStore.mutate(state=>{const row=(state.browserSessions||[]).find(r=>r.workspace_id===workspaceId&&r.id===id&&!r.revoked_at);if(row)row.revoked_at=new Date(now()).toISOString();return{result:{ok:!!row}}},{message:'nexus: revoke browser session'})},
    async putPending(row){await stateStore.mutate(state=>{state.pendingDestructiveActions=Array.isArray(state.pendingDestructiveActions)?state.pendingDestructiveActions:[];state.pendingDestructiveActions.push({...row,workspace_id:workspaceId});return{result:{ok:true}}},{message:`nexus: prepare destructive ${row.action}`})},
    async getPending(id){const state=await read();const row=(state.pendingDestructiveActions||[]).find(r=>r.workspace_id===workspaceId&&r.id===id);return row?structuredClone(row):null},
    async consumePending(id,consumedAt=now()){await stateStore.mutate(state=>{const row=(state.pendingDestructiveActions||[]).find(r=>r.workspace_id===workspaceId&&r.id===id&&!r.consumed_at);if(row)row.consumed_at=new Date(consumedAt).toISOString();return{result:{ok:!!row}}},{message:`nexus: consume destructive confirmation ${id}`})}
  };
}
