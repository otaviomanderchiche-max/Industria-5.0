import { handlePublicRequest } from './routes/public.js';
import { handleV2Request } from './routes/v2.js';
import { handleAdminRequest } from './routes/admin.js';

function cookieMap(value=''){
  return Object.fromEntries(value.split(';').map(x=>x.trim()).filter(Boolean).map(part=>{const i=part.indexOf('=');return i<0?[part,'']:[part.slice(0,i),decodeURIComponent(part.slice(i+1))]}));
}
function bearer(value=''){
  const m=/^Bearer\s+(.+)$/i.exec(value);return m?.[1]||null;
}
export function createApp(deps){
  return {async handle(req){
    const headers=req.headers||{};
    const pub=await handlePublicRequest(req,{repo:deps.repo,workspaceId:deps.workspaceId,storage:deps.storage});
    if(pub)return pub;
    const sessionId=cookieMap(headers.cookie).nexus_session||null;
    const sessionActor=sessionId&&deps.sessionManager?.getSession?await deps.sessionManager.getSession(sessionId):null;
    const token=bearer(headers.authorization);
    const bearerActor=token&&deps.resolveBearerActor?await deps.resolveBearerActor(token):null;
    const actor=bearerActor||sessionActor||null;
    const admin=await handleAdminRequest({...req,sessionId},{authStore:deps.authStore,sessionManager:deps.sessionManager,ownerContext:deps.ownerContext,actor});
    if(admin)return admin;
    return handleV2Request(req,{actor,repo:deps.repo,destructiveService:deps.destructiveService,storage:deps.storage});
  }};
}
