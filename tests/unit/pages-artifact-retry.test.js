import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const job = parse(readFileSync('.github/workflows/deploy-prod.yml', 'utf8')).jobs['deploy-pages'];
const upload = job.steps.find((step) => step.name === 'Upload exact-SHA Pages artifact');
const verify = job.steps.find((step) => step.name === 'Wait for exact Pages artifact visibility');
const deploy = job.steps.find((step) => step.name === 'Deploy exact-SHA Pages artifact');
const name = 'github-pages-45064244863-2';
const artifact = { name, id: 123, expired: false };

function runVisibility(responses, overrides = {}) {
    expect(verify, 'Pages upload must be visible before deployment').toBeDefined();
    const dir = mkdtempSync(path.join(tmpdir(), 'pages-artifact-retry-'));
    try {
        responses.forEach((response, index) => {
            writeFileSync(path.join(dir, `response-${index + 1}`),
                typeof response === 'string' ? response : JSON.stringify(response));
        });
        const executable = (file, source) => writeFileSync(path.join(dir, file), source, { mode: 0o755 });
        executable('gh', `#!/bin/bash
set -eu
printf '%s\\n' "$*" >> "$FIXTURE_DIR/requests"
n=0
if [ -f "$FIXTURE_DIR/count" ]; then n=$(cat "$FIXTURE_DIR/count"); fi
n=$((n+1))
printf '%s' "$n" > "$FIXTURE_DIR/count"
response="$FIXTURE_DIR/response-$n"
if [ ! -f "$response" ]; then response="$FIXTURE_DIR/response-$FIXTURE_COUNT"; fi
if [ "$(cat "$response")" = API_ERROR ]; then exit 1; fi
cat "$response"
`);
        executable('sleep', '#!/bin/bash\nprintf "%s\\n" "$*" >> "$FIXTURE_DIR/sleeps"\n');
        executable('timeout', '#!/bin/bash\nshift\nexec "$@"\n');
        const result = spawnSync('/bin/bash', ['-c', verify.run], {
            encoding: 'utf8', timeout: 10000,
            env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, FIXTURE_DIR: dir,
                FIXTURE_COUNT: String(responses.length), PAGES_ARTIFACT_NAME: name,
                PAGES_ARTIFACT_ID: '123', GITHUB_REPOSITORY: 'pauljsnider/allplays',
                GITHUB_RUN_ID: '45064244863', GH_TOKEN: 'test-only', ...overrides }
        });
        const optionalRead = (file) => {
            try { return readFileSync(path.join(dir, file), 'utf8'); } catch { return ''; }
        };
        return { ...result, requests: optionalRead('requests').trim().split('\n').filter(Boolean),
            sleeps: optionalRead('sleeps').trim().split('\n').filter(Boolean) };
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
}

describe('production Pages artifact retries', () => {
    it('selects an attempt-specific upload and verifies it before publishing', () => {
        expect(job.env.PAGES_ARTIFACT_NAME).toBe('github-pages-${{ github.run_id }}-${{ github.run_attempt }}');
        expect(upload.with.name).toBe('${{ env.PAGES_ARTIFACT_NAME }}');
        expect(deploy.with.artifact_name).toBe(upload.with.name);
        expect(verify.env.PAGES_ARTIFACT_ID).toBe(`\${{ steps.${upload.id}.outputs.artifact_id }}`);
        expect(job.steps.indexOf(verify)).toBeGreaterThan(job.steps.indexOf(upload));
        expect(job.steps.indexOf(deploy)).toBeGreaterThan(job.steps.indexOf(verify));
        expect(job.permissions.actions).toBe('read');
    });

    it('waits for upload visibility and reads all artifact pages', () => {
        const result = runVisibility([[{ artifacts: [] }], [
            { artifacts: [{ ...artifact, name: 'github-pages-45064244863-1', id: 122 }] },
            { artifacts: [artifact] }
        ]]);
        expect(result.status).toBe(0);
        expect(result.requests).toHaveLength(2);
        expect(result.requests.every((request) => request.includes('repos/pauljsnider/allplays/actions/runs/45064244863/artifacts')
            && request.includes('--paginate') && request.includes('--slurp'))).toBe(true);
        expect(result.sleeps).toEqual(['10']);
    });

    it('recovers from a transient metadata read error', () => {
        const result = runVisibility(['API_ERROR', [{ artifacts: [artifact] }]]);
        expect(result.status).toBe(0);
        expect(result.requests).toHaveLength(2);
    });

    it.each([
        ['missing', [{ artifacts: [] }]],
        ['prior attempt only', [{ artifacts: [{ ...artifact, name: 'github-pages-45064244863-1' }] }]],
        ['duplicate name', [{ artifacts: [artifact] }, { artifacts: [{ ...artifact, id: 124 }] }]],
        ['wrong upload ID', [{ artifacts: [{ ...artifact, id: 124 }] }]],
        ['expired', [{ artifacts: [{ ...artifact, expired: true }] }]],
        ['missing expiration evidence', [{ artifacts: [{ name, id: 123 }] }]],
        ['unreadable', 'API_ERROR'],
        ['malformed', 'not-json']
    ])('blocks publication after bounded %s metadata', (_reason, response) => {
        const result = runVisibility([response]);
        expect(result.status).not.toBe(0);
        expect(result.requests).toHaveLength(6);
        expect(result.sleeps).toHaveLength(5);
    });

    it('rejects a missing uploader identity before querying', () => {
        const result = runVisibility([[{ artifacts: [artifact] }]], { PAGES_ARTIFACT_ID: '' });
        expect(result.status).not.toBe(0);
        expect(result.requests).toHaveLength(0);
    });
});
