export function loadServerConfig(env = process.env) {
  for (const key of ['NEXUS_GITHUB_OWNER','NEXUS_GITHUB_REPO','NEXUS_GITHUB_TOKEN','NEXUS_WORKSPACE_ID','NEXUS_OWNER_USER_ID']) {
    if (!env[key]) throw new Error(`Missing ${key}`);
  }
  return Object.freeze({
    githubOwner: env.NEXUS_GITHUB_OWNER,
    githubRepo: env.NEXUS_GITHUB_REPO,
    githubBranch: env.NEXUS_GITHUB_BRANCH || 'main',
    githubToken: env.NEXUS_GITHUB_TOKEN,
    workspaceId: env.NEXUS_WORKSPACE_ID,
    ownerUserId: env.NEXUS_OWNER_USER_ID,
    nodeEnv: env.NODE_ENV || 'development'
  });
}
export function publicConfigView(config) {
  return { workspaceId: config.workspaceId };
}
