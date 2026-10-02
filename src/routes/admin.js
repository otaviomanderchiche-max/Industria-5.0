import {hashPassword,verifyPassword} from '../auth/password.js';
import {error,result} from '../http/json.js';
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
  return error(404,'Não encontrado');
}
