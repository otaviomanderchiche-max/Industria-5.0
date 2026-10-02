import { error, result } from '../http/json.js';
export async function handlePublicRequest(req,{repo,workspaceId,storage}={}){
  if(req.method==='GET'&&req.path==='/api/health')return result(200,{ok:true});
  if(req.method==='GET'&&req.path==='/api/v2/public/graph')return result(200,await repo.getPublicGraph(workspaceId));
  const nodeFiles=/^\/api\/v2\/public\/nodes\/([^/]+)\/files$/.exec(req.path);
  if(req.method==='GET'&&nodeFiles)return result(200,await repo.listPublicFiles(workspaceId,nodeFiles[1]));
  const fileContent=/^\/api\/v2\/public\/files\/([^/]+)\/content$/.exec(req.path);
  if(req.method==='GET'&&fileContent){
    if(!storage)return error(503,'Storage indisponível');const file=await repo.getPublicFile(workspaceId,fileContent[1]);if(!file)return error(404,'Arquivo não encontrado');
    const rawBody=await storage.download(file),disposition=(file.mime||'').startsWith('text/')?'inline':'attachment';
    return {status:200,rawBody,headers:{'content-type':file.mime||'application/octet-stream','content-disposition':`${disposition}; filename*=UTF-8''${encodeURIComponent(file.name)}`}};
  }
  return null;
}
