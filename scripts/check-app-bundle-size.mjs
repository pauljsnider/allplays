import { gzipSync } from 'node:zlib';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const repoRoot = process.cwd();
const distDir = path.resolve(repoRoot, process.env.APP_DIST_DIR || 'apps/app/dist');
const indexHtmlPath = path.join(distDir, 'index.html');
const budgets = {
  entryBytes: parsePositiveInteger(process.env.APP_ENTRY_CHUNK_LIMIT_BYTES) || 1_420_000,
  initialGzipBytes: parsePositiveInteger(process.env.APP_INITIAL_GZIP_LIMIT_BYTES) || 600 * 1024,
  initialFiles: parsePositiveInteger(process.env.APP_INITIAL_FILE_LIMIT) || 40,
  modulePreloads: parsePositiveInteger(process.env.APP_MODULE_PRELOAD_LIMIT) || 20
};

const indexHtml = await readFile(indexHtmlPath, 'utf8').catch((error) => {
  throw new Error(`Unable to read app build output at ${indexHtmlPath}: ${error.message}`);
});

const entryScriptMatch = indexHtml.match(/<script\b[^>]*type=["']module["'][^>]*src=["']([^"']*assets\/index-[^"']+\.js)["']/i);
if (!entryScriptMatch) {
  throw new Error(`Unable to find the app entry chunk in ${indexHtmlPath}. Run npm run app:build first.`);
}

const entryChunkRelativePath = normalizeAssetPath(entryScriptMatch[1]);
const entryChunkPath = path.resolve(distDir, entryChunkRelativePath);
const entryChunkStats = await stat(entryChunkPath).catch((error) => {
  throw new Error(`Unable to read app entry chunk at ${entryChunkPath}: ${error.message}`);
});
const initialAssets = new Set(
  [...indexHtml.matchAll(/(?:src|href)=["']([^"']+\.(?:js|css))["']/gi)]
    .map((match) => normalizeAssetPath(match[1]))
);
await collectStaticImports(entryChunkRelativePath, initialAssets);

let initialGzipBytes = 0;
for (const relativePath of initialAssets) {
  const contents = await readFile(path.join(distDir, relativePath));
  initialGzipBytes += gzipSync(contents).length;
}

const measurements = {
  entryBytes: entryChunkStats.size,
  initialGzipBytes,
  initialFiles: initialAssets.size,
  modulePreloads: (indexHtml.match(/\bmodulepreload\b/gi) || []).length
};
const failures = [];

checkBudget('entry chunk', measurements.entryBytes, budgets.entryBytes, 'bytes', failures);
checkBudget('initial static payload (gzip)', measurements.initialGzipBytes, budgets.initialGzipBytes, 'bytes', failures);
checkBudget('initial asset count', measurements.initialFiles, budgets.initialFiles, 'files', failures);
checkBudget('HTML modulepreload count', measurements.modulePreloads, budgets.modulePreloads, 'preloads', failures);

if (failures.length > 0) {
  throw new Error(`App cold-start budget failed:\n- ${failures.join('\n- ')}`);
}

console.log(
  `App cold-start budget passed: entry ${bytesToKb(measurements.entryBytes)} KB; `
  + `${measurements.initialFiles} initial assets / ${bytesToKb(measurements.initialGzipBytes)} KB gzip; `
  + `${measurements.modulePreloads} modulepreloads.`
);

async function collectStaticImports(relativePath, collected) {
  const source = await readFile(path.join(distDir, relativePath), 'utf8');
  const importPattern = /(?:from|import)\s*["'](\.\/[^"']+\.js)["']/g;
  for (const match of source.matchAll(importPattern)) {
    const dependency = path.posix.normalize(path.posix.join(path.posix.dirname(relativePath), match[1]));
    if (collected.has(dependency)) continue;
    collected.add(dependency);
    await collectStaticImports(dependency, collected);
  }
}

function normalizeAssetPath(assetPath) {
  return assetPath.replace(/[?#].*$/, '').replace(/^\.?\//, '');
}

function checkBudget(label, actual, limit, unit, failures) {
  if (actual > limit) {
    const display = unit === 'bytes'
      ? `${bytesToKb(actual)} KB > ${bytesToKb(limit)} KB`
      : `${actual} ${unit} > ${limit} ${unit}`;
    failures.push(`${label}: ${display}`);
  }
}

function parsePositiveInteger(value) {
  const parsed = Number.parseInt(String(value || ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function bytesToKb(bytes) {
  return (bytes / 1024).toFixed(1);
}
