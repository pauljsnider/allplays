import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');

function readFile(relPath) {
    return fs.readFileSync(path.join(repoRoot, relPath), 'utf8');
}

describe('live game public roster fallback', () => {
    it('keeps roster loading optional when Firestore denies public player reads', () => {
        const source = readFile('js/live-game.js');

        expect(source).toContain("console.warn('Failed to load optional roster for live game viewer:', error);");
        expect(source).toContain("if (!['permission-denied', 'firestore/permission-denied'].includes(code)) {");
        expect(source).toContain('playersError = error;');
        expect(source).toContain('return [];');
        expect(source).toContain('if (game && game.isPublicProjection !== true && (teamContextError || configsError || playersError)) {');
        expect(source).toContain('throw teamContextError || configsError || playersError;');
    });

    it('keeps projection-backed viewers off the forbidden canonical listener', () => {
        const source = readFile('js/live-game.js');

        expect(source).toContain('{ publicProjection: game.isPublicProjection === true }');
    });
});
