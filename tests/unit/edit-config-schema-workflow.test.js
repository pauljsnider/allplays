import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

function readEditConfigSource() {
    return readFileSync(new URL('../../edit-config.html', import.meta.url), 'utf8');
}

function readDbSource() {
    return readFileSync(new URL('../../js/db.js', import.meta.url), 'utf8');
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
        expect(source).toContain('Reset Stats Setup');
        expect(source).toContain('edit-btn');
    });

    it('wires the edit-config page to load owned-team schemas and support updates', () => {
        const source = readEditConfigSource();

        expect(source).toContain("getUserTeams, getConfigs, createConfig, updateConfig, deleteConfig, resetTeamStatConfigs");
        expect(source).toContain("from './js/stat-config-presets.js?v=1'");
        expect(source).toContain('loadImportConfigs()');
        expect(source).toContain('await updateConfig(currentTeamId, editingConfigId');
        expect(source).toContain('await resetTeamStatConfigs(currentTeamId);');
        expect(source).toContain('await getUserTeams(currentUser.uid);');
    });

    it('adds db helpers for updating and resetting stat tracker configs', () => {
        const source = readDbSource();

        expect(source).toContain('export async function updateConfig(teamId, configId, configData) {');
        expect(source).toContain('await updateDoc(doc(db, `teams/${teamId}/statTrackerConfigs`, configId), normalizedConfig);');
        expect(source).toContain('export async function resetTeamStatConfigs(teamId) {');
        expect(source).toContain('const batch = writeBatch(db);');
        expect(source).toContain('batch.delete(doc(db, `teams/${teamId}/statTrackerConfigs`, config.id));');
        expect(source).toContain("throw new Error('One or more stat configs are still assigned to scheduled or shared games. Remove those assignments before resetting the stats setup.')");
    });
});
