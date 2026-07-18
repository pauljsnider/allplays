import { describe, expect, it } from 'vitest';
import fs from 'node:fs';

describe('privacy-preserving observability contract', () => {
    const client = fs.readFileSync('js/telemetry.js', 'utf8');
    const collector = fs.readFileSync('functions/index.js', 'utf8');
    const indexes = JSON.parse(fs.readFileSync('firestore.indexes.json', 'utf8'));
    const workflow = fs.readFileSync('.github/workflows/critical-workflow-health.yml', 'utf8');

    it('does not send auth identity or persistent visitor storage', () => {
        expect(client).not.toContain("const VISITOR_KEY");
        expect(client).not.toContain('headers.Authorization');
        expect(client).not.toContain('payloadObject.authToken');
        expect(client).toContain('return getSessionId();');
        expect(collector).toContain('visitorId: null');
        expect(collector).toContain('userId: null');
    });

    it('cache-busts the privacy contract across every legacy entry point', () => {
        const rootHtml = fs.readdirSync('.', { withFileTypes: true })
            .filter((entry) => entry.isFile() && entry.name.endsWith('.html'))
            .map((entry) => entry.name);
        const nestedHtml = ['beta', 'mockups'].flatMap((directory) => (
            fs.readdirSync(directory, { recursive: true })
                .filter((name) => name.endsWith('.html'))
                .map((name) => `${directory}/${name}`)
        ));
        const trackedSources = fs.readFileSync('js/utils.js', 'utf8')
            + [...rootHtml, ...nestedHtml]
                .map((path) => fs.readFileSync(path, 'utf8'))
                .join('\n');

        expect(trackedSources).not.toContain('telemetry.js?v=3');
        expect(trackedSources).toContain('telemetry.js?v=4');
        expect(client).toContain("from './telemetry-utils.js?v=2'");
    });

    it('hashes identifiers, templates paths, samples, and deduplicates', () => {
        expect(collector).toContain("createHash('sha256')");
        expect(client).toContain('ERROR_DEDUPE_WINDOW_MS');
        expect(client).toContain('event.sampleWeight');
        expect(client).toContain('sanitizeTelemetryRoute');
        expect(collector).toContain("? ':id'");
    });

    it('declares TTL for every telemetry collection', () => {
        const ttlGroups = indexes.fieldOverrides
            .filter((entry) => entry.fieldPath === 'expiresAt' && entry.ttl === true)
            .map((entry) => entry.collectionGroup);
        expect(ttlGroups).toEqual(expect.arrayContaining([
            'telemetryEvents', 'telemetrySessions', 'telemetryDaily',
            'telemetryPagesDaily', 'telemetryRoutesDaily', 'telemetryEventsDaily'
        ]));
    });

    it('keeps the watchdog read-only except for tightly scoped incident reconciliation', () => {
        expect(workflow).toContain('permissions: {}');
        expect(workflow).toContain('actions: read');
        expect(workflow).toContain('issues: write');
        expect(workflow).not.toContain('id-token: write');
        expect(workflow).not.toContain('pull-requests: write');
    });
});
