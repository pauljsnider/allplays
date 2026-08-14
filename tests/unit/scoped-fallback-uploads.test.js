import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const uploadState = vi.hoisted(() => ({
    calls: [],
    deletions: [],
    hangPrimaryUpload: false,
    rejectPrimaryUpload: false
}));

const imageAuthMocks = vi.hoisted(() => ({
    ensureImageAuth: vi.fn(),
    requireImageAuth: vi.fn()
}));

const firebaseMocks = vi.hoisted(() => ({
    ref: vi.fn((targetStorage, path) => ({ targetStorage, fullPath: path })),
    uploadBytes: vi.fn(async (storageRef, file) => {
        uploadState.calls.push({ targetStorage: storageRef.targetStorage, fullPath: storageRef.fullPath, file });
        if (storageRef.targetStorage === 'image-storage') {
            throw Object.assign(new Error('denied'), { code: 'storage/unauthorized' });
        }
        if (uploadState.hangPrimaryUpload) {
            return new Promise(() => {});
        }
        if (uploadState.rejectPrimaryUpload) {
            throw new Error('upload response lost');
        }
        return { ref: storageRef };
    }),
    getDownloadURL: vi.fn(async (storageRef) => `https://cdn.example.test/${storageRef.fullPath}`),
    deleteObject: vi.fn(async (storageRef) => {
        uploadState.deletions.push(storageRef);
    })
}));

vi.mock('../../js/firebase.js?v=26', () => ({
    db: {},
    auth: { currentUser: { uid: 'user-42' } },
    storage: 'main-storage',
    collection: vi.fn(),
    getDocs: vi.fn(),
    getDoc: vi.fn(),
    doc: vi.fn(),
    addDoc: vi.fn(),
    updateDoc: vi.fn(),
    deleteDoc: vi.fn(),
    setDoc: vi.fn(),
    query: vi.fn(),
    where: vi.fn(),
    orderBy: vi.fn(),
    Timestamp: { now: vi.fn(() => ({ toMillis: () => Date.now() })) },
    increment: vi.fn(),
    arrayUnion: vi.fn(),
    arrayRemove: vi.fn(),
    deleteField: vi.fn(),
    limit: vi.fn(),
    startAfter: vi.fn(),
    getCountFromServer: vi.fn(),
    onSnapshot: vi.fn(),
    serverTimestamp: vi.fn(),
    collectionGroup: vi.fn(),
    documentId: vi.fn(),
    writeBatch: vi.fn(),
    runTransaction: vi.fn(),
    functions: {},
    httpsCallable: vi.fn(),
    ref: firebaseMocks.ref,
    uploadBytes: firebaseMocks.uploadBytes,
    getDownloadURL: firebaseMocks.getDownloadURL,
    deleteObject: firebaseMocks.deleteObject
}));


vi.mock('../../js/firebase-images.js?v=11', () => ({
    imageStorage: 'image-storage',
    ensureImageAuth: imageAuthMocks.ensureImageAuth,
    requireImageAuth: imageAuthMocks.requireImageAuth
}));

