import { randomUUID } from 'node:crypto';
import { error, result, requireObject } from '../http/json.js';
const canWrite=role=>role==='owner'||role==='editor';
const nodeId=path=>/^\/api\/v2\/nodes\/([^/]+)$/.exec(path)?.[1];
export async function handleV2Request(req,{actor,repo,destructiveService,storage}={}){
  if(!req.path?.startsWith('/api/v2/'))return null;
  if(req.path==='/api/v2/public/graph')return null;
  if(!actor)return error(401,'Não autorizado');
  if(req.method==='GET'&&req.path==='/api/v2/me')return result(200,{userId:actor.userId,workspaceId:actor.workspaceId,role:actor.role});
  if(req.method==='GET'&&req.path==='/api/v2/graph')return result(200,await repo.getGraph(actor));
  if(req.method==='GET'&&req.path==='/api/v2/search')return result(200,await repo.search(actor,String(req.query?.q||'')));
  if(req.method==='GET'&&req.path==='/api/v2/activity')return result(200,await repo.listActivity(actor,Number(req.query?.limit||50)));
  const id=nodeId(req.path);
  if(req.method==='GET'&&id)return result(200,await repo.getNode(actor,id));
  if(req.method==='POST'&&req.path==='/api/v2/nodes'){
    if(!canWrite(actor.role))return error(403,'Sem permissão de escrita');
    const body=requireObject(req.body);if(!String(body.name||'').trim())return error(400,'Nome obrigatório');
    const created=await repo.createNode(actor,{...body,name:String(body.name).trim()});
    return result(201,created);
  }
  if(req.method==='PATCH'&&id){
    if(!canWrite(actor.role))return error(403,'Sem permissão de escrita');
    const before=await repo.getNode(actor,id);if(!before)return error(404,'Nó não encontrado');
    const updated=await repo.updateNode(actor,id,requireObject(req.body));
    return result(200,updated);
  }
  if(req.method==='POST'&&req.path==='/api/v2/edges'){
    if(!canWrite(actor.role))return error(403,'Sem permissão de escrita');
    const created=await repo.createEdge(actor,requireObject(req.body));
    return result(201,created);
  }

  const nodeFiles=/^\/api\/v2\/nodes\/([^/]+)\/files$/.exec(req.path);
  if(req.method==='GET'&&nodeFiles)return result(200,await repo.listFiles(actor,nodeFiles[1]));
  if(req.method==='POST'&&req.path==='/api/v2/files'){
    if(!canWrite(actor.role))return error(403,'Sem permissão de escrita');
    if(!storage)return error(503,'Storage indisponível');
    const body=requireObject(req.body),name=String(body.name||'arquivo').replace(/[\/\r\n]/g,'_').slice(0,120),mime=String(body.mime||'application/octet-stream');
    const data=Buffer.from(String(body.data||''),'base64');if(!data.length)return error(400,'Arquivo vazio');if(data.length>20*1024*1024)return error(413,'Limite 20 MB');
    const storagePath=`${actor.workspaceId}/${randomUUID()}/${name}`;
    const staged=await storage.upload(storagePath,data,mime);
    let created;
    try{created=await repo.createFile(actor,{name,storagePath,mime,size:data.length,blobSha:staged?.blobSha});}catch(e){try{await storage.remove([storagePath])}catch{}throw e}
    for(const id of Array.isArray(body.nodeIds)?body.nodeIds:[])await repo.linkFile(actor,id,created.id);
    return result(201,created);
  }
  const fileContent=/^\/api\/v2\/files\/([^/]+)\/content$/.exec(req.path);
  if(req.method==='GET'&&fileContent){
    if(!storage)return error(503,'Storage indisponível');const file=await repo.getFile(actor,fileContent[1]);if(!file)return error(404,'Arquivo não encontrado');
    const rawBody=await storage.download(file),disposition=(file.mime||'').startsWith('text/')?'inline':'attachment';
    return {status:200,rawBody,headers:{'content-type':file.mime||'application/octet-stream','content-disposition':`${disposition}; filename*=UTF-8''${encodeURIComponent(file.name)}`}};
  }
  const fileMatch=/^\/api\/v2\/files\/([^/]+)$/.exec(req.path);
  if(req.method==='PUT'&&fileMatch){
    if(!canWrite(actor.role))return error(403,'Sem permissão de escrita');if(!storage)return error(503,'Storage indisponível');
    const before=await repo.getFile(actor,fileMatch[1]);if(!before)return error(404,'Arquivo não encontrado');const body=requireObject(req.body);
    const data=Buffer.from(String(body.data||''),'base64');if(!data.length)return error(400,'Arquivo vazio');if(data.length>20*1024*1024)return error(413,'Limite 20 MB');
    const mime=String(body.mime||before.mime||'application/octet-stream'),name=String(body.name||before.name).replace(/[\/\r\n]/g,'_').slice(0,120);
    const staged=await storage.replace(before.storagePath,data,mime);const updated=await repo.updateFile(actor,before.id,{name,mime,size:data.length,blobSha:staged?.blobSha});
    return result(200,updated);
  }
  if(req.method==='POST'&&req.path==='/api/v2/destructive/prepare'){
    if(!destructiveService)return error(503,'Serviço destrutivo indisponível');
    const body=requireObject(req.body);
    return result(200,await destructiveService.prepareDestructiveAction(actor,{action:body.action,targetId:body.targetId}));
  }
  if(req.method==='POST'&&req.path==='/api/v2/destructive/commit'){
    if(!destructiveService)return error(503,'Serviço destrutivo indisponível');
    const body=requireObject(req.body);
    if(!body.confirmationId)return error(400,'confirmationId obrigatório');
    return result(200,await destructiveService.confirmDestructiveAction(actor,body.confirmationId));
  }
  return error(404,'Não encontrado');
}
