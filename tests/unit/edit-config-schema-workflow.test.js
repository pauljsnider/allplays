import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';

import { validateStatDefinitionsForPublicLeaderboards } from '../../js/stat-leaderboards.js';

function readEditConfigSource() {
    return readFileSync(new URL('../../edit-config.html', import.meta.url), 'utf8');
}

function readDbSource() {
    return readFileSync(new URL('../../js/db.js', import.meta.url), 'utf8');
}

function extractFunction(source, functionName) {
    const signature = `function ${functionName}`;
    const start = source.indexOf(signature);
    if (start === -1) {
        throw new Error(`Could not find ${functionName} in edit-config.html`);
    }

    const bodyStart = source.indexOf('{', start);
    let depth = 0;
    for (let index = bodyStart; index < source.length; index += 1) {
        const char = source[index];
        if (char === '{') depth += 1;
        if (char === '}') depth -= 1;
        if (depth === 0) {
            return source.slice(start, index + 1);
        }
    }

    throw new Error(`Could not extract ${functionName} body`);
}

function extractSubmitHandlerBody(source) {
    const marker = "document.getElementById('add-config-form').addEventListener('submit', async (e) => {";
    const start = source.indexOf(marker);
    if (start === -1) {
        throw new Error('Could not find submit handler in edit-config.html');
    }

    const bodyStart = start + marker.length;
    let depth = 1;
    for (let index = bodyStart; index < source.length; index += 1) {
        const char = source[index];
        if (char === '{') depth += 1;
        if (char === '}') depth -= 1;
        if (depth === 0) {
            return source.slice(bodyStart, index);
        }
    }

    throw new Error('Could not extract submit handler body');
}

