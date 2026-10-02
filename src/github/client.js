export class GitHubHttpError extends Error {
  constructor(message,{status,data,headers}={}){
    super(message);this.name='GitHubHttpError';this.status=status;this.data=data;this.headers=headers;
  }
}
export class GitHubConflictError extends GitHubHttpError {
  constructor(message,meta={}){super(message,meta);this.name='GitHubConflictError';}
}
export class GitHubRateLimitError extends GitHubHttpError {
  constructor(message,{status,data,headers,retryAfter,rateLimitReset}={}){
    super(message,{status,data,headers});this.name='GitHubRateLimitError';this.retryAfter=retryAfter;this.rateLimitReset=rateLimitReset;
  }
}

const encPath=path=>String(path).split('/').filter(Boolean).map(encodeURIComponent).join('/');

export function createGitHubClient({owner,repo,branch='main',token,fetchImpl=fetch}){
  if(!owner)throw new Error('owner obrigatório');if(!repo)throw new Error('repo obrigatório');if(!token)throw new Error('token obrigatório');
  const api='https://api.github.com';
  const common={accept:'application/vnd.github+json',authorization:`Bearer ${token}`,'x-github-api-version':'2022-11-28'};
  async function request(url,{method='GET',headers={},body}={}){
    const response=await fetchImpl(url,{method,headers:{...common,...headers},body});
    const text=await response.text();let data=null;
    if(text){try{data=JSON.parse(text)}catch{data=text}}
    if(!response.ok){
      const meta={status:response.status,data,headers:response.headers};
      const message=`GitHub ${response.status}: ${typeof data==='string'?data:(data?.message||JSON.stringify(data))}`;
      if(response.status===409||response.status===422)throw new GitHubConflictError(message,meta);
      if(response.status===429||response.status===403){
        const raw=response.headers.get('retry-after');
        const retryAfter=raw==null?null:Number(raw);
        throw new GitHubRateLimitError(message,{...meta,retryAfter:Number.isFinite(retryAfter)?retryAfter:null,rateLimitReset:response.headers.get('x-ratelimit-reset')});
      }
      throw new GitHubHttpError(message,meta);
    }
    return data;
  }
  const repoBase=`${api}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  return {
    async getContent(path,{ref=branch}={}){return request(`${repoBase}/contents/${encPath(path)}?ref=${encodeURIComponent(ref)}`)},
    async putContent(path,{contentBase64,sha,message}){return request(`${repoBase}/contents/${encPath(path)}`,{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({message,content:contentBase64,branch,...(sha?{sha}:{})})})},
    async deleteContent(path,{sha,message}){return request(`${repoBase}/contents/${encPath(path)}`,{method:'DELETE',headers:{'content-type':'application/json'},body:JSON.stringify({message,sha,branch})})},
    async createBlob({content,encoding='utf-8'}){return request(`${repoBase}/git/blobs`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({content,encoding})})},
    async getBlob(sha){return request(`${repoBase}/git/blobs/${encodeURIComponent(sha)}`)},
    async getRef(){return request(`${repoBase}/git/ref/heads/${encodeURIComponent(branch)}`)},
    async getCommit(sha){return request(`${repoBase}/git/commits/${encodeURIComponent(sha)}`)},
    async createTree({baseTreeSha,entries}){return request(`${repoBase}/git/trees`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({base_tree:baseTreeSha,tree:entries})})},
    async createCommit({message,treeSha,parentSha}){return request(`${repoBase}/git/commits`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({message,tree:treeSha,parents:[parentSha]})})},
    async updateRef({sha,force=false}){return request(`${repoBase}/git/refs/heads/${encodeURIComponent(branch)}`,{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({sha,force})})},
    async commitAtomic({entries,message,parentSha,baseTreeSha}){
      const treeEntries=[];
      for(const entry of entries){
        let sha=entry.sha;
        if(!sha){
          const blob=await this.createBlob({content:entry.contentBase64,encoding:'base64'});
          sha=blob.sha;
        }
        treeEntries.push({path:entry.path,mode:entry.mode||'100644',type:'blob',sha});
      }
      const tree=await this.createTree({baseTreeSha,entries:treeEntries});
      const commit=await this.createCommit({message,treeSha:tree.sha,parentSha});
      await this.updateRef({sha:commit.sha,force:false});
      return {sha:commit.sha,treeSha:tree.sha};
    }
  };
}
