import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const appRoot = resolve(repoRoot, 'apps/app');

function run(command, args, options = {}) {
    const result = spawnSync(command, args, {
        cwd: options.cwd || repoRoot,
        encoding: 'utf8',
        stdio: options.capture ? 'pipe' : 'inherit'
    });

    if (result.error) throw result.error;
    if (result.status !== 0) process.exit(result.status || 1);
    return result.stdout || '';
}

export function filterChangedAppSourceFiles(paths) {
    return [...new Set(paths
        .filter((file) => /^apps\/app\/src\/.*\.(?:ts|tsx)$/.test(file))
        .map((file) => file.slice('apps/app/'.length)))]
        .sort();
}

function resolveBaseSha() {
    const configuredBase = String(process.env.BASE_SHA || '').trim();
    if (configuredBase && !/^0+$/.test(configuredBase)) return configuredBase;

    const result = spawnSync('git', ['rev-parse', 'HEAD^'], {
        cwd: repoRoot,
        encoding: 'utf8',
        stdio: 'pipe'
    });
    return result.status === 0 ? result.stdout.trim() : '';
}

function getChangedAppSourceFiles() {
    const baseSha = resolveBaseSha();
    if (!baseSha) return [];

    const output = run(
        'git',
        ['diff', '--name-only', '--diff-filter=ACMR', '-z', `${baseSha}...HEAD`, '--', 'apps/app/src'],
        { capture: true }
    );
    return filterChangedAppSourceFiles(output.split('\0').filter(Boolean));
}

function main() {
    // Keep the existing repository-wide error gate. Warnings remain visible to
    // developers during normal `npm run lint`, but --quiet keeps legacy warning
    // debt from making unrelated pull requests fail.
    run('npm', ['run', 'lint', '--', '--quiet'], { cwd: appRoot });

    const changedFiles = getChangedAppSourceFiles();
    if (!changedFiles.length) {
        console.log('No changed React app source files require strict hook linting.');
        return;
    }

    console.log(`Strict hook dependency lint: ${changedFiles.length} changed file(s).`);
    run('npm', [
        'exec',
        '--',
        'eslint',
        '--quiet',
        '--rule',
        'react-hooks/exhaustive-deps:error',
        ...changedFiles
    ], { cwd: appRoot });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
    main();
}
