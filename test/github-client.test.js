import test from 'node:test';
import assert from 'node:assert/strict';
import { createGitHubClient, GitHubConflictError, GitHubRateLimitError } from '../src/github/client.js';

function response(status, body='', headers={}) {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {status, headers:{'content-type':'application/json',...headers}});
}

test('github client sends bearer auth and API version headers', async () => {
  const seen=[];
  const fetchImpl=async (url,opts)=>{seen.push({url,opts});return response(200,{content:'e30=',sha:'abc'});};
  const client=createGitHubClient({owner:'me',repo:'NEXUS-DATA',branch:'main',token:'top-secret',fetchImpl});
  await client.getContent('data/state.json');
  assert.equal(seen.length,1);
  assert.equal(seen[0].opts.headers.authorization,'Bearer top-secret');
  assert.equal(seen[0].opts.headers['x-github-api-version'],'2022-11-28');
  assert.equal(seen[0].opts.headers.accept,'application/vnd.github+json');
});

test('github client maps 409/422 stale-sha responses to GitHubConflictError', async () => {
  for (const status of [409,422]) {
    const client=createGitHubClient({owner:'me',repo:'NEXUS-DATA',branch:'main',token:'x',fetchImpl:async()=>response(status,{message:'conflict'})});
    await assert.rejects(()=>client.putContent('data/state.json',{contentBase64:'e30=',sha:'old',message:'x'}),GitHubConflictError);
  }
});

test('github client exposes retry-after metadata for 403/429 rate-limit responses', async () => {
  for (const status of [403,429]) {
    const client=createGitHubClient({owner:'me',repo:'NEXUS-DATA',branch:'main',token:'x',fetchImpl:async()=>response(status,{message:'rate'},{'retry-after':'7','x-ratelimit-reset':'123'})});
    await assert.rejects(async()=>{await client.getContent('data/state.json');}, err=>{assert.ok(err instanceof GitHubRateLimitError);assert.equal(err.retryAfter,7);assert.equal(err.rateLimitReset,'123');return true;});
  }
});
