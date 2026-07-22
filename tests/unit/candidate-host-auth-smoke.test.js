import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(import.meta.dirname, '../..');
const readRepoFile = (file) => readFileSync(path.join(repoRoot, file), 'utf8');

describe('candidate-host authenticated smoke coverage', () => {
    it('targets the candidate origin with protected CI credentials', () => {
        const workflow = readRepoFile('.github/workflows/post-deploy-smoke.yml');
        const spec = readRepoFile('tests/smoke/candidate-host-auth.spec.js');

        expect(workflow).toContain('npx playwright test tests/smoke/candidate-host-auth.spec.js');
        expect(workflow).toContain('CANDIDATE_HOST_URL: https://game-flow-c6311.web.app');
        expect(workflow).toContain('SMOKE_AUTH_EMAIL: ${{ secrets.SMOKE_AUTH_EMAIL }}');
        expect(workflow).toContain('SMOKE_AUTH_PASSWORD: ${{ secrets.SMOKE_AUTH_PASSWORD }}');
        expect(spec).toContain("process.env.CANDIDATE_HOST_URL");
        expect(spec).toContain('Candidate authentication failed at ${candidateHostUrl}');
        expect(spec).toContain('Candidate post-login assertion failed at ${candidateHostUrl}');
    });

    it('does not enable App Check enforcement for candidate authentication', () => {
        const workflow = readRepoFile('.github/workflows/post-deploy-smoke.yml');

        expect(workflow).not.toContain('ALLPLAYS_APP_CHECK_ENFORCEMENT_READY');
        expect(workflow).not.toContain('APP_CHECK_ENFORCEMENT_READY');
    });
});
