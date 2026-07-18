import fs from 'node:fs';
import path from 'node:path';
import { Buffer } from 'node:buffer';
import console from 'node:console';
import { fileURLToPath } from 'node:url';

const ROOT_GLOB_SENTINEL = /["']\.\.\/(?!js\/)[^"']+["']\s*:/;
const PRIVATE_KEY_SENTINEL = /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/;
const SERVICE_ACCOUNT_SENTINEL = /["'](?:private_key|private_key_id|client_email)["']\s*:/;
const TEXT_OUTPUT_EXTENSIONS = new Set(['.css', '.html', '.js', '.json', '.map', '.md', '.rules', '.txt', '.xml']);

function normalizePath(filePath) {
  return path.resolve(filePath).split(path.sep).join('/');
}

function isWithin(parentDirectory, filePath) {
  const relative = path.relative(parentDirectory, filePath);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function normalizeModulePath(moduleId) {
  if (typeof moduleId !== 'string' || !moduleId || moduleId.startsWith('\0')) return '';
  const withoutQuery = moduleId.split('?', 1)[0];
  if (withoutQuery.startsWith('file:')) {
    try {
      return fileURLToPath(withoutQuery);
    } catch {
      return '';
    }
  }
  return path.isAbsolute(withoutQuery) ? withoutQuery : '';
}

function listFiles(directory, rootDirectory = directory, files = []) {
  if (!fs.existsSync(directory)) return files;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      listFiles(entryPath, rootDirectory, files);
    } else if (entry.isFile()) {
      files.push(path.relative(rootDirectory, entryPath).split(path.sep).join('/'));
    } else {
      throw new Error(`App production output contains an unsupported filesystem entry: ${entryPath}`);
    }
  }
  return files;
}

function findContentViolation(source) {
  const text = typeof source === 'string' ? source : Buffer.from(source || '').toString('utf8');
  if (ROOT_GLOB_SENTINEL.test(text)) return 'repository-root glob map';
  if (PRIVATE_KEY_SENTINEL.test(text)) return 'private key material';
  if (SERVICE_ACCOUNT_SENTINEL.test(text)) return 'service-account credential fields';
  return '';
}

export function assertSafeProductionModuleGraph(
  moduleIds,
  {
    appDirectory,
    repoRoot,
    legacyDirectory = path.join(repoRoot, 'js')
  }
) {
  const unexpectedModules = [];
  for (const moduleId of moduleIds) {
    const modulePath = normalizeModulePath(moduleId);
    if (!modulePath || !isWithin(repoRoot, modulePath)) continue;
    if (
      isWithin(appDirectory, modulePath)
      || isWithin(legacyDirectory, modulePath)
      || normalizePath(modulePath).includes('/node_modules/')
    ) {
      continue;
    }
    unexpectedModules.push(path.relative(repoRoot, modulePath).split(path.sep).join('/'));
  }

  if (unexpectedModules.length > 0) {
    throw new Error(
      `App production build imported files outside apps/app and the intentional js bridge: ${[...new Set(unexpectedModules)].sort().join(', ')}`
    );
  }
}

export function assertSafeProductionBundle(bundle) {
  const violations = [];
  for (const [fileName, output] of Object.entries(bundle)) {
    const isIndex = output.type === 'asset' && fileName === 'index.html';
    const isCss = output.type === 'asset' && /^assets\/[^/]+\.css$/.test(fileName);
    const isJavaScript = output.type === 'chunk' && /^assets\/[^/]+\.js$/.test(fileName);
    if (!isIndex && !isCss && !isJavaScript) {
      violations.push(`${fileName} (${output.type})`);
      continue;
    }

    const violation = findContentViolation(output.type === 'chunk' ? output.code : output.source);
    if (violation) violations.push(`${fileName} (${violation})`);
  }

  if (violations.length > 0) {
    throw new Error(`App production bundle contains unexpected repository-derived output: ${violations.join(', ')}`);
  }
}

export function assertSafeProductionDist(
  distDirectory,
  {
    publicDirectory
  }
) {
  const publicFiles = new Set(publicDirectory ? listFiles(publicDirectory) : []);
  const distFiles = listFiles(distDirectory);
  const violations = [];
  let javascriptCount = 0;
  let cssCount = 0;

  for (const relativePath of distFiles) {
    const extension = path.extname(relativePath).toLowerCase();
    const isIndex = relativePath === 'index.html';
    const isJavaScript = /^assets\/[^/]+\.js$/.test(relativePath);
    const isCss = /^assets\/[^/]+\.css$/.test(relativePath);
    const isPublicFile = publicFiles.has(relativePath);
    if (!isIndex && !isJavaScript && !isCss && !isPublicFile) {
      violations.push(`${relativePath} (unexpected file)`);
      continue;
    }

    if (isJavaScript) javascriptCount += 1;
    if (isCss) cssCount += 1;
    if (TEXT_OUTPUT_EXTENSIONS.has(extension)) {
      const source = fs.readFileSync(path.join(distDirectory, relativePath));
      const violation = findContentViolation(source);
      if (violation) violations.push(`${relativePath} (${violation})`);
    }
  }

  if (!distFiles.includes('index.html')) violations.push('index.html (missing)');
  if (javascriptCount === 0) violations.push('assets/*.js (missing)');
  if (cssCount === 0) violations.push('assets/*.css (missing)');

  if (violations.length > 0) {
    throw new Error(`App production artifact verification failed: ${violations.join(', ')}`);
  }

  return {
    fileCount: distFiles.length,
    javascriptCount,
    cssCount,
    publicFileCount: publicFiles.size
  };
}

export function createProductionArtifactGuard({ appDirectory, repoRoot }) {
  let distDirectory = path.join(appDirectory, 'dist');
  let publicDirectory = path.join(appDirectory, 'public');

  return {
    name: 'allplays-production-artifact-guard',
    apply: 'build',
    configResolved(config) {
      distDirectory = path.resolve(config.root, config.build.outDir);
      publicDirectory = config.publicDir === false
        ? ''
        : path.resolve(config.root, config.publicDir);
    },
    generateBundle(_outputOptions, bundle) {
      assertSafeProductionModuleGraph(this.getModuleIds(), { appDirectory, repoRoot });
      assertSafeProductionBundle(bundle);
    },
    writeBundle() {
      const result = assertSafeProductionDist(distDirectory, { publicDirectory });
      console.log(
        `App production artifacts verified (${result.fileCount} files; ${result.javascriptCount} JS, ${result.cssCount} CSS, ${result.publicFileCount} public).`
      );
    }
  };
}
