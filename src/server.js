import http from 'node:http';
import { createRuntime } from './runtime.js';

const PORT=Number(process.env.PORT||3000);
const {listener}=createRuntime();
const server=http.createServer(listener);
server.listen(PORT,()=>console.log(`NEXUS listening ${PORT}`));

export {server};
