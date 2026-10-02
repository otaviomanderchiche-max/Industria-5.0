export function createSupabaseHttpClient({ supabaseUrl, serverCredential, fetchImpl = fetch }) {
  const base = `${supabaseUrl.replace(/\/$/,'')}/rest/v1`;
  const headers = { apikey: serverCredential, authorization: `Bearer ${serverCredential}`, 'content-type': 'application/json' };
  async function request(path, options = {}) {
    const response = await fetchImpl(`${base}${path}`, { ...options, headers: { ...headers, ...(options.headers || {}) } });
    const text = await response.text();
    let data = null;
    if (text) { try { data = JSON.parse(text); } catch { data = text; } }
    if (!response.ok) throw new Error(`Supabase ${response.status}: ${typeof data === 'string' ? data : JSON.stringify(data)}`);
    return data;
  }
  return { request };
}
