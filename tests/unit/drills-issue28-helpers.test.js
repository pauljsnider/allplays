import { describe, it, expect } from 'vitest';
import { mergeUniqueDrills, linkifySafeText, parseMarkdown } from '../../js/drills-issue28-helpers.js';

const escapeHtml = (value) =>
    String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');

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
        const rendered = linkifySafeText(unsafe, escapeHtml);

        expect(rendered).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
        expect(rendered).toContain('href="https://kinoli.com/a/AnVCZ6BneIVx"');
        expect(rendered).not.toContain('<script>');
    });

    it('linkifySafeText does not link malformed urls', () => {
        const rendered = linkifySafeText('Bad link https://example..com/path', escapeHtml);

        expect(rendered).toContain('https://example..com/path');
        expect(rendered).not.toContain('<a href=');
    });

    it('linkifySafeText keeps sentence punctuation outside links', () => {
        const rendered = linkifySafeText('Watch https://kinoli.com/a/AnVCZ6BneIVx.', escapeHtml);

        expect(rendered).toContain('href="https://kinoli.com/a/AnVCZ6BneIVx"');
        expect(rendered).toContain('</a>.');
    });

    it('parseMarkdown renders coach instruction formatting', () => {
        const instructions = [
            '## Practice Focus',
            '**Setup:**',
            '1. Set up a 1v1 scenario.',
            '2. Designate a `server`.',
            '',
            '**Coaching Points:**',
            '*   Emphasize re-engagement.',
            '*   Focus on dynamic off-ball movement.'
        ].join('\n');

        const rendered = parseMarkdown(instructions, escapeHtml);

        expect(rendered).toContain('<div class="font-semibold text-sm mt-2">Practice Focus</div>');
        expect(rendered).toContain('<strong>Setup:</strong>');
        expect(rendered).toContain('<ol class="list-decimal list-outside ml-4 space-y-0.5">');
        expect(rendered).toContain('<li>Set up a 1v1 scenario.</li>');
        expect(rendered).toContain('<li>Designate a <code class="font-mono text-xs opacity-80">server</code>.</li>');
        expect(rendered).toContain('<div class="h-1"></div>');
        expect(rendered).toContain('<strong>Coaching Points:</strong>');
        expect(rendered).toContain('<ul class="list-disc list-outside ml-4 space-y-0.5">');
        expect(rendered).toContain('<li>Emphasize re-engagement.</li>');
        expect(rendered).toContain('<li>Focus on dynamic off-ball movement.</li>');
    });

    it('parseMarkdown escapes unsafe markup before applying inline markdown', () => {
        const rendered = parseMarkdown('**<img onerror="alert(1)">**\n<script>alert("xss")</script>', escapeHtml);

        expect(rendered).toContain('&lt;img onerror=&quot;alert(1)&quot;&gt;');
        expect(rendered).toContain('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
        expect(rendered).not.toContain('<img');
        expect(rendered).not.toContain('<script>');
        expect(rendered).not.toContain('onerror="alert(1)"');
    });

    it('parseMarkdown preserves safe links without linking malformed or attribute-breaking URLs', () => {
        const rendered = parseMarkdown([
            'Watch https://example.com/watch?v=1&list=abc.',
            'Bad URL https://example..com/path should stay text',
            'Encoded quote https://example.com?a=1"onclick="alert(1)'
        ].join('\n'), escapeHtml);

        expect(rendered).toContain('href="https://example.com/watch?v=1&amp;list=abc"');
        expect(rendered).toContain('https://example.com/watch?v=1&amp;list=abc</a>.');
        expect(rendered).not.toContain('&amp;amp;list=abc');
        expect(rendered).toContain('Bad URL https://example..com/path should stay text');
        expect(rendered).not.toContain('href="https://example..com/path"');
        expect(rendered).toContain('href="https://example.com/?a=1%22onclick=%22alert(1"');
        expect(rendered).not.toContain('onclick="alert(1)"');
    });
});