describe('edit config schema workflow', () => {
    it('adds preset, import, edit, and reset controls to the stats config page', () => {
        const source = readEditConfigSource();

        expect(source).toContain('Preset Library');
        expect(source).toContain('id="preset-select"');
        expect(source).toContain('Apply Preset');
        expect(source).toContain('Import Existing Schema');
        expect(source).toContain('id="import-config-select"');
        expect(source).toContain('Load Into Form');
        expect(source).toContain('id="team-name-display"');
        expect(source).toContain("document.getElementById('team-name-display').textContent = team.name;");
        expect(source).toContain('Reset Stats Setup');
        expect(source).toContain('edit-btn');
    });

    it('wires the edit-config page to load owned-team schemas and support updates', () => {
        const source = readEditConfigSource();

        expect(source).toContain("getUserTeams, getConfigs, createConfig, updateConfig, deleteConfig, resetTeamStatConfigs");
        expect(source).toContain("from './js/stat-config-presets.js?v=2'");
        expect(source).toContain('loadImportConfigs()');
        expect(source).toContain('await updateConfig(currentTeamId, editingConfigId');
        expect(source).toContain('await resetTeamStatConfigs(currentTeamId);');
        expect(source).toContain('await getUserTeams(currentUser.uid);');
    });

    it('syncs new player-scoped non-formula stat definitions into tracker columns', () => {
        const source = readEditConfigSource();
        const dom = new JSDOM(`<!doctype html><body>
            <input id="columns" value="PTS, REB">
            <textarea id="advancedStatDefinitions"></textarea>
            <input id="statDefinitionLabel" value="Deflections">
            <input id="statDefinitionId" value="DEF">
            <input id="statDefinitionFormula" value="">
            <input id="statDefinitionGroup" value="Defense">
            <select id="statDefinitionFormat"><option value="number" selected>number</option></select>
            <input id="statDefinitionPrecision" value="">
            <select id="statDefinitionRankingOrder"><option value="desc" selected>desc</option></select>
            <select id="statDefinitionVisibility"><option value="public" selected>public</option></select>
            <select id="statDefinitionScope"><option value="player" selected>player</option></select>
            <input id="statDefinitionTopStat" type="checkbox">
        </body>`);

        const script = [
            extractFunction(source, 'getStatDefinitionLineId'),
            extractFunction(source, 'syncColumnsInputWithStatId'),
            extractFunction(source, 'addOrUpdateStatDefinitionLine'),
            'globalThis.__testHooks = { addOrUpdateStatDefinitionLine };'
        ].join('\n');

        const context = vm.createContext({
            document: dom.window.document,
            alert: () => {
                throw new Error('Unexpected alert during test');
            },
            window: dom.window,
            globalThis: {}
        });
        vm.runInContext(script, context);

        context.globalThis.__testHooks.addOrUpdateStatDefinitionLine();

        expect(dom.window.document.getElementById('columns').value).toBe('PTS, REB, DEF');
        expect(dom.window.document.getElementById('advancedStatDefinitions').value).toBe('Deflections=DEF|group=Defense|visibility=public|scope=player');
    });

    it('does not sync team-scoped non-formula stat definitions into tracker columns', () => {
        const source = readEditConfigSource();
        const dom = new JSDOM(`<!doctype html><body>
            <input id="columns" value="PTS, REB">
            <textarea id="advancedStatDefinitions"></textarea>
            <input id="statDefinitionLabel" value="Deflections">
            <input id="statDefinitionId" value="DEF">
            <input id="statDefinitionFormula" value="">
            <input id="statDefinitionGroup" value="Defense">
            <select id="statDefinitionFormat"><option value="number" selected>number</option></select>
            <input id="statDefinitionPrecision" value="">
            <select id="statDefinitionRankingOrder"><option value="desc" selected>desc</option></select>
            <select id="statDefinitionVisibility"><option value="public" selected>public</option></select>
            <select id="statDefinitionScope"><option value="team" selected>team</option></select>
            <input id="statDefinitionTopStat" type="checkbox">
        </body>`);

        const script = [
            extractFunction(source, 'getStatDefinitionLineId'),
            extractFunction(source, 'syncColumnsInputWithStatId'),
            extractFunction(source, 'addOrUpdateStatDefinitionLine'),
            'globalThis.__testHooks = { addOrUpdateStatDefinitionLine };'
        ].join('\n');

        const context = vm.createContext({
            document: dom.window.document,
            alert: () => {
                throw new Error('Unexpected alert during test');
            },
            window: dom.window,
            globalThis: {}
        });
        vm.runInContext(script, context);

        context.globalThis.__testHooks.addOrUpdateStatDefinitionLine();

        expect(dom.window.document.getElementById('columns').value).toBe('PTS, REB');
        expect(dom.window.document.getElementById('advancedStatDefinitions').value).toBe('Deflections=DEF|group=Defense|visibility=public|scope=team');
    });

    it('blocks invalid top stat definitions during add or update and leaves the textarea unchanged', () => {
        const source = readEditConfigSource();
        const dom = new JSDOM(`<!doctype html><body>
            <textarea id="advancedStatDefinitions">PTS=pts|visibility=public|scope=player|topStat=true</textarea>
            <input id="statDefinitionLabel" value="Hustle">
            <input id="statDefinitionId" value="hustle">
            <input id="statDefinitionFormula" value="">
            <input id="statDefinitionGroup" value="Defense">
            <select id="statDefinitionFormat"><option value="number" selected>number</option></select>
            <input id="statDefinitionPrecision" value="">
            <select id="statDefinitionRankingOrder"><option value="desc" selected>desc</option></select>
            <select id="statDefinitionVisibility"><option value="private" selected>private</option></select>
            <select id="statDefinitionScope"><option value="team" selected>team</option></select>
            <input id="statDefinitionTopStat" type="checkbox" checked>
        </body>`);

        const alerts = [];
        const script = [
            extractFunction(source, 'getStatDefinitionLineId'),
            extractFunction(source, 'syncColumnsInputWithStatId'),
            extractFunction(source, 'addOrUpdateStatDefinitionLine'),
            'globalThis.__testHooks = { addOrUpdateStatDefinitionLine };'
        ].join('\n');

        const context = vm.createContext({
            document: dom.window.document,
            alert: (message) => alerts.push(message),
            window: dom.window,
            globalThis: {}
        });
        vm.runInContext(script, context);

        context.globalThis.__testHooks.addOrUpdateStatDefinitionLine();

        expect(alerts).toEqual([
            'Hustle cannot be a Top Stat unless visibility is public and scope is player.'
        ]);
        expect(dom.window.document.getElementById('advancedStatDefinitions').value).toBe('PTS=pts|visibility=public|scope=player|topStat=true');
    });

    it('blocks saving invalid top stat definitions before createConfig or updateConfig runs', async () => {
        const source = readEditConfigSource();
        const alerts = [];
        const calls = [];
        const submitHandler = `async function __testSubmitHandler(e) {${extractSubmitHandlerBody(source)}}\nglobalThis.__testHooks = { __testSubmitHandler };`;

        const context = vm.createContext({
            editingConfigId: null,
            currentTeamId: 'team-a',
            getConfigWritePayload: () => ({
                name: 'Invalid Config',
                columns: ['PTS'],
                statDefinitions: [
                    { id: 'hustle', label: 'Hustle', visibility: 'private', scope: 'team', topStat: true }
                ]
            }),
            validateStatDefinitionsForPublicLeaderboards,
            createConfig: async () => calls.push('create'),
            updateConfig: async () => calls.push('update'),
            resetFormState: () => calls.push('reset'),
            loadConfigs: async () => calls.push('loadConfigs'),
            loadImportConfigs: async () => calls.push('loadImportConfigs'),
            alert: (message) => alerts.push(message),
            console,
            globalThis: {}
        });
        vm.runInContext(submitHandler, context);

        const event = {
            preventDefaultCalled: false,
            preventDefault() {
                this.preventDefaultCalled = true;
            }
        };

        await context.globalThis.__testHooks.__testSubmitHandler(event);

        expect(event.preventDefaultCalled).toBe(true);
        expect(alerts).toEqual([
            'Hustle cannot be a Top Stat unless visibility is public and scope is player.'
        ]);
        expect(calls).toEqual([]);
    });

    it('adds db helpers for updating and resetting stat tracker configs', () => {
        const source = readDbSource();

        expect(source).toContain('export async function updateConfig(teamId, configId, configData) {');
        expect(source).toContain('await updateDoc(doc(db, `teams/${teamId}/statTrackerConfigs`, configId), normalizedConfig);');
        expect(source).toContain('export async function resetTeamStatConfigs(teamId) {');
        expect(source).toContain('const batch = writeBatch(db);');
        expect(source).toContain('batch.delete(doc(db, `teams/${teamId}/statTrackerConfigs`, config.id));');
        expect(source).toContain("throw new Error('One or more stat configs are still assigned to existing games, including completed history. Remove those assignments before resetting the stats setup.')");
    });
});
