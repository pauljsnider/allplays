import { execFileSync } from 'node:child_process';

const CRITICAL_RULES = [
    {
        changedFile: 'js/firebase.js',
        requiredPattern: /firebase\.js\?v=\d+/g,
        failure: 'js/firebase.js changed without a matching firebase.js version bump in imports.'
    },
    {
        changedFile: 'js/firebase-images.js',
        requiredPattern: /firebase-images\.js\?v=\d+/g,
        failure: 'js/firebase-images.js changed without a matching firebase-images.js version bump in imports.'
    },
    {
        changedFile: 'js/auth.js',
        requiredPattern: /auth\.js\?v=\d+/g,
        failure: 'js/auth.js changed without a matching auth.js version bump in imports.'
    },
    {
        changedFile: 'js/db.js',
        requiredPattern: /db\.js\?v=\d+/g,
        failure: 'js/db.js changed without a matching db.js version bump in imports.'
    },
    {
        changedFile: 'js/firebase-runtime-config.js',
        requiredPattern: /(firebase-runtime-config\.js\?v=\d+|firebase\.js\?v=\d+|firebase-images\.js\?v=\d+)/g,
        failure: 'js/firebase-runtime-config.js changed without busting the runtime-config import chain.'
    }
];

function execGit(args) {
    return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 200 * 1024 * 1024 }).trim();
}

function hasCommitRef(ref) {
    try {
        execGit(['rev-parse', '--verify', `${ref}^{commit}`]);
        return true;
    } catch {
        return false;
    }
}

function isShallowRepository() {
    return execGit(['rev-parse', '--is-shallow-repository']) === 'true';
}

function getPullRequestMergeBase() {
    if (!hasCommitRef('HEAD^1') || !hasCommitRef('HEAD^2')) {
        return null;
    }

    return 'HEAD^1';
}

function refreshBaseRef(baseRef) {
    const baseRefspec = `${baseRef}:refs/remotes/origin/${baseRef}`;

    if (isShallowRepository()) {
        execGit(['fetch', '--depth=1', 'origin', baseRefspec]);
        return;
    }

    execGit(['fetch', 'origin', baseRefspec]);
}

function getDiffBase() {
    const eventName = process.env.GITHUB_EVENT_NAME;
    const baseRef = process.env.GITHUB_BASE_REF;

    if (eventName === 'pull_request' && baseRef) {
        const mergeBase = getPullRequestMergeBase();
        if (mergeBase) {
            return `${mergeBase}...HEAD`;
        }

        refreshBaseRef(baseRef);
        return `origin/${baseRef}...HEAD`;
    }

    return 'HEAD^...HEAD';
}

const diffBase = getDiffBase();
const changedFiles = new Set(
    execGit(['diff', '--name-only', diffBase])
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
);
const changedRules = CRITICAL_RULES.filter((rule) => changedFiles.has(rule.changedFile));
const diffText = changedRules.length > 0
    ? execGit(['diff', '--unified=0', diffBase])
    : '';

const failures = [];
for (const rule of changedRules) {
    const matches = diffText.match(rule.requiredPattern) || [];
    if (matches.length === 0) {
        failures.push(rule.failure);
    }
}

if (failures.length > 0) {
    console.error(failures.join('\n'));
    process.exit(1);
}

console.log('Critical cache-bust guard passed.');
