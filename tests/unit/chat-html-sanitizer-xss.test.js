// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { formatChatMessageHtml, __chatHtmlTestUtils } from '../../apps/app/src/lib/chatLogic.ts';

const { sanitizeFormattedChatHtmlFallback } = __chatHtmlTestUtils;

// Behavioral tests for the React chat HTML pipeline (the only dangerouslySetInnerHTML
// path). formatChatMessageHtml escapes input, applies markdown-ish formatting, then
// sanitizes. We assert XSS payloads never survive as live markup, through both the
// DOMPurify path (jsdom) and the regex fallback.

const XSS_PAYLOADS = [
    '<script>window.__x=1</script>',
    '<img src=x onerror=alert(1)>',
    '<svg/onload=alert(1)>',
    '<a href="javascript:alert(1)">click</a>',
    '<iframe src="javascript:alert(1)"></iframe>',
    '"><img src=x onerror=alert(1)>'
];

describe('formatChatMessageHtml XSS hardening', () => {
    for (const payload of XSS_PAYLOADS) {
        it(`neutralizes: ${payload.slice(0, 32)}`, () => {
            const html = formatChatMessageHtml(payload);
            // No LIVE tag survives (escaped text like "&lt;img ... onerror=&gt;"
            // is inert and intentionally still contains those substrings).
            expect(html).not.toMatch(/<script/i);
            expect(html).not.toMatch(/<iframe/i);
            expect(html).not.toMatch(/<img/i);
            expect(html).not.toMatch(/<svg/i);
            // Authoritative check: rendering into a real DOM creates no dangerous
            // nodes and fires no handler.
            const host = document.createElement('div');
            host.innerHTML = html;
            expect(host.querySelectorAll('script, iframe, svg, img')).toHaveLength(0);
            expect(host.querySelector('[onerror], [onload], [onclick]')).toBeNull();
        });
    }

    it('keeps legitimate text and auto-links http(s) URLs with safe rel', () => {
        const html = formatChatMessageHtml('see https://allplays.ai for info');
        expect(html).toContain('href="https://allplays.ai"');
        expect(html).toContain('rel="noopener noreferrer"');
        expect(html).toContain('target="_blank"');
    });

    it('does not linkify javascript: pseudo-URLs', () => {
        const html = formatChatMessageHtml('javascript:alert(1)');
        expect(html).not.toMatch(/href="javascript:/i);
    });
});

describe('sanitizeFormattedChatHtmlFallback (DOMPurify-unavailable path)', () => {
    it('drops disallowed tags entirely', () => {
        expect(sanitizeFormattedChatHtmlFallback('<script>x</script>')).not.toMatch(/<script/i);
        expect(sanitizeFormattedChatHtmlFallback('<iframe></iframe>')).not.toMatch(/<iframe/i);
        expect(sanitizeFormattedChatHtmlFallback('<img src=x onerror=alert(1)>')).not.toMatch(/<img/i);
    });

    it('keeps a safe https anchor but strips event handlers', () => {
        const out = sanitizeFormattedChatHtmlFallback('<a href="https://allplays.ai" target="_blank" rel="noopener noreferrer">x</a>');
        expect(out).toContain('href="https://allplays.ai"');
        expect(out).not.toMatch(/onclick=|onerror=/i);
    });

    it('rejects a javascript: anchor', () => {
        const out = sanitizeFormattedChatHtmlFallback('<a href="javascript:alert(1)">x</a>');
        expect(out).not.toMatch(/href="javascript:/i);
    });
});
