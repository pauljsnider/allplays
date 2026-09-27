import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const TEAM_DETAIL_SMOKE_SPECS = [
    'app-home-player.spec.js',
    'app-search.spec.js',
    'app-teams.spec.js'
];

function readRepoFile(relativePath) {
    return readFileSync(new URL(`../../${relativePath}`, import.meta.url), 'utf8');
}

function getTeamDetailServiceImports() {
    const source = readRepoFile('apps/app/src/pages/TeamDetail.tsx');
    const match = source.match(/import\s*\{([^}]+)\}\s*from\s*['"]\.\.\/lib\/teamDetailService['"]/s);

    expect(match, 'TeamDetail.tsx must have a named teamDetailService import').not.toBeNull();

    return match[1]
        .split(',')
        .map((entry) => entry.trim())
        .filter((entry) => entry && !entry.startsWith('type '))
        .map((entry) => entry.split(/\s+as\s+/)[0]);
}

function getStubExports(source) {
    return new Set(
        [...source.matchAll(/export\s+(?:async\s+)?(?:function|class|const|let|var)\s+([A-Za-z_$][\w$]*)/g)]
            .map((entry) => entry[1])
    );
}

describe('TeamDetail browser module stubs', () => {
    it.each(TEAM_DETAIL_SMOKE_SPECS)('%s exports every teamDetailService value imported by TeamDetail', (specName) => {
        const stubExports = getStubExports(readRepoFile(`tests/smoke/${specName}`));
        const missingExports = getTeamDetailServiceImports().filter((name) => !stubExports.has(name));

        expect(missingExports, `${specName} has an incomplete teamDetailService browser stub`).toEqual([]);
    });
});
