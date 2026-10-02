import { createSupabaseHttpClient } from '../db/supabase.js';
const enc = encodeURIComponent;
const graphNode = r => ({ id:r.id, legacyId:r.legacy_id ?? undefined, name:r.name, type:r.type, meta:r.meta ?? '', note:r.note ?? '', x:r.x, y:r.y });
const graphEdge = r => ({ id:r.id, source:r.source_node_id, target:r.target_node_id, type:r.edge_type ?? 'related' });
export function createNexusRepository({ supabaseUrl, serverCredential, fetchImpl = fetch }) {
  const db = createSupabaseHttpClient({ supabaseUrl, serverCredential, fetchImpl });
  const list = (table, query) => db.request(`/${table}?${query}`);
  async function activeGraph(workspaceId) {
    const scope = `workspace_id=eq.${enc(workspaceId)}&deleted_at=is.null&select=*`;
    const [nodes,edges] = await Promise.all([list('nodes',scope),list('edges',scope)]);
    return { nodes:(nodes||[]).map(graphNode), edges:(edges||[]).map(graphEdge) };
  }
  return {
    async getPublicGraph(workspaceId) { const ws = await list('workspaces',`id=eq.${enc(workspaceId)}&is_public=eq.true&select=id`); if (!Array.isArray(ws) || ws.length !== 1) throw new Error('Workspace is not public'); return activeGraph(workspaceId); },
    async getGraph(ctx) { return activeGraph(ctx.workspaceId); },
    async getNode(ctx,id) { const rows = await list('nodes',`workspace_id=eq.${enc(ctx.workspaceId)}&id=eq.${enc(id)}&deleted_at=is.null&select=*`); return rows?.[0] ? graphNode(rows[0]) : null; },
    async search(ctx,q) { return (await list('nodes',`workspace_id=eq.${enc(ctx.workspaceId)}&deleted_at=is.null&name=ilike.*${enc(q)}*&select=*`)).map(graphNode); },
    async createNode(ctx,input) { const body={workspace_id:ctx.workspaceId,name:input.name,type:input.type||'project',meta:input.meta||'',note:input.note||'',x:input.x??0,y:input.y??0,created_by:ctx.userId}; const rows=await db.request('/nodes',{method:'POST',headers:{prefer:'return=representation'},body:JSON.stringify(body)}); return graphNode(rows[0]); },
    async updateNode(ctx,id,patch) { const body={}; for(const [k,v] of Object.entries(patch)){const m={legacyId:'legacy_id'}[k]||k;if(['name','type','meta','note','x','y','legacy_id'].includes(m))body[m]=v;} const rows=await db.request(`/nodes?workspace_id=eq.${enc(ctx.workspaceId)}&id=eq.${enc(id)}&deleted_at=is.null`,{method:'PATCH',headers:{prefer:'return=representation'},body:JSON.stringify(body)}); return rows?.[0] ? graphNode(rows[0]) : null; },
    async createEdge(ctx,input) { const body={workspace_id:ctx.workspaceId,source_node_id:input.source,target_node_id:input.target,edge_type:input.type||'related',created_by:ctx.userId}; const rows=await db.request('/edges',{method:'POST',headers:{prefer:'return=representation'},body:JSON.stringify(body)}); return graphEdge(rows[0]); },
    async linkFile(ctx,nodeId,fileId) { return db.request('/node_files',{method:'POST',headers:{prefer:'return=representation'},body:JSON.stringify({workspace_id:ctx.workspaceId,node_id:nodeId,file_id:fileId})}); },
    async unlinkFile(ctx,nodeId,fileId) { return db.request(`/node_files?workspace_id=eq.${enc(ctx.workspaceId)}&node_id=eq.${enc(nodeId)}&file_id=eq.${enc(fileId)}`,{method:'DELETE'}); },
    async writeActivity(ctx,event) { return db.request('/activity_log',{method:'POST',body:JSON.stringify({workspace_id:ctx.workspaceId,actor_user_id:ctx.userId,source:event.source,action:event.action,target_type:event.targetType,target_id:event.targetId??null,before_data:event.before??null,after_data:event.after??null})}); }
  };
}
