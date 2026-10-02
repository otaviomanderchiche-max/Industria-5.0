import {scryptSync,randomBytes,timingSafeEqual} from 'node:crypto';
export const hashPassword=p=>{if(typeof p!=='string'||p.length<12)throw Error('Senha deve ter pelo menos 12 caracteres');const salt=randomBytes(16).toString('hex');return `scrypt$${salt}$${scryptSync(p,salt,64).toString('hex')}`};
export const verifyPassword=(p,e)=>{try{const[,s,h]=e.split('$');return timingSafeEqual(Buffer.from(h,'hex'),scryptSync(p,s,64))}catch{return false}};
