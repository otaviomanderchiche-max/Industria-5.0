import { randomBytes, randomUUID } from 'node:crypto';
import {hashPassword,verifyPassword} from '../auth/password.js';
import {hashOwnerToken} from '../auth/owner-token.js';
import {error,result} from '../http/json.js';

const ownerOnly=actor=>!!actor&&actor.role==='owner';
const publicCredential=row=>({id:row.id,label:row.label,role:row.role,createdAt:row.created_at,lastUsedAt:row.last_used_at??null,revokedAt:row.revoked_at??null});

export async function handleAdminRequest(req,{authStore,sessionManager,ownerContext,actor}={}){
  if(!req.path?.startsWith('/api/auth/'))return null;
  if(req.method==='GET'&&req.path==='/api/auth/status')return result(200,{configured:!!(await authStore.getAdminHash()),admin:!!actor});
  if(req.method==='POST'&&req.path==='/api/auth/setup'){
    if(await authStore.getAdminHash())return error(409,'Já configurado');
    const hash=hashPassword(req.body?.password);await authStore.setAdminHash(hash);const s=await sessionManager.createSession(ownerContext);return{status:201,body:{ok:true},sessionId:s.id};
  }
  if(req.method==='POST'&&req.path==='/api/auth/login'){
    const hash=await authStore.getAdminHash();if(!hash||!verifyPassword(req.body?.password,hash))return error(401,'Senha inválida');const s=await sessionManager.createSession(ownerContext);return{status:200,body:{ok:true},sessionId:s.id};
  }
  if(req.method==='POST'&&req.path==='/api/auth/logout'){await sessionManager.revokeSession(req.sessionId);return result(200,{ok:true});}
  if(req.method==='PUT'&&req.path==='/api/auth/password'){
    if(!actor)return error(401,'Não autorizado');await authStore.setAdminHash(hashPassword(req.body?.password));return result(200,{ok:true});
  }
  if(req.method==='GET'&&req.path==='/api/auth/plugin-credentials'){
    if(!ownerOnly(actor))return error(401,'Não autorizado');
    return result(200,(await authStore.listActiveCredentials()).map(publicCredential));
  }
  if(req.method==='POST'&&req.path==='/api/auth/plugin-token'){
    if(!ownerOnly(actor))return error(401,'Não autorizado');
    const token=`nxs_${randomBytes(32).toString('base64url')}`;
    const credential={id:randomUUID(),user_id:actor.userId,role:'owner',token_hash:hashOwnerToken(token),label:String(req.body?.label||'ChatGPT NEXUS').trim().slice(0,80)||'ChatGPT NEXUS'};
    await authStore.putCredential(credential);
    return result(201,{token,credential:{id:credential.id,label:credential.label,role:credential.role}});
  }
  const revoke=/^\/api\/auth\/plugin-credentials\/([^/]+)\/revoke$/.exec(req.path);
  if(req.method==='POST'&&revoke){
    if(!ownerOnly(actor))return error(401,'Não autorizado');
    await authStore.revokeCredential(revoke[1]);
    return result(200,{ok:true});
  }
  return error(404,'Não encontrado');
}
