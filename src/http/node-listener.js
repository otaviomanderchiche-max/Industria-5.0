import { readFile } from 'node:fs/promises';
import path from 'node:path';

const STATIC_FILES=new Set(['index.html','app.css','app.js','admin-ui.js','graph.js']);
const STATE_METHODS=new Set(['POST','PUT','PATCH','DELETE']);

function sendJson(res,status,body){
  res.writeHead(status,{'content-type':'application/json; charset=utf-8','x-content-type-options':'nosniff'});
  res.end(JSON.stringify(body));
}

async function readJsonBody(req){
  let raw='';
  for await(const chunk of req){
    raw+=chunk;
    if(raw.length>30*1024*1024)throw new Error('Payload grande');
  }
  if(!raw)return undefined;
  return JSON.parse(raw);
}

function sameOrigin(req){
  if(!req.headers.origin)return true;
  try{return new URL(req.headers.origin).host===req.headers.host}catch{return false}
}

function sessionCookie(id,nodeEnv){
  return `nexus_session=${encodeURIComponent(id)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800${nodeEnv==='production'?'; Secure':''}`;
}

export function createNodeRequestListener({app,publicRoot,nodeEnv='development'}){
  return async function nodeRequestListener(req,res){
    try{
      const url=new URL(req.url||'/','http://local');
      if(STATE_METHODS.has(req.method)&&!sameOrigin(req))return sendJson(res,403,{error:'Origem inválida'});
      const body=STATE_METHODS.has(req.method)?await readJsonBody(req):undefined;
      const request={
        method:req.method||'GET',
        path:url.pathname,
        query:Object.fromEntries(url.searchParams),
        headers:req.headers,
        body
      };
      const response=await app.handle(request);
      if(response){
        if(response.sessionId)res.setHeader('set-cookie',sessionCookie(response.sessionId,nodeEnv));
        if(request.path==='/api/auth/logout'&&response.status<400)res.setHeader('set-cookie','nexus_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
        if(response.rawBody!==undefined){
          res.writeHead(response.status,{'x-content-type-options':'nosniff',...(response.headers||{})});
          return res.end(response.rawBody);
        }
        return sendJson(res,response.status,response.body);
      }
      if(request.method==='GET'){
        const file=request.path==='/'?'index.html':request.path.slice(1);
        if(STATIC_FILES.has(file)){
          const data=await readFile(path.join(publicRoot,file));
          res.writeHead(200,{
            'content-type':file.endsWith('.html')?'text/html; charset=utf-8':file.endsWith('.css')?'text/css; charset=utf-8':'text/javascript; charset=utf-8',
            'content-security-policy':"default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'",
            'x-content-type-options':'nosniff'
          });
          return res.end(data);
        }
      }
      return sendJson(res,404,{error:'Não encontrado'});
    }catch(error){
      return sendJson(res,400,{error:error?.message||'Requisição inválida'});
    }
  };
}
