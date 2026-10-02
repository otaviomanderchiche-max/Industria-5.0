import { result } from '../http/json.js';
export async function handlePublicRequest(req,{repo,workspaceId}={}){ if(req.method==='GET'&&req.path==='/api/health')return result(200,{ok:true}); if(req.method==='GET'&&req.path==='/api/v2/public/graph')return result(200,await repo.getPublicGraph(workspaceId)); return null; }
