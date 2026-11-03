import { describe, expect, it } from 'vitest';
import {
    parseArgs,
    planSocialPostContactSanitization,
    runSocialPostContactMigration
} from '../../_migration/remove-social-post-author-emails.js';

const DELETE_FIELD = Symbol('delete-field');

function createFakeFirestore(initialDocuments) {
    const documents = initialDocuments.map((entry) => ({
        id: entry.id,
        data: { ...entry.data },
        updateTime: `version-${entry.id}`
    }));
    const commits = [];

    function snapshotsAfter(cursor, limit) {
        const startIndex = cursor
            ? documents.findIndex((entry) => entry.id === cursor) + 1
            : 0;
        return documents.slice(startIndex, startIndex + limit).map((entry) => ({
            id: entry.id,
            ref: { id: entry.id },
            updateTime: entry.updateTime,
            data: () => ({ ...entry.data })
        }));
    }

    const db = {
        collection: () => ({
            orderBy: () => {
                const state = { cursor: '', limit: 200 };
                const query = {
                    limit(value) {
                        state.limit = value;
                        return query;
                    },
                    startAfter(value) {
                        state.cursor = value;
                        return query;
                    },
                    async get() {
                        const docs = snapshotsAfter(state.cursor, state.limit);
                        return { docs, empty: docs.length === 0, size: docs.length };
                    }
                };
                return query;
            }
        }),
        batch: () => {
            const writes = [];
            return {
                update(ref, update, precondition) {
                    writes.push({ ref, update, precondition });
                },
                async commit() {
                    writes.forEach(({ ref, update }) => {
                        const document = documents.find((entry) => entry.id === ref.id);
                        Object.entries(update).forEach(([fieldName, value]) => {
                            if (value === DELETE_FIELD) delete document.data[fieldName];
                            else document.data[fieldName] = value;
                        });
                    });
                    commits.push(writes);
                }
            };
        }
    };

    return { db, documents, commits };
}

const dependencies = {
    fieldPath: { documentId: () => '__name__' },
    fieldValue: { delete: () => DELETE_FIELD }
};

describe('social post contact-data migration', () => {
    it('removes explicit contact fields and replaces an email-derived author name', () => {
        expect(planSocialPostContactSanitization({
            authorEmail: 'Parent@Example.test',
            email: 'alternate@example.test',
            phone: '+15555550100',
            authorName: 'parent@example.test'
        })).toEqual({
            needsUpdate: true,
            deleteFields: ['authorEmail', 'email', 'phone'],
            authorName: 'ALL PLAYS user'
        });
    });

    it.each([
        'parent@example.test',
        'Parent\nparent@example.test',
        'parent@example.test\nParent'
    ])('replaces an email-shaped author name without a companion contact field: %j', (authorName) => {
        expect(planSocialPostContactSanitization({
            authorName
        })).toEqual({
            needsUpdate: true,
            deleteFields: [],
            authorName: 'ALL PLAYS user'
        });
    });

    it.each([
        { authorPhone: '+15555550100', authorName: '+15555550100' },
        { authorName: '+1 (555) 555-0100' },
        { authorName: '+1 555\n555 0100' }
    ])('replaces a phone-derived author name: %j', (data) => {
        expect(planSocialPostContactSanitization(data)).toEqual({
            needsUpdate: true,
            deleteFields: data.authorPhone ? ['authorPhone'] : [],
            authorName: 'ALL PLAYS user'
        });
    });

    it('keeps already-safe documents unchanged for idempotent reruns', () => {
        expect(planSocialPostContactSanitization({
            authorName: 'Pat Parent',
            authorPhotoUrl: 'https://img.example.test/pat.png'
        })).toEqual({
            needsUpdate: false,
            deleteFields: [],
            authorName: null
        });
    });

    it('defaults to a bounded dry run and requires exact project confirmation for apply mode', () => {
        expect(parseArgs(['--project', 'demo-allplays'])).toMatchObject({
            apply: false,
            pageSize: 200,
            maxPages: 25,
            startAfter: ''
        });
        expect(() => parseArgs([
            '--project', 'demo-allplays',
            '--apply',
            '--confirm-project', 'another-project'
        ])).toThrow('exact project ID');
        expect(parseArgs([
            '--project', 'demo-allplays',
            '--apply',
            '--confirm-project', 'demo-allplays',
            '--page-size', '900',
            '--max-pages', '2'
        ])).toMatchObject({ apply: true, pageSize: 400, maxPages: 2 });
    });

    it('keeps dry runs write-free while paginating through the bounded collection', async () => {
        const harness = createFakeFirestore([
            { id: 'post-1', data: { authorEmail: 'one@example.test', authorName: 'One Parent' } },
            { id: 'post-2', data: { authorEmail: 'two@example.test', authorName: 'two@example.test' } },
            { id: 'post-3', data: { authorName: 'Three Parent' } }
        ]);

        const result = await runSocialPostContactMigration({
            db: harness.db,
            pageSize: 2,
            maxPages: 3,
            ...dependencies
        });

        expect(result).toEqual({
            mode: 'dry-run',
            pages: 2,
            scanned: 3,
            changed: 2,
            cursor: 'post-3',
            complete: true
        });
        expect(harness.commits).toHaveLength(0);
        expect(harness.documents[0].data).toHaveProperty('authorEmail');
    });

    it('applies update-preconditioned sanitization and is idempotent on rerun', async () => {
        const harness = createFakeFirestore([
            { id: 'post-1', data: { authorEmail: 'one@example.test', authorName: 'One Parent' } },
            { id: 'post-2', data: { authorEmail: 'two@example.test', authorName: 'TWO@example.test' } }
        ]);

        const firstRun = await runSocialPostContactMigration({
            db: harness.db,
            apply: true,
            pageSize: 1,
            maxPages: 3,
            ...dependencies
        });
        expect(firstRun.changed).toBe(2);
        expect(harness.documents.map((entry) => entry.data)).toEqual([
            { authorName: 'One Parent' },
            { authorName: 'ALL PLAYS user' }
        ]);
        expect(harness.commits.flat().map((write) => write.precondition)).toEqual([
            { lastUpdateTime: 'version-post-1' },
            { lastUpdateTime: 'version-post-2' }
        ]);

        const rerun = await runSocialPostContactMigration({
            db: harness.db,
            apply: true,
            pageSize: 2,
            maxPages: 2,
            ...dependencies
        });
        expect(rerun.changed).toBe(0);
        expect(harness.commits).toHaveLength(2);
    });
});
