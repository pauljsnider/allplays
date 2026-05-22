import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';

function readRepoFile(relativePath) {
    return readFileSync(new URL(`../../${relativePath}`, import.meta.url), 'utf8');
}

function repoFileExists(relativePath) {
    return existsSync(new URL(`../../${relativePath}`, import.meta.url));
}

describe('workflow manifest', () => {
    it('ships and indexes the Team Media workflow help page', () => {
        const manifest = JSON.parse(readRepoFile('workflow-manifest.json'));
        const workflow = manifest.find((item) => item.id === 'team-media');

        expect(repoFileExists('workflow-team-media.html')).toBe(true);
        expect(workflow).toMatchObject({
            id: 'team-media',
            title: 'Manage Team Media and Albums',
            file: 'workflow-team-media.html'
        });
        expect(workflow.roles).toEqual(expect.arrayContaining(['Parent', 'Coach', 'Admin']));
        expect(workflow.searchText).toContain('Team Media');
        expect(workflow.searchText).toContain('photos');
        expect(workflow.searchText).toContain('video');
    });

    it('ships and indexes the Fees Payments workflow help page', () => {
        const manifest = JSON.parse(readRepoFile('workflow-manifest.json'));
        const workflow = manifest.find((item) => item.id === 'fees-payments');
        const helpHtml = readRepoFile('help.html');

        expect(repoFileExists('workflow-fees-payments.html')).toBe(true);
        expect(workflow).toMatchObject({
            id: 'fees-payments',
            title: 'Manage Team Fees and Payments',
            file: 'workflow-fees-payments.html'
        });
        expect(workflow.roles).toEqual(expect.arrayContaining(['Parent', 'Coach', 'Admin']));
        expect(workflow.searchText).toContain('fees');
        expect(workflow.searchText).toContain('Stripe');
        expect(helpHtml).toContain('workflow-fees-payments.html');
        expect(helpHtml).toContain('Manage Team Fees and Payments');
    });
});
