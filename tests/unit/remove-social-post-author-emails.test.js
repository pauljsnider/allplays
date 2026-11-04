import { describe, expect, it } from 'vitest';
import {
    removeSocialPostAuthorEmails,
    resolveMigrationOptions,
    SOCIAL_POST_PUBLIC_AUTHOR_LABEL
} from '../../_migration/remove-social-post-author-emails.js';

const DELETE_VALUE = Symbol('delete');

function createFakeDatabase(records) {
    const stored = new Map(Object.entries(records).map(([id, data]) => [id, structuredClone(data)]));
    const updates = [];
    const queries = [];

    function documentFor(id) {
        return {
            id,
            ref: {
                path: `socialPosts/${id}`,
                async update(patch) {
                    updates.push({ id, patch });
                    const next = { ...stored.get(id) };
                    Object.entries(patch).forEach(([field, value]) => {
                        if (value === DELETE_VALUE) delete next[field];
                        else next[field] = value;
                    });
                    stored.set(id, next);
                }
            },
            data: () => structuredClone(stored.get(id))
        };
    }

    return {
        stored,
        updates,
        queries,
        collection(name) {
            if (name !== 'socialPosts') throw new Error(`Unexpected collection: ${name}`);
            return {
                orderBy(field) {
                    let pageLimit;
                    let cursorId = null;
                    return {
                        limit(value) {
                            pageLimit = value;
                            return this;
                        },
                        startAfter(document) {
                            cursorId = document.id;
                            return this;
                        },
                        async get() {
                            const ids = [...stored.keys()].sort();
                            const start = cursorId === null ? 0 : ids.indexOf(cursorId) + 1;
                            const pageIds = ids.slice(start, start + pageLimit);
                            queries.push({ field, limit: pageLimit, cursorId, pageIds });
                            return { docs: pageIds.map(documentFor) };
                        }
                    };
                }
            };
        }
    };
}

const migrationOptions = {
    deleteValue: DELETE_VALUE,
    documentIdField: '__name__',
    logger: { log() {} }
};

describe('remove social post author emails migration', () => {
    it('requires exact project confirmation before granting apply write authority', () => {
        expect(resolveMigrationOptions(
            ['node', 'migration.js', '--project', 'demo-allplays'],
            {}
        )).toEqual({
            apply: false,
            pageSize: 200,
            projectId: 'demo-allplays'
        });
        expect(() => resolveMigrationOptions(
            ['node', 'migration.js', '--apply', '--project', 'demo-allplays'],
            {}
        )).toThrow('Apply mode requires --confirm-project demo-allplays.');
        expect(resolveMigrationOptions(
            [
                'node',
                'migration.js',
                '--apply',
                '--project',
                'demo-allplays',
                '--confirm-project',
                'demo-allplays'
            ],
            {}
        ).apply).toBe(true);
    });

    it('denies write effects to the default dry-run operator while reporting intended changes', async () => {
        const db = createFakeDatabase({
            post1: {
                authorEmail: 'member@example.test',
                authorName: 'member@example.test',
                title: 'Team update'
            }
        });

        const result = await removeSocialPostAuthorEmails(db, migrationOptions);

        expect(result).toEqual({
            apply: false,
            pagesProcessed: 1,
            documentsScanned: 1,
            documentsChanged: 1
        });
        expect(db.updates).toEqual([]);
        expect(db.stored.get('post1')).toEqual({
            authorEmail: 'member@example.test',
            authorName: 'member@example.test',
            title: 'Team update'
        });
    });

    it('removes explicit email fields and replaces only an exactly matching author label', async () => {
        const db = createFakeDatabase({
            matching: {
                authorEmail: 'member@example.test',
                authorName: 'member@example.test',
                title: 'Team update',
                teamId: 'team-a'
            },
            named: {
                authorEmail: 'coach@example.test',
                authorName: 'Coach Taylor',
                title: 'Practice update',
                teamId: 'team-b'
            },
            noStoredEmail: {
                authorName: 'other@example.test',
                title: 'No legacy field'
            }
        });

        const result = await removeSocialPostAuthorEmails(db, {
            ...migrationOptions,
            apply: true
        });

        expect(result.documentsChanged).toBe(2);
        expect(db.stored.get('matching')).toEqual({
            authorName: SOCIAL_POST_PUBLIC_AUTHOR_LABEL,
            title: 'Team update',
            teamId: 'team-a'
        });
        expect(db.stored.get('named')).toEqual({
            authorName: 'Coach Taylor',
            title: 'Practice update',
            teamId: 'team-b'
        });
        expect(db.stored.get('noStoredEmail')).toEqual({
            authorName: 'other@example.test',
            title: 'No legacy field'
        });
    });

    it('processes all social posts through bounded pages', async () => {
        const db = createFakeDatabase(Object.fromEntries(
            Array.from({ length: 5 }, (_, index) => [
                `post${index + 1}`,
                { authorEmail: `member${index + 1}@example.test`, authorName: `Member ${index + 1}` }
            ])
        ));

        const result = await removeSocialPostAuthorEmails(db, {
            ...migrationOptions,
            apply: true,
            pageSize: 2
        });

        expect(result).toEqual({
            apply: true,
            pagesProcessed: 3,
            documentsScanned: 5,
            documentsChanged: 5
        });
        expect(db.queries.map((query) => query.pageIds)).toEqual([
            ['post1', 'post2'],
            ['post3', 'post4'],
            ['post5']
        ]);
        expect(db.queries.every((query) => query.limit === 2)).toBe(true);
        expect(db.updates).toHaveLength(5);
    });

    it('is idempotent when apply mode is rerun', async () => {
        const db = createFakeDatabase({
            post1: {
                authorEmail: 'member@example.test',
                authorName: 'member@example.test',
                title: 'Team update'
            }
        });

        const first = await removeSocialPostAuthorEmails(db, {
            ...migrationOptions,
            apply: true
        });
        const firstUpdateCount = db.updates.length;
        const second = await removeSocialPostAuthorEmails(db, {
            ...migrationOptions,
            apply: true
        });

        expect(first.documentsChanged).toBe(1);
        expect(second.documentsChanged).toBe(0);
        expect(db.updates).toHaveLength(firstUpdateCount);
        expect(db.stored.get('post1')).toEqual({
            authorName: SOCIAL_POST_PUBLIC_AUTHOR_LABEL,
            title: 'Team update'
        });
    });
});
