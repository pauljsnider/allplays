import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const SPEC_ONLY_LANE = 'spec-only';
export const FULL_LANE = 'full';

const shaPattern = /^[0-9a-f]{40}$/;

export function isSpecOnlyPath(value) {
    if (typeof value !== 'string' || !value.startsWith('spec/') || !value.endsWith('.md')) {
        return false;
    }
    if (value.includes('\0') || value.split('/').some((segment) => !segment || segment === '.' || segment === '..')) {
        return false;
    }
    return path.posix.basename(value) !== 'AGENTS.md';
}

export function classifyChangeImpact(paths) {
    if (!Array.isArray(paths) || paths.length === 0 || paths.some((value) => typeof value !== 'string')) {
        return { lane: FULL_LANE, specOnly: false, reason: 'empty-or-invalid-change-set' };
    }

    const uniquePaths = [...new Set(paths)];
    if (uniquePaths.every(isSpecOnlyPath)) {
        return { lane: SPEC_ONLY_LANE, specOnly: true, reason: 'all-paths-are-product-spec-markdown' };
    }
    return { lane: FULL_LANE, specOnly: false, reason: 'runtime-or-unrecognized-path-present' };
}

export function changedPathsBetween(baseSha, headSha, { cwd = process.cwd() } = {}) {
    if (!shaPattern.test(String(baseSha || '')) || !shaPattern.test(String(headSha || ''))) {
        throw new Error('Both base and head must be complete lowercase Git SHAs.');
    }
    const output = execFileSync(
        'git',
        ['diff', '--name-status', '-z', '--no-renames', `${baseSha}...${headSha}`],
        { cwd, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }
    );
    const fields = output.split('\0').filter(Boolean);
    if (fields.length % 2 !== 0) throw new Error('Git returned an incomplete changed-path record.');

    const paths = [];
    for (let index = 0; index < fields.length; index += 2) {
        if (!/^[ACDMRTUXB][0-9]*$/.test(fields[index])) {
            throw new Error(`Git returned an invalid change status: ${fields[index]}.`);
        }
        paths.push(fields[index + 1]);
    }
    return paths;
}

export function classifyGitRangeFailClosed(baseSha, headSha, options = {}) {
    try {
        const paths = changedPathsBetween(baseSha, headSha, options);
        return { ...classifyChangeImpact(paths), paths };
    } catch (error) {
        return {
            lane: FULL_LANE,
            specOnly: false,
            reason: 'change-detection-failed',
            paths: [],
            error: error instanceof Error ? error.message : String(error)
        };
    }
}

function parseArgs(values) {
    const args = {};
    for (let index = 0; index < values.length; index += 2) {
        const key = values[index];
        const value = values[index + 1];
        if (!key?.startsWith('--') || value === undefined) {
            throw new Error(`Invalid argument ${key || ''}`.trim());
        }
        args[key.slice(2)] = value;
    }
    return args;
}

function writeGitHubOutputs(outputPath, result) {
    if (!outputPath) return;
    appendFileSync(outputPath, [
        `lane=${result.lane}`,
        `spec_only=${result.specOnly ? 'true' : 'false'}`,
        `reason=${result.reason}`,
        `changed_count=${result.paths.length}`
    ].join('\n') + '\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    let result;
    try {
        const args = parseArgs(process.argv.slice(2));
        result = classifyGitRangeFailClosed(args.base, args.head);
        writeGitHubOutputs(args['github-output'], result);
    } catch (error) {
        result = {
            lane: FULL_LANE,
            specOnly: false,
            reason: 'classifier-invocation-failed',
            paths: [],
            error: error instanceof Error ? error.message : String(error)
        };
    }
    if (result.error) process.stderr.write(`Change impact fell back to full: ${result.error}\n`);
    process.stdout.write(`${JSON.stringify(result)}\n`);
}
