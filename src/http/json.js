export const result=(status,body)=>({status,body});
export const error=(status,message)=>result(status,{error:message});
export function requireObject(value){if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Invalid JSON body');return value}
