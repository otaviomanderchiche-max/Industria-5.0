import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { loadServerConfig } from './config/env.js';
import { createGitHubClient } from './github/client.js';
import { createGitHubStateStore } from './github/state-store.js';
import { createGitHubBlobStore } from './github/blob-store.js';
import { createGitHubNexusRepository } from './repositories/github-nexus-repository.js';
import { createGitHubAuthStore } from './auth/github-auth-store.js';
import { createBrowserSessionManager } from './auth/browser-session.js';
import { authenticateOwnerToken } from './auth/owner-token.js';
import { createDestructiveActionService } from './services/destructive-actions.js';
import { createNodeRequestListener } from './http/node-listener.js';

export function createRuntime({env=process.env,fetchImpl=fetch,publicRoot=new URL('../public/',import.meta.url),githubClient=null}={}){
  const config=loadServerConfig(env);
  const client=githubClient||createGitHubClient({owner:config.githubOwner,repo:config.githubRepo,branch:config.githubBranch,token:config.githubToken,fetchImpl});
  const stateStore=createGitHubStateStore({client});
  const repo=createGitHubNexusRepository({stateStore});
  const securityStore=createGitHubAuthStore({stateStore,workspaceId:config.workspaceId});
  const storage=createGitHubBlobStore({client});
  const sessionManager=createBrowserSessionManager(securityStore);
  const ownerContext={userId:config.ownerUserId,workspaceId:config.workspaceId,role:'owner',source:'web'};
  const resolveBearerActor=async token=>authenticateOwnerToken(token,await securityStore.listActiveCredentials());
  const destructiveService=createDestructiveActionService({store:securityStore,repo});
  const app=createApp({workspaceId:config.workspaceId,repo,authStore:securityStore,sessionManager,ownerContext,resolveBearerActor,destructiveService,storage});
  const root=publicRoot instanceof URL?fileURLToPath(publicRoot):publicRoot;
  const listener=createNodeRequestListener({app,publicRoot:root,nodeEnv:config.nodeEnv});
  return {config,client,stateStore,repo,securityStore,storage,sessionManager,ownerContext,destructiveService,app,listener};
}
