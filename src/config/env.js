export function loadServerConfig(env = process.env) {
  for (const key of ['SUPABASE_URL','SUPABASE_SERVER_KEY','NEXUS_WORKSPACE_ID']) {
    if (!env[key]) throw new Error(`Missing ${key}`);
  }
  return Object.freeze({
    supabaseUrl: env.SUPABASE_URL.replace(/\/$/,''),
    serverCredential: env.SUPABASE_SERVER_KEY,
    workspaceId: env.NEXUS_WORKSPACE_ID,
    nodeEnv: env.NODE_ENV || 'development'
  });
}
export function publicConfigView(config) {
  return { supabaseUrl: config.supabaseUrl, workspaceId: config.workspaceId };
}
