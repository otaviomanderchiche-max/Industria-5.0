export function sanitizeFileName(name){
  const clean=String(name||'').replace(/[\\/\r\n\t\0]/g,'_').slice(0,120);
  return clean||'arquivo';
}

export function createGitHubBlobStore({client,maxBytes=20*1024*1024}={}){
  if(!client?.createBlob||!client?.getBlob)throw new Error('client GitHub obrigatório');
  async function stage(path,data,mime){
    const buffer=Buffer.isBuffer(data)?data:Buffer.from(data);
    if(!buffer.length)throw new Error('Arquivo vazio');
    if(buffer.length>maxBytes)throw new Error('Limite 20 MB');
    const blob=await client.createBlob({content:buffer.toString('base64'),encoding:'base64'});
    return{path:String(path),blobSha:blob.sha,size:buffer.length,mime:mime||'application/octet-stream'};
  }
  return {
    upload:stage,
    replace:stage,
    async download(fileOrPath,blobShaArg){
      const blobSha=typeof fileOrPath==='object'&&fileOrPath?fileOrPath.blobSha:blobShaArg;
      if(!blobSha)throw new Error('blobSha obrigatório para leitura');
      const blob=await client.getBlob(blobSha);
      const encoding=blob?.encoding||'base64';
      return Buffer.from(String(blob?.content||'').replace(/\s/g,''),encoding==='base64'?'base64':'utf8');
    },
    async remove(paths){return{softOnly:true,paths:[...(paths||[])]}}
  };
}
