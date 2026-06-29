import { describe, expect, it } from 'vitest';
import { escapeHtml } from '../../js/utils.js';

// Behavioral unit tests for the escaping primitive that every legacy XSS fix
// relies on. The xss-no-unescaped-interpolation-guard test proves the sinks
// call escapeHtml; these tests prove escapeHtml actually neutralizes payloads.

describe('escapeHtml', () => {
    it('escapes the five HTML-significant characters', () => {
        expect(escapeHtml('<')).toBe('&lt;');
        expect(escapeHtml('>')).toBe('&gt;');
        expect(escapeHtml('&')).toBe('&amp;');
        expect(escapeHtml('"')).toBe('&quot;');
        expect(escapeHtml("'")).toBe('&#039;');
    });

    it('returns empty string for null/undefined', () => {
        expect(escapeHtml(null)).toBe('');
        expect(escapeHtml(undefined)).toBe('');
    });

    it('coerces non-strings without throwing', () => {
        expect(escapeHtml(42)).toBe('42');
        expect(escapeHtml(0)).toBe('0');
        expect(escapeHtml(false)).toBe('false');
    });

    it('neutralizes element-context script injection', () => {
        const out = escapeHtml('<script>alert(1)</script>');
        expect(out).not.toContain('<script');
        expect(out).not.toContain('</script>');
        expect(out).toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
    });

    it('neutralizes attribute-context breakout payloads', () => {
        // A double-quote-terminated attribute cannot be escaped by these strings.
        const payloads = [
            '"><img src=x onerror=alert(1)>',
            '" onmouseover="alert(1)',
            "'><svg onload=alert(1)>",
            '"><script>alert(document.cookie)</script>'
        ];
        for (const payload of payloads) {
            const out = escapeHtml(payload);
            // The quotes that would close an attribute are now entities.
            expect(out).not.toContain('"');
            expect(out).not.toContain("'");
            // No live tag can survive.
            expect(out).not.toContain('<img');
            expect(out).not.toContain('<svg');
            expect(out).not.toContain('<script');
        }
    });

    it('does not double-decode or strip safe text', () => {
        expect(escapeHtml('Jordan Reed')).toBe('Jordan Reed');
        expect(escapeHtml('#23 — Guard')).toBe('#23 — Guard');
    });

    it('is safe to embed inside a real attribute value (jsdom round-trip)', () => {
        // Set a real attribute via DOM API equivalence: the escaped value, when
        // placed in markup, must not create extra nodes.
        const malicious = '"><img src=x onerror=alert(1)>';
        const markup = `<input value="${escapeHtml(malicious)}">`;
        expect(markup).not.toContain('"><img');
        expect(markup).toContain('&quot;&gt;&lt;img');
    });

    it('neutralizes a payload that targets both attribute and element context at once', () => {
        // A single value used in an attribute then closing back into element text
        // must be inert in both spots after escaping.
        const malicious = `"></td><script>alert('x')</script><td title="`;
        const escaped = escapeHtml(malicious);
        expect(escaped).not.toContain('"');
        expect(escaped).not.toContain('<script');
        expect(escaped).not.toContain('</td>');
        // Round-trips back to the original text when decoded (lossless).
        expect(escaped).toBe(
            '&quot;&gt;&lt;/td&gt;&lt;script&gt;alert(&#039;x&#039;)&lt;/script&gt;&lt;td title=&quot;'
        );
    });
});
