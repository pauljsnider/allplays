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

        expect(source).toContain('getPublicRsvp?token=');
        expect(source).toContain("callPublicRsvp('submitPublicRsvp'");
        expect(source).toContain('id="error-state"');
        expect(source).toContain('For privacy, this page only shows event details after a valid RSVP link is confirmed.');
        expect(source).toContain('The link is invalid, expired, or no longer available.');
    });
});
