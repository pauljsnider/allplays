import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

function readPublicRsvpPage() {
    return readFileSync(new URL('../../public-rsvp.html', import.meta.url), 'utf8');
}

describe('public RSVP page', () => {
    it('shows public confirmation states without requiring sign in', () => {
        const source = readPublicRsvpPage();

        expect(source).toContain('ALL PLAYS RSVP');
        expect(source).toContain('id="rsvp-form"');
        expect(source).toContain('value="going"');
        expect(source).toContain('value="maybe"');
        expect(source).toContain('value="not_going"');
        expect(source).toContain('No sign-in required');
    });

    it('calls public RSVP validation and submit endpoints with a safe error state', () => {
        const source = readPublicRsvpPage();

        expect(source).toContain("callPublicRsvp('getPublicRsvp', {");
        expect(source).toContain("method: 'POST'");
        expect(source).toContain('body: JSON.stringify({ token })');
        expect(source).toContain("callPublicRsvp('submitPublicRsvp'");
        expect(source).toContain('id="error-state"');
        expect(source).toContain('For privacy, this page only shows event details after a valid RSVP link is confirmed.');
        expect(source).toContain('The link is invalid, expired, or no longer available.');
    });

    it('captures bearer values from fragments or legacy queries and removes them before external requests', () => {
        const source = readPublicRsvpPage();

        expect(source).toContain('<meta name="referrer" content="no-referrer">');
        expect(source).toContain("new URLSearchParams(window.location.hash.replace(/^#/, ''))");
        expect(source).toContain("fragmentParams.get('token') || legacyParams.get('token')");
        expect(source).toContain('window.history.replaceState({}, document.title, window.location.pathname)');
        expect(source.indexOf('window.history.replaceState'))
            .toBeLessThan(source.indexOf('https://cdn.tailwindcss.com'));
    });
});
