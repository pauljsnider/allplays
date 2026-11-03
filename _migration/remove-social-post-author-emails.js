#!/usr/bin/env node

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { FieldPath, FieldValue, getFirestore } from 'firebase-admin/firestore';

export const SOCIAL_POST_CONTACT_FIELDS = Object.freeze([
    'authorEmail',
    'authorEmailAddress',
    'email',
    'emailAddress',
    'contactEmail',
    'authorPhone',
    'authorPhoneNumber',
    'phone',
    'phoneNumber',
    'mobile',
    'mobilePhone',
    'contactPhone',
    'contactPhoneNumber'
]);

const SOCIAL_POST_EMAIL_FIELDS = Object.freeze([
    'authorEmail',
    'authorEmailAddress',
    'email',
    'emailAddress',
    'contactEmail'
]);

export function parsePositiveBound(value, fallback, max) {
    const parsed = Number.parseInt(String(value || ''), 10);
    return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, max) : fallback;
}

export function parseArgs(argv) {
    const options = {
        apply: false,
        pageSize: 200,
        maxPages: 25,
        startAfter: ''
    };

    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg === '--apply') options.apply = true;
        else if (arg === '--project') options.projectId = argv[++index];
        else if (arg === '--confirm-project') options.confirmProject = argv[++index];
        else if (arg === '--page-size') options.pageSize = parsePositiveBound(argv[++index], 200, 400);
        else if (arg === '--max-pages') options.maxPages = parsePositiveBound(argv[++index], 25, 10_000);
        else if (arg === '--start-after') options.startAfter = String(argv[++index] || '').trim();
        else throw new Error(`Unknown argument: ${arg}`);
    }

    if (!options.projectId) throw new Error('--project is required.');
    if (options.apply && options.confirmProject !== options.projectId) {
        throw new Error('--apply requires --confirm-project with the exact project ID.');
    }
    return options;
}

function hasOwn(data, fieldName) {
    return Object.prototype.hasOwnProperty.call(data, fieldName);
}

function normalizedString(value) {
    return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

export function planSocialPostContactSanitization(data = {}) {
    const deleteFields = SOCIAL_POST_CONTACT_FIELDS.filter((fieldName) => hasOwn(data, fieldName));
    const storedEmails = new Set(
        SOCIAL_POST_EMAIL_FIELDS
            .map((fieldName) => normalizedString(data[fieldName]))
            .filter(Boolean)
    );
    const authorName = normalizedString(data.authorName);
    const replaceAuthorName = authorName.includes('@') || storedEmails.has(authorName);

    return {
        needsUpdate: deleteFields.length > 0 || replaceAuthorName,
        deleteFields,
        authorName: replaceAuthorName ? 'ALL PLAYS user' : null
    };
}

export async function runSocialPostContactMigration({
    db,
    apply = false,
    pageSize = 200,
    maxPages = 25,
    startAfter = '',
    fieldPath = FieldPath,
    fieldValue = FieldValue,
    onPage = () => {}
}) {
    let cursorId = startAfter;
    let pages = 0;
    let scanned = 0;
    let changed = 0;
    let complete = false;

    while (pages < maxPages) {
        let query = db.collection('socialPosts')
            .orderBy(fieldPath.documentId())
            .limit(pageSize);
        if (cursorId) query = query.startAfter(cursorId);

        const snapshot = await query.get();
        if (snapshot.empty) {
            complete = true;
            break;
        }

        const batch = apply ? db.batch() : null;
        let pageChanges = 0;
        for (const docSnap of snapshot.docs) {
            scanned += 1;
            const plan = planSocialPostContactSanitization(docSnap.data() || {});
            if (!plan.needsUpdate) continue;

            changed += 1;
            pageChanges += 1;
            if (apply) {
                const update = Object.fromEntries(
                    plan.deleteFields.map((fieldName) => [fieldName, fieldValue.delete()])
                );
                if (plan.authorName) update.authorName = plan.authorName;
                batch.update(docSnap.ref, update, { lastUpdateTime: docSnap.updateTime });
            }
        }

        if (apply && pageChanges > 0) await batch.commit();
        pages += 1;
        cursorId = snapshot.docs.at(-1).id;
        onPage({
            mode: apply ? 'apply' : 'dry-run',
            page: pages,
            scanned: snapshot.size,
            changed: pageChanges,
            cursor: cursorId
        });

        if (snapshot.size < pageSize) {
            complete = true;
            break;
        }
    }

    return { mode: apply ? 'apply' : 'dry-run', pages, scanned, changed, cursor: cursorId, complete };
}

async function main() {
    const options = parseArgs(process.argv.slice(2));
    const app = getApps()[0] || initializeApp({
        credential: applicationDefault(),
        projectId: options.projectId
    });
    const result = await runSocialPostContactMigration({
        db: getFirestore(app),
        ...options,
        onPage: (page) => {
            process.stdout.write(
                `${page.mode} page=${page.page} scanned=${page.scanned} changed=${page.changed} cursor=${page.cursor}\n`
            );
        }
    });
    process.stdout.write(
        `${result.mode === 'apply' ? 'APPLIED' : 'DRY RUN'} scanned=${result.scanned} changed=${result.changed} pages=${result.pages} cursor=${result.cursor} complete=${result.complete}\n`
    );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
    main().catch((error) => {
        console.error('[remove-social-post-author-emails] Failed:', error.message);
        process.exitCode = 1;
    });
}
