import { existsSync, lstatSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
    SPEC_ONLY_LANE,
    classifyGitRangeFailClosed
} from './classify-change-impact.mjs';

function localMarkdownTargets(markdown) {
    const targets = [];
    for (const match of markdown.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g)) {
        let target = match[1].trim();
        if (target.startsWith('<')) {
            const end = target.indexOf('>');
            target = end > 0 ? target.slice(1, end) : target;
        } else {
            target = target.split(/\s+/, 1)[0];
        }
        if (!target || target.startsWith('#') || target.startsWith('/') || target.startsWith('//')) continue;
        if (/^[a-z][a-z0-9+.-]*:/i.test(target)) continue;
        targets.push(target.split('#', 1)[0].split('?', 1)[0]);
    }
    return targets.filter(Boolean);
}

export function validateSpecDocument(relativePath, { rootDir = process.cwd() } = {}) {
    const root = path.resolve(rootDir);
    const absolutePath = path.resolve(root, relativePath);
    if (!absolutePath.startsWith(`${root}${path.sep}`)) {
        throw new Error(`${relativePath}: path escapes the repository.`);
    }
    if (!existsSync(absolutePath)) return { path: relativePath, deleted: true };

    const stat = lstatSync(absolutePath);
    if (!stat.isFile() || stat.isSymbolicLink()) {
        throw new Error(`${relativePath}: changed specification must be a regular file.`);
    }
    const markdown = readFileSync(absolutePath, 'utf8');
    if (!markdown.trim()) throw new Error(`${relativePath}: specification is empty.`);

    const conflictMarkers = ['<<<<<<<', '=======', '>>>>>>>'];
    if (conflictMarkers.every((marker) => new RegExp(`^${marker}`, 'm').test(markdown))) {
        throw new Error(`${relativePath}: unresolved merge-conflict markers found.`);
    }

    for (const encodedTarget of localMarkdownTargets(markdown)) {
        let target;
        try {
            target = decodeURIComponent(encodedTarget);
        } catch {
            throw new Error(`${relativePath}: invalid encoded Markdown link ${encodedTarget}.`);
        }
        const linkedPath = path.resolve(path.dirname(absolutePath), target);
        if (!linkedPath.startsWith(`${root}${path.sep}`) || !existsSync(linkedPath)) {
            throw new Error(`${relativePath}: missing local Markdown link target ${encodedTarget}.`);
        }
    }

    return { path: relativePath, deleted: false };
}

export function validateSpecOnlyRange(baseSha, headSha, { rootDir = process.cwd() } = {}) {
    const impact = classifyGitRangeFailClosed(baseSha, headSha, { cwd: rootDir });
    if (impact.lane !== SPEC_ONLY_LANE) {
        throw new Error(`Expected a spec-only change set; classified ${impact.lane} (${impact.reason}).`);
    }
    const documents = impact.paths.map((relativePath) => validateSpecDocument(relativePath, { rootDir }));
    return { impact, documents };
}

function parseArgs(values) {
    const args = {};
    for (let index = 0; index < values.length; index += 2) {
        const key = values[index];
        const value = values[index + 1];
        if (!key?.startsWith('--') || value === undefined) throw new Error(`Invalid argument ${key || ''}`.trim());
        args[key.slice(2)] = value;
    }
    return args;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const args = parseArgs(process.argv.slice(2));
    const result = validateSpecOnlyRange(args.base, args.head);
    process.stdout.write(`Validated ${result.documents.length} changed specification files.\n`);
}
