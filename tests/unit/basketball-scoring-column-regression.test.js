import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function extractFunction(source, functionName, fileLabel) {
    const signature = `function ${functionName}`;
    const start = source.indexOf(signature);
    if (start === -1) {
        throw new Error(`Could not find ${functionName} in ${fileLabel}`);
    }

    let paramsDepth = 0;
    let bodyStart = -1;
    for (let index = start; index < source.length; index += 1) {
        const char = source[index];
        if (char === '(') paramsDepth += 1;
        if (char === ')') paramsDepth = Math.max(0, paramsDepth - 1);
        if (char === '{' && paramsDepth === 0) {
            bodyStart = index;
            break;
        }
    }
    if (bodyStart === -1) {
        throw new Error(`Could not find ${functionName} body start in ${fileLabel}`);
    }

    let depth = 0;
    for (let index = bodyStart; index < source.length; index += 1) {
        const char = source[index];
        if (char === '{') depth += 1;
        if (char === '}') depth -= 1;
        if (depth === 0) {
            return source.slice(start, index + 1);
        }
    }

    throw new Error(`Could not extract ${functionName} from ${fileLabel}`);
}

function runFunction(scriptParts, hookNames, contextValues = {}) {
    const context = vm.createContext({
        ...contextValues,
        globalThis: {}
    });
    const hookAssignments = hookNames.map((name) => `${name}: typeof ${name} === 'function' ? ${name} : undefined`).join(', ');
    vm.runInContext(scriptParts.join('\n'), context);
    vm.runInContext(`globalThis.__testHooks = { ${hookAssignments} };`, context);
    return context.globalThis.__testHooks;
}

describe('basketball scoring column regression', () => {
    it('preserves a renamed basketball scoring column during config saves', () => {
        const source = readFileSync(new URL('../../edit-config.html', import.meta.url), 'utf8');
        const hooks = runFunction([
            extractFunction(source, 'slugifyStatKey', 'edit-config.html'),
            extractFunction(source, 'findCanonicalBasketballScoringColumn', 'edit-config.html'),
            extractFunction(source, 'deriveBasketballScoringColumn', 'edit-config.html')
        ], ['deriveBasketballScoringColumn']);

        expect(hooks.deriveBasketballScoringColumn({
            baseType: 'Basketball',
            columns: ['SCORE', 'REB', 'AST'],
            statDefinitions: [
                { id: 'pts', label: 'PTS', topStat: true },
                { id: 'reb', label: 'REB' },
                { id: 'ast', label: 'AST' }
            ],
            existingConfig: {
                columns: ['PTS', 'REB', 'AST']
            }
        })).toBe('SCORE');
    });

    it('includes the derived basketball scoring column in config writes', () => {
        const source = readFileSync(new URL('../../edit-config.html', import.meta.url), 'utf8');
        const hooks = runFunction([
            extractFunction(source, 'getConfigWritePayload', 'edit-config.html')
        ], ['getConfigWritePayload'], {
            getFormPayload: () => ({
                name: 'Basketball Standard',
                baseType: 'Basketball',
                columns: ['SCORE', 'REB', 'AST'],
                statDefinitions: [
                    { id: 'pts', label: 'PTS', topStat: true },
                    { id: 'reb', label: 'REB' },
                    { id: 'ast', label: 'AST' }
                ],
                scoringColumn: 'SCORE'
            })
        });

        expect(hooks.getConfigWritePayload()).toEqual({
            name: 'Basketball Standard',
            baseType: 'Basketball',
            columns: ['SCORE', 'REB', 'AST'],
            statDefinitions: [
                { id: 'pts', label: 'PTS', topStat: true },
                { id: 'reb', label: 'REB' },
                { id: 'ast', label: 'AST' }
            ],
            scoringColumn: 'SCORE'
        });
    });

    it.each([
        ['track-basketball.js', '../../js/track-basketball.js'],
        ['live-tracker.js', '../../js/live-tracker.js']
    ])('treats the configured basketball scoring column as points in %s', (_, relativePath) => {
        const source = readFileSync(new URL(relativePath, import.meta.url), 'utf8');
        const hooks = runFunction([
            extractFunction(source, 'getConfiguredPointsColumn', relativePath),
            extractFunction(source, 'isPointsColumn', relativePath)
        ], ['getConfiguredPointsColumn', 'isPointsColumn'], {
            currentConfig: {
                baseType: 'Basketball',
                columns: ['SCORE', 'REB', 'AST'],
                scoringColumn: 'SCORE'
            }
        });

        expect(hooks.getConfiguredPointsColumn()).toBe('SCORE');
        expect(hooks.isPointsColumn('SCORE')).toBe(true);
        expect(hooks.isPointsColumn('score')).toBe(true);
        expect(hooks.isPointsColumn('PTS')).toBe(false);
    });
});
