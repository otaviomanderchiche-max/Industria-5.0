function expectedCounts(snapshot){
  const okFiles=new Set((snapshot.files||[]).filter(f=>f.ok).map(f=>f.id));
  return {
    nodes:snapshot.graph?.nodes?.length||0,
    edges:snapshot.graph?.edges?.length||0,
    files:okFiles.size,
    links:(snapshot.graph?.nodes||[]).filter(n=>n.fileId&&okFiles.has(n.fileId)).length
  };
}
export async function importSnapshot(repo,snapshot,ctx){
  const idMap=new Map();
  for(const n of snapshot.graph.nodes){
    const row=await repo.upsertLegacyNode(ctx.workspaceId,n.id,{name:n.name||'Sem nome',type:n.type||'project',meta:n.meta||'',note:n.note||'',x:Number.isFinite(n.x)?n.x:0,y:Number.isFinite(n.y)?n.y:0,createdBy:ctx.userId});
    idMap.set(n.id,row.id);
  }
  for(const e of snapshot.graph.edges){
    const source=idMap.get(e.source),target=idMap.get(e.target);if(!source||!target)throw new Error(`Dangling legacy edge ${e.source}->${e.target}`);
    await repo.upsertLegacyEdge(ctx.workspaceId,`${e.source}->${e.target}`,{source,target,type:e.type||'related',createdBy:ctx.userId});
  }
  const fileMap=new Map();
  for(const f of snapshot.files||[]){if(!f.ok)continue;const row=await repo.upsertLegacyFile(ctx.workspaceId,f.id,{name:f.name||f.id,mime:f.mime||'application/octet-stream',size:f.size||0,path:f.path||null,createdBy:ctx.userId});fileMap.set(f.id,row.id)}
  for(const n of snapshot.graph.nodes){if(n.fileId&&fileMap.has(n.fileId))await repo.linkFile(ctx,idMap.get(n.id),fileMap.get(n.fileId))}
  const actual=await repo.getMigrationCounts(ctx.workspaceId);return {ok:true,actual,expected:expectedCounts(snapshot),legacyNodeMap:Object.fromEntries(idMap)};
}
export async function verifyMigration(repo,snapshot,ctx){
  const expected=expectedCounts(snapshot),actual=await repo.getMigrationCounts(ctx.workspaceId);
  const ok=Object.keys(expected).every(k=>expected[k]===actual[k]);
  return {ok,expected,actual};
}
