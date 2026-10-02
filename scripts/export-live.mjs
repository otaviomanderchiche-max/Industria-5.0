import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function referencedFileIds(graph) {
  return [...new Set((graph?.nodes ?? []).map(n => n?.fileId).filter(Boolean))];
}

export function normalizeSnapshot({ graph, files = [], sourceUrl, exportedAt = new Date().toISOString() }) {
  if (!graph || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) throw new Error('Invalid graph snapshot');
  return { graph, files, exportedAt, sourceUrl };
}

function fileNameFromDisposition(value, fallback) {
  const m = /filename="?([^";]+)"?/i.exec(value || '');
  if (!m) return fallback;
  try { return decodeURIComponent(m[1]); } catch { return m[1]; }
}

export async function exportLiveState({ baseUrl, outputDir, fetchImpl = fetch }) {
  const root = baseUrl.replace(/\/$/, '');
  const graphResponse = await fetchImpl(`${root}/api/graph`, { headers: { accept: 'application/json' } });
  if (!graphResponse.ok) throw new Error(`Graph export failed: ${graphResponse.status}`);
  const graph = await graphResponse.json();
  const fileIds = referencedFileIds(graph);
  const filesDir = path.join(outputDir, 'files');
  await mkdir(filesDir, { recursive: true });
  const files = [];
  for (const id of fileIds) {
    try {
      const response = await fetchImpl(`${root}/api/files/${encodeURIComponent(id)}`);
      if (!response.ok) {
        files.push({ id, ok: false, status: response.status });
        continue;
      }
      const bytes = Buffer.from(await response.arrayBuffer());
      const name = fileNameFromDisposition(response.headers.get('content-disposition'), id);
      const mime = response.headers.get('content-type') || 'application/octet-stream';
      const diskName = `${id}.bin`;
      await writeFile(path.join(filesDir, diskName), bytes);
      files.push({ id, ok: true, name, mime, size: bytes.length, path: `files/${diskName}` });
    } catch (error) {
      files.push({ id, ok: false, error: error.message });
    }
  }
  const snapshot = normalizeSnapshot({ graph, files, sourceUrl: root });
  await writeFile(path.join(outputDir, 'snapshot.json'), JSON.stringify(snapshot, null, 2));
  const manifest = {
    exportedAt: snapshot.exportedAt,
    sourceUrl: root,
    nodeCount: graph.nodes.length,
    edgeCount: graph.edges.length,
    referencedFileCount: fileIds.length,
    downloadedFileCount: files.filter(f => f.ok).length,
    failedFileIds: files.filter(f => !f.ok).map(f => f.id)
  };
  await writeFile(path.join(outputDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  return { snapshot, manifest };
}

async function main() {
  const [baseUrl, outputDirArg] = process.argv.slice(2);
  if (!baseUrl) throw new Error('Usage: node scripts/export-live.mjs <baseUrl> [outputDir]');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outputDir = outputDirArg || path.resolve('migration-snapshots', stamp);
  const { manifest } = await exportLiveState({ baseUrl, outputDir });
  console.log(JSON.stringify({ outputDir, ...manifest }, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
