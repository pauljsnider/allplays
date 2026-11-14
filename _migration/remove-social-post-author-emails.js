#!/usr/bin/env node
/**
 * Remove legacy author email fields from social posts.
 *
 * Dry run:
 *   node _migration/remove-social-post-author-emails.js --project game-flow-c6311
 *
 * Apply:
 *   node _migration/remove-social-post-author-emails.js --apply \
 *     --project game-flow-c6311 --confirm-project game-flow-c6311
 */

import { pathToFileURL } from 'node:url';
import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { FieldPath, FieldValue, getFirestore } from 'firebase-admin/firestore';

const DEFAULT_PAGE_SIZE = 200;
const MAX_PAGE_SIZE = 500;
export const SOCIAL_POST_PUBLIC_AUTHOR_LABEL = 'ALL PLAYS member';

function readArg(name, argv = process.argv) {
    const inlinePrefix = `--${name}=`;
    const inline = argv.find((arg) => arg.startsWith(inlinePrefix));
    if (inline) return inline.slice(inlinePrefix.length);
    const index = argv.indexOf(`--${name}`);
    return index >= 0 ? argv[index + 1] || '' : '';
}

export function resolveMigrationOptions(argv = process.argv, env = process.env) {
    const apply = argv.includes('--apply');
    const projectId = String(readArg('project', argv) || env.FIREBASE_PROJECT_ID || '').trim();
    const confirmedProjectId = String(readArg('confirm-project', argv) || '').trim();
    const pageSizeValue = readArg('page-size', argv);
    const pageSize = pageSizeValue ? Number(pageSizeValue) : DEFAULT_PAGE_SIZE;

    if (!projectId) {
        throw new Error('Choose a Firebase project with --project PROJECT_ID or FIREBASE_PROJECT_ID.');
    }
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > MAX_PAGE_SIZE) {
        throw new Error(`--page-size must be an integer from 1 through ${MAX_PAGE_SIZE}.`);
    }
    if (apply && confirmedProjectId !== projectId) {
        throw new Error(`Apply mode requires --confirm-project ${projectId}.`);
    }

    return { apply, pageSize, projectId };
}

export function buildSocialPostAuthorEmailPatch(data = {}, deleteValue) {
    if (!Object.prototype.hasOwnProperty.call(data, 'authorEmail')) return null;

    const patch = { authorEmail: deleteValue };
    if (
        typeof data.authorEmail === 'string' &&
        data.authorEmail.length > 0 &&
        data.authorName === data.authorEmail
    ) {
        patch.authorName = SOCIAL_POST_PUBLIC_AUTHOR_LABEL;
    }
    return patch;
}

export async function removeSocialPostAuthorEmails(db, options = {}) {
    const apply = options.apply === true;
    const pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;
    const logger = options.logger || console;
    const documentIdField = options.documentIdField ?? FieldPath.documentId();
    const deleteValue = options.deleteValue ?? FieldValue.delete();

    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > MAX_PAGE_SIZE) {
        throw new Error(`pageSize must be an integer from 1 through ${MAX_PAGE_SIZE}.`);
    }

    const collection = db.collection('socialPosts');
    let cursor = null;
    let pagesProcessed = 0;
    let documentsScanned = 0;
    let documentsChanged = 0;

    while (true) {
        let query = collection.orderBy(documentIdField).limit(pageSize);
        if (cursor) query = query.startAfter(cursor);
        const snapshot = await query.get();
        const documents = snapshot.docs || [];
        if (documents.length === 0) break;

        pagesProcessed += 1;
        documentsScanned += documents.length;
        for (const document of documents) {
            const patch = buildSocialPostAuthorEmailPatch(document.data() || {}, deleteValue);
            if (!patch) continue;

            documentsChanged += 1;
            const fields = Object.keys(patch).sort().join(', ');
            logger.log(
                `[remove-social-post-author-emails] ${apply ? 'UPDATE' : 'WOULD UPDATE'} ` +
                `${document.ref.path} (${fields})`
            );
            if (apply) await document.ref.update(patch);
        }

        cursor = documents[documents.length - 1];
        if (documents.length < pageSize) break;
    }

    const result = { apply, pagesProcessed, documentsScanned, documentsChanged };
    logger.log(
        `[remove-social-post-author-emails] ${apply ? 'Applied' : 'Dry run complete'}: ` +
        `${documentsChanged} of ${documentsScanned} document(s) require changes across ` +
        `${pagesProcessed} page(s).`
    );
    return result;
}

async function main() {
    const options = resolveMigrationOptions();
    if (!getApps().length) {
        initializeApp({
            credential: applicationDefault(),
            projectId: options.projectId
        });
    }
    await removeSocialPostAuthorEmails(getFirestore(), options);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main().catch((error) => {
        console.error('[remove-social-post-author-emails] Failed:', error?.message || error);
        process.exitCode = 1;
    });
}
