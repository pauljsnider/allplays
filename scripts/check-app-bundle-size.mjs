import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const repoRoot = process.cwd();
const distDir = path.resolve(repoRoot, process.env.APP_DIST_DIR || 'apps/app/dist');
const indexHtmlPath = path.join(distDir, 'index.html');
const defaultEntryBudgetBytes = 1_420_000;
const entryBudgetBytes = parsePositiveInteger(process.env.APP_ENTRY_CHUNK_LIMIT_BYTES) || defaultEntryBudgetBytes;

const indexHtml = await readFile(indexHtmlPath, 'utf8').catch((error) => {
  throw new Error(`Unable to read app build output at ${indexHtmlPath}: ${error.message}`);
});

const entryScriptMatch = indexHtml.match(/<script\b[^>]*type=["']module["'][^>]*src=["']([^"']*assets\/index-[^"']+\.js)["']/i);
if (!entryScriptMatch) {
  throw new Error(`Unable to find the app entry chunk in ${indexHtmlPath}. Run npm run app:build first.`);
}

const entryChunkPath = path.resolve(distDir, entryScriptMatch[1].replace(/^\.\//, ''));
const entryChunkStats = await stat(entryChunkPath).catch((error) => {
  throw new Error(`Unable to read app entry chunk at ${entryChunkPath}: ${error.message}`);
});

const entrySizeBytes = entryChunkStats.size;
const entryBudgetKb = bytesToKb(entryBudgetBytes);
const entrySizeKb = bytesToKb(entrySizeBytes);

if (entrySizeBytes > entryBudgetBytes) {
  throw new Error(`App entry chunk is ${entrySizeKb} KB, over the ${entryBudgetKb} KB budget. Update the bundle or intentionally raise APP_ENTRY_CHUNK_LIMIT_BYTES.`);
}

console.log(`App entry chunk ${path.relative(repoRoot, entryChunkPath)} is ${entrySizeKb} KB, within the ${entryBudgetKb} KB budget.`);

function parsePositiveInteger(value) {
  const parsed = Number.parseInt(String(value || ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function bytesToKb(bytes) {
  return (bytes / 1024).toFixed(1);
}
