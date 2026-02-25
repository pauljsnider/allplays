import { describe, it, expect } from 'vitest';
import { mergeUniqueDrills, linkifySafeText } from '../../js/drills-issue28-helpers.js';

describe('issue 28 drill helpers', () => {
    it('mergeUniqueDrills de-duplicates by id and sorts by title', () => {
        const community = [
            { id: '1', title: 'Z Drill' },
            { id: '2', title: 'A Drill', source: 'community' }
        ];
        const published = [
            { id: '2', title: 'A Drill (Published)', source: 'custom', publishedToCommunity: true },
            { id: '3', title: 'M Drill', source: 'custom', publishedToCommunity: true }
        ];

        const merged = mergeUniqueDrills(community, published);

        expect(merged.map(d => d.id)).toEqual(['2', '3', '1']);
        expect(merged[0].source).toBe('custom');
    });

    it('linkifySafeText escapes markup and linkifies URLs', () => {
        const unsafe = `Use this <script>alert(1)</script> https://kinoli.com/a/AnVCZ6BneIVx`;
        const escaped = (value) =>
            value
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#039;');

        const rendered = linkifySafeText(unsafe, escaped);

        expect(rendered).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
        expect(rendered).toContain('href="https://kinoli.com/a/AnVCZ6BneIVx"');
        expect(rendered).not.toContain('<script>');
    });

    it('linkifySafeText does not link malformed urls', () => {
        const escaped = (value) =>
            value
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#039;');

        const rendered = linkifySafeText('Bad link https://example..com/path', escaped);

        expect(rendered).toContain('https://example..com/path');
        expect(rendered).not.toContain('<a href=');
    });

    it('linkifySafeText keeps sentence punctuation outside links', () => {
        const escaped = (value) =>
            value
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#039;');

        const rendered = linkifySafeText('Watch https://kinoli.com/a/AnVCZ6BneIVx.', escaped);

        expect(rendered).toContain('href="https://kinoli.com/a/AnVCZ6BneIVx"');
        expect(rendered).toContain('</a>.');
    });
});