describe('scoped fallback uploads', () => {
    beforeEach(() => {
        uploadState.calls.length = 0;
        uploadState.deletions.length = 0;
        uploadState.hangPrimaryUpload = false;
        uploadState.rejectPrimaryUpload = false;
        vi.restoreAllMocks();
        vi.clearAllMocks();
        imageAuthMocks.ensureImageAuth.mockResolvedValue({ uid: 'image-user' });
        imageAuthMocks.requireImageAuth.mockResolvedValue({ uid: 'image-user' });
        vi.spyOn(Date, 'now').mockReturnValue(1700000000000);
        let secureTokenSequence = 0;
        vi.stubGlobal('crypto', {
            randomUUID: () => (++secureTokenSequence).toString(16).padStart(32, '0')
        });
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    it('uploads chat attachments directly to the primary scoped path without image-project auth', async () => {
        const { uploadChatImage } = await import('../../js/db.js?v=4433173-scoped-fallback-uploads');

        const result = await uploadChatImage('team/alpha', {
            name: 'family photo (1).png',
            size: 789,
            type: 'image/png'
        }, { conversationId: 'group_user%3Acoach-1' });

        expect(imageAuthMocks.requireImageAuth).not.toHaveBeenCalled();
        expect(uploadState.calls).toEqual([expect.objectContaining({
            targetStorage: 'main-storage',
            fullPath: 'stat-sheets/team-chat/team_alpha/group_user%3Acoach-1/user-42/1700000000000_00000000000000000000000000000001_family_photo_1_.png'
        })]);
        expect(result).toEqual(expect.objectContaining({
            path: 'stat-sheets/team-chat/team_alpha/group_user%3Acoach-1/user-42/1700000000000_00000000000000000000000000000001_family_photo_1_.png'
        }));
    });

    it('rejects stalled primary uploads instead of leaving the legacy composer stuck', async () => {
        vi.useFakeTimers();
        uploadState.hangPrimaryUpload = true;
        const { uploadChatImage } = await import('../../js/db.js?v=4433173-scoped-fallback-uploads');

        const upload = uploadChatImage('team-1', {
            name: 'photo.jpg',
            size: 789,
            type: 'image/jpeg'
        });
        const rejection = expect(upload).rejects.toThrow('Chat media upload timed out');

        await vi.advanceTimersByTimeAsync(25000);
        await rejection;
    });

    it('deletes an uploaded chat attachment when its download URL cannot be resolved', async () => {
        firebaseMocks.getDownloadURL.mockRejectedValueOnce(new Error('url lookup failed'));
        const { uploadChatImage } = await import('../../js/db.js?v=4433173-scoped-fallback-uploads');

        await expect(uploadChatImage('team-1', {
            name: 'photo.jpg',
            size: 789,
            type: 'image/jpeg'
        })).rejects.toThrow('url lookup failed');

        expect(uploadState.deletions).toEqual([
            expect.objectContaining({
                targetStorage: 'main-storage',
                fullPath: 'stat-sheets/team-chat/team-1/team/user-42/1700000000000_00000000000000000000000000000001_photo.jpg'
            })
        ]);
    });

    it('deletes new scoped chat media from primary storage and legacy chat media from image storage', async () => {
        const { deleteUploadedChatAttachments } = await import('../../js/db.js?v=4433173-scoped-fallback-uploads');

        await deleteUploadedChatAttachments([
            { path: 'stat-sheets/team-chat/team-a/team/user-42/new.jpg' },
            { path: 'team-photos/legacy.jpg' },
            { path: 'team-videos/legacy.mp4' },
            { path: 'drill-diagrams/drill-1/diagram.png' },
            { path: 'player-photos/player.png' },
            { path: 'user-photos/user.png' }
        ]);

        expect(uploadState.deletions).toEqual([
            expect.objectContaining({ targetStorage: 'main-storage', fullPath: 'stat-sheets/team-chat/team-a/team/user-42/new.jpg' }),
            expect.objectContaining({ targetStorage: 'image-storage', fullPath: 'team-photos/legacy.jpg' }),
            expect.objectContaining({ targetStorage: 'image-storage', fullPath: 'team-videos/legacy.mp4' }),
            expect.objectContaining({ targetStorage: 'image-storage', fullPath: 'drill-diagrams/drill-1/diagram.png' }),
            expect.objectContaining({ targetStorage: 'image-storage', fullPath: 'player-photos/player.png' }),
            expect.objectContaining({ targetStorage: 'image-storage', fullPath: 'user-photos/user.png' })
        ]);
    });

    it('uses the primary scoped path for browser player photos and deletes it on rollback', async () => {
        const { deleteLegacyImageUpload, uploadPlayerPhoto } = await import('../../js/db.js?v=4433173-scoped-fallback-uploads');

        const uploaded = await uploadPlayerPhoto({
            name: 'kid photo.png',
            size: 123,
            type: 'image/png'
        }, { returnUpload: true, teamId: 'team/alpha', playerId: 'player 7' });

        expect(uploaded.url).toBe(`https://cdn.example.test/${uploaded.path}`);
        expect(uploaded.path).toMatch(/^profile-photos\/teams\/team_alpha\/players\/player_7\/1700000000000_[a-f0-9]{32}_profile-photo\.png$/);
        expect(uploadState.calls[0]).toEqual(expect.objectContaining({ targetStorage: 'main-storage' }));

        await deleteLegacyImageUpload(uploaded.path);
        expect(uploadState.deletions).toEqual(expect.arrayContaining([
            expect.objectContaining({
                targetStorage: 'main-storage',
                fullPath: uploaded.path
            })
        ]));
    });

    it('deletes a completed browser team photo when its download URL lookup fails', async () => {
        firebaseMocks.getDownloadURL.mockRejectedValueOnce(new Error('url lookup failed'));
        const { uploadTeamPhoto } = await import('../../js/db.js?v=4433173-scoped-fallback-uploads');

        await expect(uploadTeamPhoto({
            name: 'team.png',
            size: 123,
            type: 'image/png'
        }, { teamId: 'team-1' })).rejects.toThrow('url lookup failed');

        expect(uploadState.deletions).toHaveLength(1);
        expect(uploadState.deletions[0]).toEqual(expect.objectContaining({ targetStorage: 'main-storage' }));
        expect(uploadState.deletions[0].fullPath).toMatch(/^profile-photos\/teams\/team-1\/team\/1700000000000_[a-f0-9]{32}_profile-photo\.png$/);
    });

    it.each([
        ['team', async (db) => db.uploadTeamPhoto({ name: 'team.jpg', size: 123, type: 'image/jpeg' }, { teamId: 'team-1' }), 'profile-photos/teams/team-1/team/'],
        ['player', async (db) => db.uploadPlayerPhoto({ name: 'player.jpg', size: 123, type: 'image/jpeg' }, { teamId: 'team-1', playerId: 'player-1' }), 'profile-photos/teams/team-1/players/player-1/'],
        ['user', async (db) => db.uploadUserPhoto({ name: 'user.jpg', size: 123, type: 'image/jpeg' }, 'user-42'), 'profile-photos/users/user-42/']
    ])('compensates a rejected %s photo upload at its precomputed browser path', async (_surface, upload, expectedPrefix) => {
        uploadState.rejectPrimaryUpload = true;
        const db = await import('../../js/db.js?v=4433173-rejected-profile-photo-upload');

        await expect(upload(db)).rejects.toThrow('upload response lost');

        expect(uploadState.deletions).toHaveLength(1);
        expect(uploadState.deletions[0]).toEqual(expect.objectContaining({ targetStorage: 'main-storage' }));
        expect(uploadState.deletions[0].fullPath).toMatch(new RegExp(`^${expectedPrefix}1700000000000_[a-f0-9]{32}_profile-photo\\.jpg$`));
    });

    it.each([
        ['chat attachment', async (db) => db.uploadChatImage('team-1', { name: 'photo.jpg', size: 123, type: 'image/jpeg' }), 'stat-sheets/team-chat/team-1/team/user-42/'],
        ['stat sheet', async (db) => db.uploadStatSheetPhoto('team-1', 'game-1', { name: 'sheet.jpg', size: 123, type: 'image/jpeg' }, { returnUpload: true }), 'stat-sheets/team-games/team-1/game-1/user-42/'],
        ['drill diagram', async (db) => db.uploadDrillDiagram('team-1', 'drill-1', { name: 'diagram.jpg', size: 123, type: 'image/jpeg' }, { returnUpload: true }), 'stat-sheets/drills/team-1/drill-1/user-42/'],
        ['game clip', async (db) => db.uploadGameClip('team-1', 'game-1', { name: 'clip.mp4', size: 123, type: 'video/mp4' }), 'game-clips/team-1/game-1/user-42/'],
        ['athlete media', async (db) => db.uploadAthleteProfileMedia('user-42', 'profile-1', { name: 'headshot.jpg', size: 123, type: 'image/jpeg' }, { kind: 'profile-photo' }), 'athlete-profile-media/user-42/profile-1/']
    ])('compensates a rejected %s upload at its reserved primary path', async (_surface, upload, expectedPrefix) => {
        uploadState.rejectPrimaryUpload = true;
        imageAuthMocks.requireImageAuth.mockRejectedValue(new Error('secondary unavailable'));
        const db = await import('../../js/db.js?v=4433173-rejected-media-upload');

        await expect(upload(db)).rejects.toThrow('upload response lost');

        expect(uploadState.deletions).toHaveLength(1);
        expect(uploadState.deletions[0]).toEqual(expect.objectContaining({ targetStorage: 'main-storage' }));
        expect(uploadState.deletions[0].fullPath).toContain(expectedPrefix);
    });

    it('does not let a failed same-millisecond upload delete a concurrent successful candidate', async () => {
        firebaseMocks.uploadBytes
            .mockImplementationOnce(async (storageRef, file) => {
                uploadState.calls.push({ targetStorage: storageRef.targetStorage, fullPath: storageRef.fullPath, file });
                return { ref: storageRef };
            })
            .mockImplementationOnce(async (storageRef, file) => {
                uploadState.calls.push({ targetStorage: storageRef.targetStorage, fullPath: storageRef.fullPath, file });
                throw new Error('upload response lost');
            });
        const { uploadTeamPhoto } = await import('../../js/db.js?v=4433173-concurrent-profile-photo-upload');
        const file = { name: 'team.jpg', size: 123, type: 'image/jpeg' };

        const [successful, failed] = await Promise.allSettled([
            uploadTeamPhoto(file, { teamId: 'team-1' }),
            uploadTeamPhoto(file, { teamId: 'team-1' })
        ]);

        expect(successful.status).toBe('fulfilled');
        expect(failed.status).toBe('rejected');
        expect(uploadState.calls[0].fullPath).not.toBe(uploadState.calls[1].fullPath);
        expect(uploadState.deletions).toEqual([
            expect.objectContaining({ fullPath: uploadState.calls[1].fullPath })
        ]);
        expect(uploadState.deletions[0].fullPath).not.toBe(uploadState.calls[0].fullPath);
    });

    it('rejects a browser team photo without a persisted team id before Storage', async () => {
        const { uploadTeamPhoto } = await import('../../js/db.js?v=4433173-scoped-fallback-uploads');

        await expect(uploadTeamPhoto({
            name: 'draft-team.png',
            size: 123,
            type: 'image/png'
        })).rejects.toThrow('Team is required for this profile photo upload.');

        expect(uploadState.calls).toHaveLength(0);
    });

    it('uses the signed-in primary Storage identity for browser own-profile photos', async () => {
        const { uploadUserPhoto } = await import('../../js/db.js?v=4433173-scoped-fallback-uploads');

        const uploaded = await uploadUserPhoto({
            name: 'Me.png',
            size: 123,
            type: 'image/png'
        }, 'user-42', { returnUpload: true });

        expect(uploaded.url).toBe(`https://cdn.example.test/${uploaded.path}`);
        expect(uploaded.path).toMatch(/^profile-photos\/users\/user-42\/1700000000000_[a-f0-9]{32}_profile-photo\.png$/);
        expect(imageAuthMocks.ensureImageAuth).not.toHaveBeenCalled();
        expect(uploadState.calls[0]).toEqual(expect.objectContaining({ targetStorage: 'main-storage' }));
    });

    it('rejects browser own-profile uploads for another account before Storage', async () => {
        const { uploadUserPhoto } = await import('../../js/db.js?v=4433173-scoped-fallback-uploads');

        await expect(uploadUserPhoto({ name: 'Me.png', type: 'image/png', size: 123 }, 'other-user'))
            .rejects.toThrow('signed-in account does not match');
        expect(uploadState.calls).toEqual([]);
    });

    it('uploads stat sheets exclusively to the primary game-scoped path', async () => {
        const { deleteUploadedMediaObjects, uploadStatSheetPhoto } = await import('../../js/db.js?v=4433173-scoped-fallback-uploads');

        const uploaded = await uploadStatSheetPhoto('team/alpha', 'game/beta', {
            name: 'box score (1).png',
            size: 123,
            type: 'image/png'
        }, { returnUpload: true });

        expect(imageAuthMocks.requireImageAuth).not.toHaveBeenCalled();
        expect(uploadState.calls).toHaveLength(1);
        expect(uploadState.calls[0].fullPath).toBe('stat-sheets/team-games/team_alpha/game_beta/user-42/1700000000000_00000000000000000000000000000001_box_score_1_.png');
        expect(uploaded).toEqual({
            url: 'https://cdn.example.test/stat-sheets/team-games/team_alpha/game_beta/user-42/1700000000000_00000000000000000000000000000001_box_score_1_.png',
            path: 'stat-sheets/team-games/team_alpha/game_beta/user-42/1700000000000_00000000000000000000000000000001_box_score_1_.png',
            storage: 'primary'
        });

        await deleteUploadedMediaObjects([uploaded]);
        expect(uploadState.deletions).toEqual(expect.arrayContaining([
            expect.objectContaining({
                targetStorage: 'main-storage',
                fullPath: uploaded.path
            })
        ]));
    });

    it('requires nonempty string team and game ids before starting a stat sheet upload', async () => {
        const { uploadStatSheetPhoto } = await import('../../js/db.js?v=4433173-scoped-fallback-uploads');
        const file = {
            name: 'box score.png',
            size: 123,
            type: 'image/png'
        };

        await expect(uploadStatSheetPhoto('', 'game/beta', file, { returnUpload: true }))
            .rejects.toThrow('Team-scoped stat sheet upload requires a team.');
        await expect(uploadStatSheetPhoto('team/alpha', '', file, { returnUpload: true }))
            .rejects.toThrow('Game-scoped stat sheet upload requires a game.');
        await expect(uploadStatSheetPhoto('team/alpha', file, { returnUpload: true }))
            .rejects.toThrow('Game-scoped stat sheet upload requires a game.');

        expect(uploadState.calls).toHaveLength(0);
    });

    it.each([
        ['a missing file', undefined, 'Stat sheet upload requires a file.'],
        ['a non-image MIME type', { name: 'box score.txt', size: 123, type: 'text/plain' }, 'Stat sheet upload requires an image file.'],
        ['an empty image', { name: 'box score.png', size: 0, type: 'image/png' }, 'Stat sheet upload requires a non-empty file.'],
        ['an oversized image', { name: 'box score.png', size: (20 * 1024 * 1024) + 1, type: 'image/png' }, 'Stat sheet upload cannot exceed 20 MB.']
    ])('rejects %s before creating a Storage reference', async (_label, file, expectedMessage) => {
        const { uploadStatSheetPhoto } = await import('../../js/db.js?v=4433173-scoped-fallback-uploads');

        await expect(uploadStatSheetPhoto('team/alpha', 'game/beta', file, { returnUpload: true }))
            .rejects.toThrow(expectedMessage);

        expect(firebaseMocks.ref).not.toHaveBeenCalled();
        expect(firebaseMocks.uploadBytes).not.toHaveBeenCalled();
    });

    it('falls back to a team-scoped drill path and deletes it from primary storage on rollback', async () => {
        const { deleteUploadedMediaObjects, uploadDrillDiagram } = await import('../../js/db.js?v=4433173-scoped-fallback-uploads');

        const uploaded = await uploadDrillDiagram('team/alpha', 'drill 7', {
            name: 'diagram #1.png',
            size: 456,
            type: 'image/png'
        }, { returnUpload: true });

        expect(uploadState.calls).toHaveLength(2);
        expect(uploadState.calls[1].fullPath).toBe('stat-sheets/drills/team_alpha/drill_7/user-42/1700000000000_00000000000000000000000000000001_diagram_1.png');
        expect(uploaded).toEqual({
            url: 'https://cdn.example.test/stat-sheets/drills/team_alpha/drill_7/user-42/1700000000000_00000000000000000000000000000001_diagram_1.png',
            path: 'stat-sheets/drills/team_alpha/drill_7/user-42/1700000000000_00000000000000000000000000000001_diagram_1.png',
            storage: 'primary'
        });

        await deleteUploadedMediaObjects([uploaded]);
        expect(uploadState.deletions).toEqual(expect.arrayContaining([
            expect.objectContaining({
                targetStorage: 'main-storage',
                fullPath: uploaded.path
            })
        ]));
    });

    it('deletes a drill diagram from image storage when that upload must be rolled back', async () => {
        firebaseMocks.uploadBytes.mockImplementationOnce(async (storageRef, file) => {
            uploadState.calls.push({ targetStorage: storageRef.targetStorage, fullPath: storageRef.fullPath, file });
            return { ref: storageRef };
        });
        const { deleteUploadedMediaObjects, uploadDrillDiagram } = await import('../../js/db.js?v=4433173-scoped-fallback-uploads');

        const uploaded = await uploadDrillDiagram('team/alpha', 'drill 7', {
            name: 'diagram.png',
            size: 456,
            type: 'image/png'
        }, { returnUpload: true });

        expect(uploaded).toEqual({
            url: 'https://cdn.example.test/drill-diagrams/drill_7/1700000000000_00000000000000000000000000000001_diagram.png',
            path: 'drill-diagrams/drill_7/1700000000000_00000000000000000000000000000001_diagram.png',
            storage: 'image'
        });

        await deleteUploadedMediaObjects([uploaded]);
        expect(uploadState.deletions).toEqual([
            expect.objectContaining({
                targetStorage: 'image-storage',
                fullPath: uploaded.path
            })
        ]);
    });

    it('falls back to primary drill storage when image-project authentication fails', async () => {
        imageAuthMocks.requireImageAuth.mockRejectedValueOnce(new Error('image auth unavailable'));
        const { uploadDrillDiagram } = await import('../../js/db.js?v=4433173-scoped-fallback-uploads');

        const uploaded = await uploadDrillDiagram('team/alpha', 'drill 7', {
            name: 'diagram.png',
            size: 456,
            type: 'image/png'
        }, { returnUpload: true });

        expect(uploadState.calls).toHaveLength(1);
        expect(uploadState.calls[0]).toEqual(expect.objectContaining({
            targetStorage: 'main-storage',
            fullPath: 'stat-sheets/drills/team_alpha/drill_7/user-42/1700000000000_00000000000000000000000000000001_diagram.png'
        }));
        expect(uploaded.storage).toBe('primary');
    });

    it('deletes a game clip from image storage when its game update fails', async () => {
        firebaseMocks.uploadBytes.mockImplementationOnce(async (storageRef, file) => {
            uploadState.calls.push({ targetStorage: storageRef.targetStorage, fullPath: storageRef.fullPath, file });
            return { ref: storageRef };
        });
        const { deleteUploadedMediaObjects, uploadGameClip } = await import('../../js/db.js?v=4433173-scoped-fallback-uploads');

        const uploaded = await uploadGameClip('team/alpha', 'game 7', {
            name: 'winning shot.mp4',
            size: 456,
            type: 'video/mp4'
        });

        expect(uploaded).toEqual(expect.objectContaining({
            path: 'team-videos/1700000000000_00000000000000000000000000000001_game-clip_team/alpha_game 7_winning_shot.mp4',
            storage: 'image'
        }));

        await deleteUploadedMediaObjects([uploaded]);
        expect(uploadState.deletions).toEqual([
            expect.objectContaining({
                targetStorage: 'image-storage',
                fullPath: uploaded.path
            })
        ]);
    });

    it('deletes a fallback game clip from primary storage when its game update fails', async () => {
        const { deleteUploadedMediaObjects, uploadGameClip } = await import('../../js/db.js?v=4433173-scoped-fallback-uploads');

        const uploaded = await uploadGameClip('team/alpha', 'game 7', {
            name: 'winning shot.mp4',
            size: 456,
            type: 'video/mp4'
        });

        expect(uploaded).toEqual(expect.objectContaining({
            path: 'game-clips/team_alpha/game_7/user-42/1700000000000_00000000000000000000000000000001_winning_shot.mp4',
            storage: 'primary'
        }));

        await deleteUploadedMediaObjects([uploaded]);
        expect(uploadState.deletions).toEqual(expect.arrayContaining([
            expect.objectContaining({
                targetStorage: 'main-storage',
                fullPath: uploaded.path
            })
        ]));
    });

    it('falls back to primary game-clip storage when image-project authentication fails', async () => {
        imageAuthMocks.requireImageAuth.mockRejectedValueOnce(new Error('image auth unavailable'));
        const { uploadGameClip } = await import('../../js/db.js?v=4433173-scoped-fallback-uploads');

        const uploaded = await uploadGameClip('team/alpha', 'game 7', {
            name: 'winning shot.mp4',
            size: 456,
            type: 'video/mp4'
        });

        expect(uploadState.calls).toHaveLength(1);
        expect(uploadState.calls[0]).toEqual(expect.objectContaining({
            targetStorage: 'main-storage',
            fullPath: 'game-clips/team_alpha/game_7/user-42/1700000000000_00000000000000000000000000000001_winning_shot.mp4'
        }));
        expect(uploaded.storage).toBe('primary');
    });
});
