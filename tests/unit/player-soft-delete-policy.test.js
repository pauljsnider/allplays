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

describe('player soft-delete policy', () => {
    it('implements deletePlayer as a soft-delete update (never hard delete)', () => {
        const source = readFile('js/db.js');
        const body = getFunctionBody(source, 'deletePlayer');

        expect(body).toBeTruthy();
        expect(body).toContain('updateDoc(');
        expect(body).toContain('active: false');
        expect(body).toContain('deactivatedAt: Timestamp.now()');
        expect(body).toContain('updatedAt: Timestamp.now()');
        expect(body).not.toContain('deleteDoc(');
    });

    it('loads historical game report roster with inactive players included', () => {
        const source = readFile('game.html');
        expect(source).toContain('getPlayers(teamId, { includeInactive: true })');
    });

    it('loads inactive players for historical identity resolution views', () => {
        const playerPage = readFile('player.html');
        const liveGame = readFile('js/live-game.js');
        const teamChat = readFile('team-chat.html');

        expect(playerPage).toContain('getPlayers(teamId, { includeInactive: true })');
        expect(liveGame).toContain('getPlayers(state.teamId, { includeInactive: true })');
        expect(teamChat).toContain('getPlayers(teamId, { includeInactive: true })');
    });
});
