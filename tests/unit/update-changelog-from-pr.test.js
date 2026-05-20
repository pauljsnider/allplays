import { describe, expect, it } from 'vitest';

import {
    buildChangelogEntry,
    selectCategory,
    updateChangelogHtml
} from '../../scripts/update-changelog-from-pr.mjs';

const baseHtml = `<!DOCTYPE html>
<html>
<body>
    <div class="flex-1 min-w-0">
      <!-- ── Release: May 2026 ──────────────────────────────────────── -->
      <section class="release" id="may-2026">
        <p class="release-date">May 2026</p>
        <h2 class="release-title">Spring 2026 Release</h2>
        <p class="release-subtitle">Manual release notes.</p>

        <p class="group-heading">New Features</p>
        <div class="entry">
          <div class="entry-header">
            <span class="cat cat-platform">Platform</span>
            <span class="entry-title">Existing feature</span>
          </div>
          <p class="entry-body">Existing release note.</p>
        </div>
      </section>
    </div>
</body>
</html>`;

function makePr(overrides = {}) {
    return {
        number: 123,
        title: 'feat: Improve schedule reminders',
        body: '## Summary\nSend reminder emails with safer copy.\n\n## Testing\n- npm test',
        url: 'https://github.com/pauljsnider/allplays/pull/123',
        mergedAt: '2026-05-16T12:00:00Z',
        labels: [{ name: 'schedule' }],
        files: [{ path: 'js/schedule-notifications.js' }],
        ...overrides
    };
}

describe('updateChangelogHtml', () => {
    it('adds a recent changes block to an existing monthly release', () => {
        const result = updateChangelogHtml(baseHtml, makePr());

        expect(result.changed).toBe(true);
        expect(result.releaseId).toBe('may-2026');
        expect(result.html).toContain('<!-- AUTO-CHANGELOG:START may-2026 -->');
        expect(result.html).toContain('data-pr="123"');
        expect(result.html).toContain('Improve schedule reminders');
        expect(result.html).toContain('Send reminder emails with safer copy.');
        expect(result.html.indexOf('data-pr="123"')).toBeLessThan(result.html.indexOf('New Features'));
    });

    it('does not add duplicate entries for the same pull request', () => {
        const once = updateChangelogHtml(baseHtml, makePr());
        const twice = updateChangelogHtml(once.html, makePr());

        expect(twice.changed).toBe(false);
        expect(twice.html.match(/data-pr="123"/g)).toHaveLength(1);
    });

    it('creates a new monthly release section when the merge month is not present', () => {
        const result = updateChangelogHtml(baseHtml, makePr({
            number: 124,
            title: 'fix: Harden registration validation',
            mergedAt: '2026-06-01T09:30:00Z',
            labels: [{ name: 'registration' }],
            files: [{ path: 'registration.html' }]
        }));

        expect(result.changed).toBe(true);
        expect(result.releaseId).toBe('june-2026');
        expect(result.html).toContain('<section class="release" id="june-2026">');
        expect(result.html.indexOf('id="june-2026"')).toBeLessThan(result.html.indexOf('id="may-2026"'));
    });

    it('inserts new entries into an existing automated block newest first', () => {
        const first = updateChangelogHtml(baseHtml, makePr({ number: 201, title: 'First merged PR' }));
        const second = updateChangelogHtml(first.html, makePr({ number: 202, title: 'Second merged PR' }));

        expect(second.changed).toBe(true);
        expect(second.html.indexOf('data-pr="202"')).toBeLessThan(second.html.indexOf('data-pr="201"'));
    });
});

describe('buildChangelogEntry', () => {
    it('escapes pull request metadata before writing HTML', () => {
        const entry = buildChangelogEntry(makePr({
            number: 77,
            title: 'fix: Prevent <script>alert("x")</script>',
            body: '## Summary\nUse & validate user-provided copy.',
            url: 'https://example.test/pull/77?name=<unsafe>'
        }));

        expect(entry).toContain('Prevent &lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;');
        expect(entry).toContain('Use &amp; validate user-provided copy.');
        expect(entry).toContain('https://example.test/pull/77?name=&lt;unsafe&gt;');
        expect(entry).not.toContain('<script>');
    });
});

describe('selectCategory', () => {
    it('prefers certificate and awards changes as AI changelog items', () => {
        const category = selectCategory(makePr({
            title: 'Add awards certificate defaults',
            labels: [],
            files: [{ path: 'js/certificates/assets.js' }]
        }));

        expect(category).toMatchObject({
            label: 'AI',
            className: 'cat-ai'
        });
    });
});
