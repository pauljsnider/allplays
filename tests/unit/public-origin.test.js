import { describe, expect, it } from 'vitest';
import { resolvePublicOrigin } from '../../js/public-origin.js';

describe('public origin safety', () => {
    it.each(['', 'not a URL', '//evil.example', 'javascript:alert(1)', 'data:text/html,hello',
        'https://user:password@preview.example/path', 'http://[::ffff:127.0.0.1]',
        'http://[fc00::1]', 'http://[fe80::1]', 'http://169.254.1.1'])
    ('uses the canonical site for unavailable, unsafe, or local origins: %s', (origin) => {
        expect(resolvePublicOrigin(origin)).toBe('https://allplays.ai');
    });

    it('drops path, query, and fragment from a legitimate deployment URL', () => {
        expect(resolvePublicOrigin('https://preview.example:8443/path?next=ignored#ignored'))
            .toBe('https://preview.example:8443');
    });
});
