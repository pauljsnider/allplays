import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CHANGELOG_PATH = 'changelog.html';
const MAX_SUMMARY_LENGTH = 260;

const CATEGORY_RULES = [
    {
        label: 'AI',
        className: 'cat-ai',
        keywords: ['ai', 'certificate', 'certificates', 'award', 'awards'],
        filePatterns: [/certificates?/i, /awards?/i, /ai/i]
    },
    {
        label: 'Payments',
        className: 'cat-payments',
        keywords: ['payment', 'payments', 'fee', 'fees', 'stripe', 'checkout'],
        filePatterns: [/team-fees/i, /stripe/i, /payments?/i, /fees?/i]
    },
    {
        label: 'Registration',
        className: 'cat-registration',
        keywords: ['registration', 'register', 'waitlist'],
        filePatterns: [/registration/i, /register/i, /waitlist/i]
    },
    {
        label: 'Media',
        className: 'cat-media',
        keywords: ['media', 'photo', 'photos', 'image', 'upload', 'album', 'video'],
        filePatterns: [/team-media/i, /firebase-images/i, /media/i, /photos?/i, /images?/i, /albums?/i]
    },
    {
        label: 'Schedule',
        className: 'cat-schedule',
        keywords: ['schedule', 'calendar', 'rsvp', 'availability', 'reminder', 'event'],
        filePatterns: [/schedule/i, /calendar/i, /rsvp/i, /availability/i, /reminder/i]
    },
    {
        label: 'Roster',
        className: 'cat-roster',
        keywords: ['roster', 'player', 'parent', 'guardian'],
        filePatterns: [/roster/i, /player/i, /parent/i, /guardian/i]
    },
    {
        label: 'Broadcasting',
        className: 'cat-broadcast',
        keywords: ['broadcast', 'stream', 'streaming', 'replay', 'camera', 'clip'],
        filePatterns: [/broadcast/i, /stream/i, /replay/i, /camera/i, /clips?/i]
    },
    {
        label: 'Game Tracking',
        className: 'cat-tracking',
        keywords: ['tracker', 'tracking', 'score', 'stats', 'game', 'live'],
        filePatterns: [/tracker/i, /tracking/i, /score/i, /stats/i, /live-game/i]
    }
];

function parseArgs(argv) {
    const args = {
        changelogPath: CHANGELOG_PATH,
        prJsonPath: ''
    };

    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg === '--changelog') {
            args.changelogPath = argv[index + 1] || args.changelogPath;
            index += 1;
        } else if (arg === '--pr-json') {
            args.prJsonPath = argv[index + 1] || '';
            index += 1;
        }
    }

    if (!args.prJsonPath) {
        throw new Error('Usage: node scripts/update-changelog-from-pr.mjs --pr-json <path> [--changelog changelog.html]');
    }

    return args;
}

export function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function truncateText(value, maxLength = MAX_SUMMARY_LENGTH) {
    const normalized = String(value || '').replace(/\s+/g, ' ').trim();
    if (normalized.length <= maxLength) return normalized;
    return `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
}

function stripMarkdown(value) {
    return String(value || '')
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/```[\s\S]*?```/g, '')
        .replace(/`([^`]+)`/g, '$1')
        .replace(/!\[[^\]]*]\([^)]*\)/g, '')
        .replace(/\[([^\]]+)]\([^)]*\)/g, '$1')
        .replace(/^#+\s*/gm, '')
        .replace(/^\s*[-*]\s+\[[ xX]]\s*/gm, '')
        .replace(/^\s*[-*]\s+/gm, '')
        .trim();
}

function extractSummaryFromBody(body) {
    const stripped = stripMarkdown(body);
    if (!stripped) return '';

    const lines = stripped
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .filter((line) => !/^tests?[:\s]/i.test(line))
        .filter((line) => !/^screenshots?[:\s]/i.test(line))
        .filter((line) => !/^fix(?:e[sd])?\s+#?\d+/i.test(line));

    const summaryIndex = lines.findIndex((line) => /^(summary|what changed|description)$/i.test(line));
    if (summaryIndex >= 0) {
        const summaryLines = [];
        for (const line of lines.slice(summaryIndex + 1)) {
            if (/^(testing|tests|screenshots?|manual test|checklist)$/i.test(line)) break;
            summaryLines.push(line);
            if (summaryLines.join(' ').length >= MAX_SUMMARY_LENGTH) break;
        }
        if (summaryLines.length) return truncateText(summaryLines.join(' '));
    }

    return truncateText(lines[0] || '');
}

function normalizeTitle(title) {
    return String(title || '')
        .replace(/^(feat|fix|chore|docs|refactor|test|style|perf)(\([^)]+\))?:\s*/i, '')
        .trim();
}

function getLabels(pr) {
    return (Array.isArray(pr.labels) ? pr.labels : [])
        .map((label) => String(label?.name || label || '').toLowerCase())
        .filter(Boolean);
}

function getFiles(pr) {
    return (Array.isArray(pr.files) ? pr.files : [])
        .map((file) => String(file?.path || file || '').toLowerCase())
        .filter(Boolean);
}

export function selectCategory(pr) {
    const labels = getLabels(pr);
    const files = getFiles(pr);
    const text = `${pr.title || ''} ${pr.body || ''}`.toLowerCase();

    for (const rule of CATEGORY_RULES) {
        const hasLabel = labels.some((label) => rule.keywords.some((keyword) => label.includes(keyword)));
        const hasTitleKeyword = rule.keywords.some((keyword) => text.includes(keyword));
        const hasFileMatch = files.some((file) => rule.filePatterns.some((pattern) => pattern.test(file)));
        if (hasLabel || hasTitleKeyword || hasFileMatch) {
            return rule;
        }
    }

    return {
        label: 'Platform',
        className: 'cat-platform'
    };
}

