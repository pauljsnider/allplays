import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function readWorkflow(name) {
    return readFileSync(new URL(`../../.github/workflows/${name}`, import.meta.url), 'utf8');
}

describe('mobile association deployment boundary', () => {
    it('opts in only the trusted production staging workflow', () => {
        const production = readWorkflow('deploy-prod.yml');
        expect(production).toContain("ALLPLAYS_PUBLISH_MOBILE_ASSOCIATIONS: 'true'");

        for (const workflow of [
            'deploy-preview.yml',
            'preview-smoke.yml',
            'deploy-candidate-host.yml',
            'app-github-pages.yml'
        ]) {
            expect(readWorkflow(workflow)).not.toContain('ALLPLAYS_PUBLISH_MOBILE_ASSOCIATIONS');
        }
    });

    it('preserves verified associations in the documented manual production deploy', () => {
        const readme = readFileSync(new URL('../../README.md', import.meta.url), 'utf8');
        expect(readme).toContain(
            'ALLPLAYS_PUBLISH_MOBILE_ASSOCIATIONS=true node scripts/stage-pages-bundle.mjs /tmp/allplays-site'
        );
    });
});
