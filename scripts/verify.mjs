import {execFileSync} from 'node:child_process';
import {readFileSync,readdirSync,statSync} from 'node:fs';
import path from 'node:path';

for(const f of ['src/server.js','src/runtime.js','src/github/client.js','src/github/state-store.js','src/github/blob-store.js','src/repositories/github-nexus-repository.js','src/auth/github-auth-store.js','public/app.js','public/graph.js'])execFileSync(process.execPath,['--check',f],{stdio:'inherit'});

function files(root){return readdirSync(root).flatMap(name=>{const p=path.join(root,name);return statSync(p).isDirectory()?files(p):[p]})}
const production=files('src').map(f=>[f,readFileSync(f,'utf8')]);
for(const [file,src] of production){
  if(/supabase/i.test(src))throw new Error(`Supabase runtime reference remains in ${file}`);
  if(/NEXUS_GITHUB_TOKEN\s*=\s*['\"][^'\"]+/i.test(src))throw new Error(`GitHub token literal leaked in ${file}`);
}
for(const f of files('public')){
  const src=readFileSync(f,'utf8');
  if(/NEXUS_GITHUB_TOKEN|githubToken|token_hash|password_hash/i.test(src))throw new Error(`Privileged secret reference leaked to public asset ${f}`);
}
console.log('Static/security verification OK');