function getMergedDate(pr) {
    const rawDate = pr.mergedAt || pr.merged_at || pr.closedAt || pr.updatedAt || new Date().toISOString();
    const date = new Date(rawDate);
    return Number.isNaN(date.getTime()) ? new Date() : date;
}

export function getReleaseInfo(pr) {
    const date = getMergedDate(pr);
    const monthYear = new Intl.DateTimeFormat('en-US', {
        month: 'long',
        year: 'numeric',
        timeZone: 'UTC'
    }).format(date);
    const releaseId = monthYear.toLowerCase().replace(/\s+/g, '-');

    return {
        id: releaseId,
        label: monthYear,
        title: `${monthYear} Updates`,
        subtitle: `Automated updates merged during ${monthYear}.`
    };
}

export function buildChangelogEntry(pr) {
    const category = selectCategory(pr);
    const title = normalizeTitle(pr.title) || `PR #${pr.number}`;
    const summary = extractSummaryFromBody(pr.body) || `Merged PR #${pr.number}.`;
    const url = pr.url || `https://github.com/pauljsnider/allplays/pull/${pr.number}`;

    return `        <div class="entry" data-pr="${escapeHtml(pr.number)}">
          <div class="entry-header">
            <span class="cat ${category.className}">${escapeHtml(category.label)}</span>
            <span class="entry-title">${escapeHtml(title)}</span>
          </div>
          <p class="entry-body">${escapeHtml(summary)}</p>
          <a class="entry-link" href="${escapeHtml(url)}">→ PR #${escapeHtml(pr.number)}</a>
        </div>`;
}

function findReleaseSection(html, releaseId) {
    const startNeedle = `<section class="release" id="${releaseId}">`;
    const start = html.indexOf(startNeedle);
    if (start === -1) return null;

    const end = html.indexOf('</section>', start);
    if (end === -1) {
        throw new Error(`Could not find closing section tag for release ${releaseId}.`);
    }

    return {
        start,
        end: end + '</section>'.length,
        section: html.slice(start, end + '</section>'.length)
    };
}

function buildReleaseSection(release, entry) {
    return `      <!-- ── Release: ${release.label} ──────────────────────────────────────── -->
      <section class="release" id="${release.id}">
        <p class="release-date">${escapeHtml(release.label)}</p>
        <h2 class="release-title">${escapeHtml(release.title)}</h2>
        <p class="release-subtitle">${escapeHtml(release.subtitle)}</p>

        <p class="group-heading">Recent Changes</p>
        <!-- AUTO-CHANGELOG:START ${release.id} -->
${entry}
        <!-- AUTO-CHANGELOG:END ${release.id} -->
      </section>

`;
}

function addMarkersToSection(section, releaseId, entry) {
    const markerStart = `<!-- AUTO-CHANGELOG:START ${releaseId} -->`;
    const markerEnd = `<!-- AUTO-CHANGELOG:END ${releaseId} -->`;

    if (section.includes(markerStart) && section.includes(markerEnd)) {
        const insertIndex = section.indexOf(markerStart) + markerStart.length;
        return `${section.slice(0, insertIndex)}\n${entry}${section.slice(insertIndex)}`;
    }

    const subtitlePattern = /(<p class="release-subtitle">[\s\S]*?<\/p>)/;
    if (!subtitlePattern.test(section)) {
        throw new Error(`Could not find release subtitle for ${releaseId}.`);
    }

    return section.replace(
        subtitlePattern,
        `$1

        <p class="group-heading">Recent Changes</p>
        ${markerStart}
${entry}
        ${markerEnd}`
    );
}

export function updateChangelogHtml(html, pr) {
    if (!pr?.number) {
        throw new Error('PR metadata must include a number.');
    }

    const prNeedle = `data-pr="${pr.number}"`;
    if (html.includes(prNeedle)) {
        return { html, changed: false, releaseId: getReleaseInfo(pr).id };
    }

    const release = getReleaseInfo(pr);
    const entry = buildChangelogEntry(pr);
    const releaseSection = findReleaseSection(html, release.id);

    if (releaseSection) {
        const nextSection = addMarkersToSection(releaseSection.section, release.id, entry);
        return {
            html: `${html.slice(0, releaseSection.start)}${nextSection}${html.slice(releaseSection.end)}`,
            changed: true,
            releaseId: release.id
        };
    }

    const firstReleaseIndex = html.indexOf('      <!-- ── Release:');
    const fallbackIndex = html.indexOf('      <section class="release"');
    const insertIndex = firstReleaseIndex >= 0 ? firstReleaseIndex : fallbackIndex;

    if (insertIndex === -1) {
        throw new Error('Could not find a release insertion point in changelog.html.');
    }

    const newReleaseSection = buildReleaseSection(release, entry);
    return {
        html: `${html.slice(0, insertIndex)}${newReleaseSection}${html.slice(insertIndex)}`,
        changed: true,
        releaseId: release.id
    };
}

function main() {
    const args = parseArgs(process.argv.slice(2));
    const pr = JSON.parse(readFileSync(args.prJsonPath, 'utf8'));
    const changelogPath = path.resolve(args.changelogPath);
    const html = readFileSync(changelogPath, 'utf8');
    const result = updateChangelogHtml(html, pr);

    if (!result.changed) {
        console.log(`Changelog already contains PR #${pr.number}.`);
        return;
    }

    writeFileSync(changelogPath, result.html);
    console.log(`Updated changelog for PR #${pr.number} in ${result.releaseId}.`);
}

const thisFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === thisFile) {
    main();
}
