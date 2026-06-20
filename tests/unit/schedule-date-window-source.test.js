import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const appSource = readFileSync(new URL('../../apps/app/src/lib/scheduleService.ts', import.meta.url), 'utf8');

function extractFunctionSource(name) {
    const signatures = [`async function ${name}`, `function ${name}`];
    const signature = signatures.find((candidate) => appSource.includes(candidate));
    expect(signature, `Missing function source for ${name}`).toBeTruthy();

    const start = appSource.indexOf(signature);
    let parenDepth = 0;
    let bodyStart = -1;
    for (let index = start; index < appSource.length; index += 1) {
        const char = appSource[index];
        if (char === '(') parenDepth += 1;
        if (char === ')') parenDepth -= 1;
        if (char === '{' && parenDepth === 0) {
            bodyStart = index;
            break;
        }
    }
    expect(bodyStart).toBeGreaterThan(start);

    let depth = 0;
    for (let index = bodyStart; index < appSource.length; index += 1) {
        const char = appSource[index];
        if (char === '{') depth += 1;
        if (char === '}') {
            depth -= 1;
            if (depth === 0) {
                return appSource.slice(start, index + 1);
            }
        }
    }

    throw new Error(`Could not find end of ${name}`);
}

describe('native schedule date window source contracts', () => {
    it('merges recurring practice masters into native windowed game reads', () => {
        const nativeRecurringSource = extractFunctionSource('nativeListRecurringPracticeMasters');
        expect(nativeRecurringSource).toContain("fieldPath: 'isSeriesMaster'");
        expect(nativeRecurringSource).toContain("game?.type === 'practice'");
        expect(nativeRecurringSource).toContain('scheduleEventOverlapsDateWindow(game, window)');

        const loadGamesSource = extractFunctionSource('loadGames');
        expect(loadGamesSource).toContain('const recurringMasters = await nativeListRecurringPracticeMasters');
        expect(loadGamesSource).toContain('mergeScheduleDocumentsById(docs, recurringMasters)');
    });
});
