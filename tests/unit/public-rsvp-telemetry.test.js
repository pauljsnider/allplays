/** @vitest-environment jsdom */
/** @vitest-environment-options {"url":"https://allplays.ai/public-rsvp.html?token=private-token&response=not_going"} */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

import {
    capturePublicRsvpFailure,
    normalizePublicRsvpFailure
} from '../../js/public-rsvp-telemetry.js';

const mockFetch = vi.fn();
const reporterSource = readFileSync('js/public-rsvp-telemetry.js', 'utf8');

describe('public RSVP failure telemetry', () => {
    beforeEach(() => {
        mockFetch.mockReset();
        mockFetch.mockResolvedValue({ ok: true });
        window.fetch = mockFetch;
        window.__ALLPLAYS_CONFIG__ = {
            telemetryEndpoint: 'https://telemetry.example.test/collect'
        };
    });

    it('normalizes to the fixed failure property allowlist', () => {
        expect(normalizePublicRsvpFailure({
            stage: 'other',
            failureKind: 'private-token',
            httpStatus: 200,
            online: false,
            childName: 'Private Child',
            response: 'not_going'
        })).toEqual({
            label: 'Public RSVP init',
            stage: 'init',
            failureKind: 'unexpected_error',
            httpStatus: 0,
            online: false
        });
    });

    it('has no automatic page collection, persistent identity, or auth path', () => {
        expect(reporterSource).not.toContain('addEventListener');
        expect(reporterSource).not.toContain('localStorage');
        expect(reporterSource).not.toContain('sessionStorage');
        expect(reporterSource).not.toContain('Authorization');
        expect(reporterSource).not.toContain('window.location');
        expect(reporterSource).not.toContain('document.');
        expect(reporterSource).not.toContain('navigator.');
        expect(reporterSource).not.toContain('userAgent');
        expect(reporterSource).not.toContain('referrer');
        expect(reporterSource).not.toContain('queryKeys');
    });

    it('sends one anonymous failure event without URL secrets, answers, storage IDs, or auth', async () => {
        await capturePublicRsvpFailure({
            stage: 'submit',
            failureKind: 'request_rejected',
            httpStatus: 403,
            online: true,
            token: 'private-token',
            childName: 'Private Child',
            response: 'not_going',
            error: 'private server response'
        });

        expect(mockFetch).toHaveBeenCalledTimes(1);
        const [url, options] = mockFetch.mock.calls[0];
        const payload = JSON.parse(options.body);
        const event = payload.events[0];

        expect(url).toBe('https://telemetry.example.test/collect');
        expect(options).toMatchObject({
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            keepalive: true
        });
        expect(options.headers.Authorization).toBeUndefined();
        expect(payload.authToken).toBeUndefined();
        expect(event).toMatchObject({
            name: 'public_rsvp_error',
            signedIn: false,
            pagePath: '/public-rsvp.html',
            appRoute: '/public-rsvp.html',
            properties: {
                label: 'Public RSVP submit',
                stage: 'submit',
                failureKind: 'request_rejected',
                httpStatus: 403,
                online: true
            }
        });
        expect(Object.keys(event).sort()).toEqual([
            'appRoute',
            'clientTimestamp',
            'id',
            'name',
            'pagePath',
            'properties',
            'sessionId',
            'signedIn',
            'version',
            'visitorId'
        ]);
        expect(event.sessionId).toBe(event.visitorId);
        expect(JSON.stringify(payload)).not.toContain('private-token');
        expect(JSON.stringify(payload)).not.toContain('Private Child');
        expect(JSON.stringify(payload)).not.toContain('not_going');
        expect(JSON.stringify(payload)).not.toContain('private server response');
        expect(JSON.stringify(payload)).not.toContain('userAgent');
        expect(JSON.stringify(payload)).not.toContain('referrer');
        expect(JSON.stringify(payload)).not.toContain('queryKeys');
    });

    it('fails open when telemetry delivery is unavailable', async () => {
        mockFetch.mockRejectedValue(new Error('offline'));

        await expect(capturePublicRsvpFailure({
            stage: 'init',
            failureKind: 'network_error',
            httpStatus: 0,
            online: false
        })).resolves.toBe(false);
    });
});
