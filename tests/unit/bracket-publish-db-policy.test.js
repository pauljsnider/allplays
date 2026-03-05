import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');

function readFile(relPath) {
    return fs.readFileSync(path.join(repoRoot, relPath), 'utf8');
}

function getFunctionBody(source, functionName) {
    const signature = `export async function ${functionName}(`;
    const start = source.indexOf(signature);
    if (start === -1) return null;

    const braceStart = source.indexOf('{', start);
    if (braceStart === -1) return null;

    let depth = 1;
    for (let i = braceStart + 1; i < source.length; i += 1) {
        const ch = source[i];
        if (ch === '{') depth += 1;
        if (ch === '}') depth -= 1;
        if (depth === 0) return source.slice(braceStart + 1, i);
    }

    return null;
}

describe('db bracket publish policy', () => {
    it('keeps publishBracket publishedAt type consistent with Firestore Timestamp writes', () => {
        const source = readFile('js/db.js');
        const body = getFunctionBody(source, 'publishBracket');

        expect(body).toBeTruthy();
        expect(body).toContain('const publishedAt = Timestamp.now()');
        expect(body).toContain('publishedAt: publishedAt');
        expect(body).not.toContain('publishedAt.toDate().toISOString()');
    });
});
