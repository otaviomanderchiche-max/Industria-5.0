function expectedCounts(snapshot){
  const okFiles=new Set((snapshot.files||[]).filter(f=>f.ok).map(f=>f.id));
  const nodeFiles=new Set();
  for(const n of snapshot.graph?.nodes||[]){
    for(const id of [n.fileId,...(Array.isArray(n.fileIds)?n.fileIds:[])].filter(Boolean))if(okFiles.has(id))nodeFiles.add(`${n.id}:${id}`);
  }
  return {nodes:snapshot.graph?.nodes?.length||0,edges:snapshot.graph?.edges?.length||0,files:okFiles.size,links:nodeFiles.size};
}
export function verifyGitHubMigration(snapshot,state){
  const expected=expectedCounts(snapshot);
  const actual={nodes:(state.nodes||[]).filter(x=>!x.deletedAt).length,edges:(state.edges||[]).filter(x=>!x.deletedAt).length,files:(state.files||[]).filter(x=>!x.deletedAt).length,links:(state.nodeFiles||[]).length};
  const ok=Object.keys(expected).every(k=>expected[k]===actual[k]);
  return{ok,expected,actual};
}
