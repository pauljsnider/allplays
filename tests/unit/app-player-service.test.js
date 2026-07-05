import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbMocks = vi.hoisted(() => ({
    deleteAthleteProfileMediaByPath: vi.fn(),
    getAggregatedStatsForPlayer: vi.fn(),
    getGames: vi.fn(),
    getPlayerPrivateProfile: vi.fn(),
    getPlayerTrackingStatuses: vi.fn(),
    getPlayers: vi.fn(),
    getPublicTrackingItems: vi.fn(),
    getRosterFieldDefinitions: vi.fn(),
    getTeam: vi.fn(),
    inviteCoParentToAthlete: vi.fn(),
    listAthleteProfilesForParent: vi.fn(),
    listCertificatesForPlayer: vi.fn(),
    saveAthleteProfile: vi.fn(),
    setPlayerPrivateRosterProfileFields: vi.fn(),
    updatePlayer: vi.fn(),
    updatePlayerProfile: vi.fn(),
    uploadAthleteProfileMedia: vi.fn(),
    uploadPlayerPhoto: vi.fn()
}));

const scheduleMocks = vi.hoisted(() => ({
    loadParentPlayerSchedule: vi.fn()
}));

const playerProfileMocks = vi.hoisted(() => ({
    buildAthleteProfileShareUrl: vi.fn(() => 'https://allplays.ai/athlete-profile.html?profileId=profile-1'),
    calculateEarnings: vi.fn(),
    collectPlayerVideoClips: vi.fn(),
    getApplicableRulesForGame: vi.fn(),
    getCapSetting: vi.fn(),
    getIncentiveRules: vi.fn(),
    getPaidGames: vi.fn(),
    getStatOptionsForTeam: vi.fn(),
    getVisiblePlayerTrackingSummary: vi.fn(),
    isCurrentRuleVersion: vi.fn(),
    markGamePaid: vi.fn(),
    retireIncentiveRule: vi.fn(),
    saveCapSetting: vi.fn(),
    saveIncentiveRule: vi.fn(),
    toggleIncentiveRule: vi.fn()
}));

const rosterPrivacyMocks = vi.hoisted(() => ({
    canViewRosterField: vi.fn(() => true),
    getRosterProfileValues: vi.fn(() => ({})),
    normalizeRosterFieldDefinitions: vi.fn(() => []),
    splitRosterProfileValuesByVisibility: vi.fn(() => ({ publicValues: {}, privateValues: {} })),
    validateRosterProfileValues: vi.fn(() => [])
}));

const profileStatMocks = playerProfileMocks;
const trackingMocks = playerProfileMocks;
const incentiveMocks = playerProfileMocks;

vi.mock('../../apps/app/src/lib/adapters/legacyPlayerDb', () => dbMocks);
vi.mock('../../apps/app/src/lib/adapters/legacyPlayerProfile', () => playerProfileMocks);
vi.mock('../../apps/app/src/lib/adapters/legacyRosterPrivacy', () => rosterPrivacyMocks);
vi.mock('../../apps/app/src/lib/scheduleService.ts', () => scheduleMocks);

import {
    loadParentPlayerDetail,
    loadParentPlayerVideoClips,
    normalizeAthleteProfileHighlightClipUrl,
    saveParentAthleteProfileDraft,
    saveParentPlayerIncentiveRule,
    sendParentCoParentInvite,
    updateParentPlayerEditableProfile
} from '../../apps/app/src/lib/playerService.ts';

function event(overrides = {}) {
    const teamId = overrides.teamId || 'team-1';
    const id = overrides.id || 'game-1';
    const childId = overrides.childId || 'player-1';
    return {
        eventKey: overrides.eventKey || `${teamId}::${id}::${childId}`,
        id,
        teamId,
        teamName: overrides.teamName || 'Bears',
        type: overrides.type || 'game',
        date: overrides.date || new Date('2100-06-01T18:00:00Z'),
        location: overrides.location || 'Main Gym',
        opponent: overrides.opponent || 'Falcons',
        title: overrides.title || null,
        childId,
        childName: overrides.childName || 'Pat',
        isDbGame: overrides.isDbGame !== false,
        isCancelled: overrides.isCancelled === true,
        status: overrides.status || 'scheduled',
        liveStatus: overrides.liveStatus || null,
        myRsvp: overrides.myRsvp || 'not_responded',
        assignments: overrides.assignments || [],
        ...overrides
    };
}

function user() {
    return {
        uid: 'user-1',
        email: 'parent@example.com',
        displayName: 'Pat Parent',
        roles: ['parent'],
        parentOf: [
            { teamId: 'team-1', playerId: 'player-1', playerName: 'Pat', teamName: 'Bears' }
        ]
    };
}

beforeEach(() => {
    vi.clearAllMocks();
    scheduleMocks.loadParentPlayerSchedule.mockResolvedValue({
        children: [
            { teamId: 'team-1', teamName: 'Bears', playerId: 'player-1', playerName: 'Pat' },
            { teamId: 'team-2', teamName: 'Thunder', playerId: 'player-2', playerName: 'Sam' }
        ],
        events: [
            event({ id: 'game-next', date: new Date('2100-06-01T18:00:00Z') }),
            event({
                id: 'practice-1',
                type: 'practice',
                title: 'Practice',
                myRsvp: 'going',
                date: new Date('2100-06-02T19:00:00Z'),
                practiceHomePacketSummary: '2 drills · 20 min'
            }),
            event({
                id: 'game-task',
                myRsvp: 'going',
                date: new Date('2100-06-03T18:00:00Z'),
                assignments: [{ role: 'Snacks', value: '', claimable: true, claim: null }]
            }),
            event({
                id: 'game-final',
                status: 'completed',
                liveStatus: 'completed',
                myRsvp: 'going',
                date: new Date('2000-06-01T18:00:00Z')
            }),
            event({
                id: 'other-player',
                teamId: 'team-2',
                teamName: 'Thunder',
                childId: 'player-2',
                childName: 'Sam',
                date: new Date('2100-06-04T18:00:00Z')
            })
        ]
    });
    dbMocks.getTeam.mockResolvedValue({ id: 'team-1', name: 'Bears', sport: 'basketball' });
    dbMocks.getPlayers.mockResolvedValue([
        { id: 'player-1', name: 'Pat Star', number: '9', photoUrl: 'https://example.test/pat.jpg' }
    ]);
    dbMocks.getGames.mockResolvedValue([{ id: 'game-final', clips: [] }]);
    dbMocks.getAggregatedStatsForPlayer.mockResolvedValue({ pts: 12, reb: 4 });
    dbMocks.getPlayerPrivateProfile.mockResolvedValue({
        emergencyContact: { name: 'Jamie Parent', phone: '555-0100' },
        medicalInfo: 'Peanut allergy'
    });
    dbMocks.getRosterFieldDefinitions.mockResolvedValue([]);
    dbMocks.listCertificatesForPlayer.mockResolvedValue([{ id: 'cert-1', title: 'Hustle Award' }]);
    dbMocks.listAthleteProfilesForParent.mockResolvedValue([{
        id: 'profile-1',
        athlete: { name: 'Pat Star', headline: '2028 Guard' },
        bio: { position: 'Guard' },
        privacy: 'public',
        seasons: [{ teamId: 'team-1', playerId: 'player-1' }]
    }]);
    dbMocks.inviteCoParentToAthlete.mockResolvedValue({ id: 'invite-1', code: 'ABC12345', teamName: 'Bears', playerName: 'Pat Star', existingUser: false });
    dbMocks.saveAthleteProfile.mockResolvedValue({ id: 'profile-1', athlete: { name: 'Pat Star' }, privacy: 'public' });
    dbMocks.deleteAthleteProfileMediaByPath.mockResolvedValue(undefined);
    dbMocks.updatePlayerProfile.mockResolvedValue(undefined);
    dbMocks.uploadAthleteProfileMedia.mockImplementation(async (userId, profileId, file, options = {}) => {
        const kind = options.kind === 'profile-photo' ? 'profile-photo' : 'clip';
        const mediaType = String(file.type || '').startsWith('video/') ? 'video' : 'image';
        return {
            url: `https://example.test/${file.name}`,
            storagePath: `athlete-profile-media/${userId}/${profileId}/${file.name}`,
            mimeType: file.type,
            sizeBytes: file.size,
            uploadedAtMs: 1234,
            mediaType: kind === 'profile-photo' ? 'image' : mediaType
        };
    });
    dbMocks.uploadPlayerPhoto.mockResolvedValue('https://example.test/new-photo.jpg');
    dbMocks.getPublicTrackingItems.mockResolvedValue([{ id: 'item-1', title: 'Bring ball' }]);
    dbMocks.getPlayerTrackingStatuses.mockResolvedValue([{ playerId: 'player-1', itemId: 'item-1', status: 'complete' }]);
    profileStatMocks.collectPlayerVideoClips.mockReturnValue([{ title: 'Fast break', url: 'https://video.example.test/clip', gameLabel: 'vs. Falcons' }]);
    trackingMocks.getVisiblePlayerTrackingSummary.mockReturnValue([{ playerId: 'player-1', items: [{ id: 'item-1', title: 'Bring ball', isComplete: true }] }]);
    incentiveMocks.getIncentiveRules.mockResolvedValue([{ id: 'rule-1', statKey: 'pts', type: 'per_unit', amountCents: 100, active: true }]);
    incentiveMocks.getPaidGames.mockResolvedValue(new Map([['game-final', { amountCents: 1200 }]]));
    incentiveMocks.getCapSetting.mockResolvedValue(2500);
    incentiveMocks.getStatOptionsForTeam.mockResolvedValue([{ key: 'pts', label: 'PTS' }, { key: 'reb', label: 'REB' }]);
    incentiveMocks.getApplicableRulesForGame.mockImplementation((rules) => rules);
    incentiveMocks.calculateEarnings.mockReturnValue({
        totalCents: 1200,
        uncappedTotalCents: 1200,
        wasCapped: false,
        breakdown: [{ rule: { statKey: 'pts' }, statValue: 12, earned: 1200 }]
    });
    incentiveMocks.isCurrentRuleVersion.mockImplementation((rule) => !rule.effectiveTo);
    incentiveMocks.saveIncentiveRule.mockResolvedValue('rule-2');
    incentiveMocks.toggleIncentiveRule.mockResolvedValue('rule-3');
    incentiveMocks.retireIncentiveRule.mockResolvedValue(undefined);
    incentiveMocks.saveCapSetting.mockResolvedValue(undefined);
    incentiveMocks.markGamePaid.mockResolvedValue(undefined);
});

describe('React app parent player detail service', () => {
    it('loads a team-scoped linked player with schedule actions, stats, certificates, and tracking without eager clips', async () => {
        const detail = await loadParentPlayerDetail(user(), 'team-1', 'player-1');

        expect(scheduleMocks.loadParentPlayerSchedule).toHaveBeenCalledWith(expect.objectContaining({ uid: 'user-1' }), {
            teamId: 'team-1',
            playerId: 'player-1'
        });
        expect(dbMocks.getTeam).toHaveBeenCalledWith('team-1', { includeInactive: true });
        expect(dbMocks.getPlayers).toHaveBeenCalledWith('team-1', { includeInactive: true });
        expect(dbMocks.getGames).not.toHaveBeenCalled();
        expect(dbMocks.getAggregatedStatsForPlayer).toHaveBeenCalledWith('team-1', 'game-final', 'player-1');
        expect(dbMocks.getPlayerPrivateProfile).toHaveBeenCalledWith('team-1', 'player-1');
        expect(dbMocks.listCertificatesForPlayer).toHaveBeenCalledWith('team-1', 'player-1', { status: 'published', limit: 5 });
        expect(dbMocks.listAthleteProfilesForParent).not.toHaveBeenCalled();
        expect(incentiveMocks.getIncentiveRules).toHaveBeenCalledWith('user-1', 'player-1');
        expect(incentiveMocks.getPaidGames).toHaveBeenCalledWith('user-1', 'player-1');
        expect(incentiveMocks.getCapSetting).toHaveBeenCalledWith('user-1', 'player-1');
        expect(incentiveMocks.getStatOptionsForTeam).toHaveBeenCalledWith('team-1');
        expect(profileStatMocks.collectPlayerVideoClips).not.toHaveBeenCalled();
        expect(trackingMocks.getVisiblePlayerTrackingSummary).toHaveBeenCalledWith({
            items: [{ id: 'item-1', title: 'Bring ball' }],
            statuses: [{ playerId: 'player-1', itemId: 'item-1', status: 'complete' }],
            playerIds: ['player-1']
        });

        expect(detail.child).toMatchObject({ teamId: 'team-1', playerId: 'player-1' });
        expect(detail.player).toMatchObject({
            id: 'player-1',
            name: 'Pat Star',
            number: '9',
            teamName: 'Bears'
        });
        expect(detail.events.map((item) => item.id)).toEqual(['game-final', 'game-next', 'practice-1', 'game-task']);
        expect(detail.nextEvent?.id).toBe('game-next');
        expect(detail.actionCounts).toEqual({
            rsvpNeeded: 1,
            packetsReady: 1,
            openAssignments: 1
        });
        expect(detail.statRows).toHaveLength(1);
        expect(detail.statRows[0]).toMatchObject({
            event: expect.objectContaining({ id: 'game-final' }),
            stats: { pts: 12, reb: 4 }
        });
        expect(detail.clips).toEqual([]);
        expect(detail.certificates).toEqual([{ id: 'cert-1', title: 'Hustle Award' }]);
        expect(detail.trackingSummary).toEqual([{ playerId: 'player-1', items: [{ id: 'item-1', title: 'Bring ball', isComplete: true }] }]);
        expect(detail.privateProfile).toEqual({
            emergencyContact: { name: 'Jamie Parent', phone: '555-0100' },
            medicalInfo: 'Peanut allergy'
        });
        expect(detail.incentives).toMatchObject({
            totalEarnedCents: 1200,
            totalPaidCents: 1200,
            unpaidCents: 0,
            maxPerGameCents: 2500
        });
        expect(detail.incentives.currentRules).toHaveLength(1);
        expect(detail.athleteProfile).toEqual({
            profile: null,
            shareUrl: '',
            builderUrl: 'https://allplays.ai/athlete-profile-builder.html?teamId=team-1&playerId=player-1',
            seasonOptions: [
                {
                    seasonKey: 'team-1::player-1',
                    teamId: 'team-1',
                    teamName: 'Bears',
                    playerId: 'player-1',
                    playerName: 'Pat'
                }
            ]
        });

        const clips = await loadParentPlayerVideoClips(user(), 'team-1', 'player-1');
        expect(dbMocks.getGames).toHaveBeenCalledWith('team-1');
        expect(profileStatMocks.collectPlayerVideoClips).toHaveBeenCalledWith([{ id: 'game-final', clips: [] }], {
            teamId: 'team-1',
            playerId: 'player-1'
        });
        expect(clips).toEqual([{ title: 'Fast break', url: 'https://video.example.test/clip', gameLabel: 'vs. Falcons' }]);
    });

    it('falls back to the legacy player-only route and blocks unlinked players', async () => {
        const legacyDetail = await loadParentPlayerDetail(user(), '', 'player-2');
        expect(scheduleMocks.loadParentPlayerSchedule).toHaveBeenCalledWith(expect.objectContaining({ uid: 'user-1' }), {
            teamId: '',
            playerId: 'player-2'
        });
        expect(legacyDetail.child).toMatchObject({ teamId: 'team-2', playerId: 'player-2' });

        await expect(loadParentPlayerDetail(user(), 'team-9', 'player-9')).rejects.toThrow('This player is not linked to your account.');
        await expect(loadParentPlayerDetail(null, 'team-1', 'player-1')).rejects.toThrow('signed-in user');
    });

    it('ignores off-team schedule rows when computing player detail data', async () => {
        scheduleMocks.loadParentPlayerSchedule.mockResolvedValueOnce({
            children: [
                { teamId: 'team-1', teamName: 'Bears', playerId: 'player-1', playerName: 'Pat' },
                { teamId: 'team-2', teamName: 'Thunder', playerId: 'player-2', playerName: 'Sam' }
            ],
            events: [
                event({ id: 'game-next', teamId: 'team-1', childId: 'player-1', date: new Date('2100-06-01T18:00:00Z') }),
                event({ id: 'game-final', teamId: 'team-1', childId: 'player-1', status: 'completed', liveStatus: 'completed', myRsvp: 'going', date: new Date('2000-06-01T18:00:00Z') }),
                event({ id: 'other-team-game', teamId: 'team-2', teamName: 'Thunder', childId: 'player-2', childName: 'Sam', date: new Date('2100-06-03T18:00:00Z') })
            ]
        });

        const detail = await loadParentPlayerDetail(user(), 'team-1', 'player-1');

        expect(detail.events.map((item) => item.id)).toEqual(['game-final', 'game-next']);
        expect(detail.nextEvent?.id).toBe('game-next');
        expect(dbMocks.getAggregatedStatsForPlayer).toHaveBeenCalledTimes(1);
        expect(dbMocks.getAggregatedStatsForPlayer).toHaveBeenCalledWith('team-1', 'game-final', 'player-1');
    });

    it('keeps the player page usable when optional profile data fails', async () => {
        dbMocks.getTeam.mockResolvedValue(null);
        dbMocks.getPlayers.mockRejectedValue(new Error('players unavailable'));
        dbMocks.getGames.mockRejectedValue(new Error('games unavailable'));
        dbMocks.getAggregatedStatsForPlayer.mockRejectedValue(new Error('stats unavailable'));
        dbMocks.getPlayerPrivateProfile.mockRejectedValue(new Error('private unavailable'));
        dbMocks.listCertificatesForPlayer.mockRejectedValue(new Error('certificates unavailable'));
        dbMocks.listAthleteProfilesForParent.mockRejectedValue(new Error('profiles unavailable'));
        dbMocks.getPublicTrackingItems.mockRejectedValue(new Error('tracking items unavailable'));
        dbMocks.getPlayerTrackingStatuses.mockRejectedValue(new Error('tracking statuses unavailable'));
        incentiveMocks.getIncentiveRules.mockRejectedValue(new Error('rules unavailable'));
        incentiveMocks.getPaidGames.mockRejectedValue(new Error('paid unavailable'));
        incentiveMocks.getCapSetting.mockRejectedValue(new Error('cap unavailable'));
        incentiveMocks.getStatOptionsForTeam.mockRejectedValue(new Error('stats unavailable'));
        profileStatMocks.collectPlayerVideoClips.mockReturnValue([]);
        trackingMocks.getVisiblePlayerTrackingSummary.mockReturnValue([]);

        const detail = await loadParentPlayerDetail(user(), 'team-1', 'player-1');

        expect(detail.team).toBeNull();
        expect(detail.player).toMatchObject({
            id: 'player-1',
            name: 'Pat',
            teamName: 'Bears'
        });
        expect(detail.statRows[0]).toMatchObject({
            event: expect.objectContaining({ id: 'game-final' }),
            stats: {}
        });
        expect(detail.clips).toEqual([]);
        expect(detail.certificates).toEqual([]);
        expect(detail.trackingSummary).toEqual([]);
        expect(detail.privateProfile).toBeNull();
        expect(detail.incentives.currentRules).toEqual([]);
        expect(detail.athleteProfile.profile).toBeNull();
    });

    it('saves parent-editable player fields through the restricted profile helper', async () => {
        const file = new File(['avatar'], 'avatar.png', { type: 'image/png' });

        await updateParentPlayerEditableProfile({
            user: user(),
            teamId: 'team-1',
            playerId: 'player-1',
            emergencyContactName: 'Alex Parent',
            emergencyContactPhone: '555-0199',
            medicalInfo: 'Inhaler',
            photoFile: file
        });

        expect(dbMocks.uploadPlayerPhoto).toHaveBeenCalledWith(file);
        expect(dbMocks.updatePlayerProfile).toHaveBeenCalledWith('team-1', 'player-1', {
            emergencyContact: { name: 'Alex Parent', phone: '555-0199' },
            medicalInfo: 'Inhaler',
            photoUrl: 'https://example.test/new-photo.jpg'
        });
    });

    it('uses the legacy co-parent and athlete profile contracts from the app player page', async () => {
        const invite = await sendParentCoParentInvite({
            user: user(),
            teamId: 'team-1',
            playerId: 'player-1',
            playerName: 'Pat Star',
            email: 'coparent@example.com'
        });

        expect(invite.code).toBe('ABC12345');
        expect(dbMocks.inviteCoParentToAthlete).toHaveBeenCalledWith('user-1', 'team-1', 'player-1', 'coparent@example.com', 'Pat Star');

        const savedProfile = await saveParentAthleteProfileDraft({
            user: user(),
            teamId: 'team-1',
            playerId: 'player-1',
            profileId: 'profile-1',
            draft: {
                athlete: { name: 'Pat Star', headline: '2028 Guard' },
                bio: { position: 'Guard' },
                privacy: 'public',
                clips: []
            }
        });

        expect(dbMocks.saveAthleteProfile).toHaveBeenCalledWith('user-1', {
            athlete: { name: 'Pat Star', headline: '2028 Guard' },
            bio: { position: 'Guard' },
            privacy: 'public',
            clips: [],
            selectedSeasonKeys: ['team-1::player-1']
        }, { profileId: 'profile-1' });
        expect(savedProfile.shareUrl).toBe('https://allplays.ai/athlete-profile.html?profileId=profile-1');
    });

    it('uploads athlete profile headshots before saving and supports linked-photo reset', async () => {
        const file = new File(['headshot'], 'headshot.jpg', { type: 'image/jpeg' });

        await saveParentAthleteProfileDraft({
            user: user(),
            teamId: 'team-1',
            playerId: 'player-1',
            profileId: 'profile-1',
            profilePhotoFile: file,
            draft: {
                athlete: { name: 'Pat Star' },
                bio: {},
                privacy: 'public',
                clips: [],
                profilePhoto: { url: 'https://example.test/old.jpg' }
            }
        });

        expect(dbMocks.uploadAthleteProfileMedia).toHaveBeenCalledWith('user-1', 'profile-1', file, { kind: 'profile-photo' });
        expect(dbMocks.saveAthleteProfile).toHaveBeenLastCalledWith('user-1', expect.objectContaining({
            profilePhoto: expect.objectContaining({ url: 'https://example.test/headshot.jpg' }),
            selectedSeasonKeys: ['team-1::player-1']
        }), { profileId: 'profile-1' });

        await saveParentAthleteProfileDraft({
            user: user(),
            teamId: 'team-1',
            playerId: 'player-1',
            profileId: 'profile-1',
            resetProfilePhoto: true,
            draft: {
                athlete: { name: 'Pat Star' },
                bio: {},
                privacy: 'public',
                clips: [],
                profilePhoto: { url: 'https://example.test/old.jpg' }
            }
        });

        expect(dbMocks.saveAthleteProfile).toHaveBeenLastCalledWith('user-1', expect.objectContaining({
            profilePhoto: null,
            selectedSeasonKeys: ['team-1::player-1']
        }), { profileId: 'profile-1' });
    });

    it('rejects invalid athlete profile headshots before upload', async () => {
        const file = new File(['not image'], 'headshot.txt', { type: 'text/plain' });

        await expect(saveParentAthleteProfileDraft({
            user: user(),
            teamId: 'team-1',
            playerId: 'player-1',
            profileId: 'profile-1',
            profilePhotoFile: file,
            draft: {
                athlete: { name: 'Pat Star' },
                bio: {},
                privacy: 'public',
                clips: []
            }
        })).rejects.toThrow('Player photos must be image files.');

        expect(dbMocks.uploadAthleteProfileMedia).not.toHaveBeenCalled();
        expect(dbMocks.saveAthleteProfile).not.toHaveBeenCalled();
    });

    it('cleans up uploaded athlete profile headshots when saving the profile fails', async () => {
        const file = new File(['headshot'], 'headshot.jpg', { type: 'image/jpeg' });
        dbMocks.saveAthleteProfile.mockRejectedValueOnce(new Error('profile save failed'));

        await expect(saveParentAthleteProfileDraft({
            user: user(),
            teamId: 'team-1',
            playerId: 'player-1',
            profileId: 'profile-1',
            profilePhotoFile: file,
            draft: {
                athlete: { name: 'Pat Star' },
                bio: {},
                privacy: 'public',
                clips: []
            }
        })).rejects.toThrow('profile save failed');

        expect(dbMocks.uploadAthleteProfileMedia).toHaveBeenCalledWith('user-1', 'profile-1', file, { kind: 'profile-photo' });
        expect(dbMocks.deleteAthleteProfileMediaByPath).toHaveBeenCalledWith('athlete-profile-media/user-1/profile-1/headshot.jpg');
    });

    it('uploads a manual athlete profile highlight clip and preserves existing clips', async () => {
        const clip = new File(['clip-bytes'], 'game-winner.mp4', { type: 'video/mp4' });
        const existingClip = { id: 'clip-old', source: 'upload', title: 'Old clip', url: 'https://example.test/old.mp4' };

        await saveParentAthleteProfileDraft({
            user: user(),
            teamId: 'team-1',
            playerId: 'player-1',
            profileId: 'profile-1',
            highlightClipFile: clip,
            draft: {
                athlete: { name: 'Pat Star' },
                bio: {},
                privacy: 'public',
                clips: [existingClip]
            }
        });

        expect(dbMocks.uploadAthleteProfileMedia).toHaveBeenCalledWith('user-1', 'profile-1', clip, { kind: 'clip' });
        expect(dbMocks.saveAthleteProfile).toHaveBeenLastCalledWith('user-1', expect.objectContaining({
            clips: [
                expect.objectContaining({
                    id: 'clip-old',
                    source: 'upload',
                    title: 'Old clip',
                    url: 'https://example.test/old.mp4'
                }),
                expect.objectContaining({
                    source: 'upload',
                    mediaType: 'video',
                    title: 'game-winner',
                    url: 'https://example.test/game-winner.mp4',
                    storagePath: 'athlete-profile-media/user-1/profile-1/game-winner.mp4',
                    mimeType: 'video/mp4'
                })
            ],
            selectedSeasonKeys: ['team-1::player-1']
        }), { profileId: 'profile-1' });
    });

    it('saves ordered athlete profile clip links and matched uploads in the legacy draft shape', async () => {
        const clip = new File(['clip-bytes'], 'putback.mp4', { type: 'video/mp4' });

        await saveParentAthleteProfileDraft({
            user: user(),
            teamId: 'team-1',
            playerId: 'player-1',
            profileId: 'profile-1',
            draft: {
                athlete: { name: 'Pat Star' },
                bio: {},
                privacy: 'private',
                clips: [
                    {
                        id: 'clip-youtube',
                        source: 'external',
                        mediaType: 'link',
                        title: 'Corner three',
                        label: 'Semifinal',
                        url: ' https://www.youtube.com/watch?v=LJNfHqRRhBI&t=30s '
                    },
                    {
                        id: 'clip-upload-new',
                        source: 'upload',
                        mediaType: 'video',
                        title: 'Putback',
                        label: 'Finals',
                        pendingUpload: true
                    },
                    {
                        id: 'clip-kept',
                        source: 'upload',
                        mediaType: 'video',
                        title: 'Existing kept clip',
                        url: 'https://example.test/kept.mp4',
                        storagePath: 'athlete-profile-media/user-1/profile-1/kept.mp4',
                        mimeType: 'video/mp4',
                        sizeBytes: 2048,
                        uploadedAtMs: 100
                    }
                ]
            },
            highlightClipUploads: [{ id: 'clip-upload-new', file: clip, title: 'Putback', label: 'Finals' }]
        });

        expect(dbMocks.uploadAthleteProfileMedia).toHaveBeenCalledWith('user-1', 'profile-1', clip, { kind: 'clip' });
        expect(dbMocks.saveAthleteProfile).toHaveBeenLastCalledWith('user-1', expect.objectContaining({
            clips: [
                {
                    id: 'clip-youtube',
                    source: 'external',
                    mediaType: 'link',
                    title: 'Corner three',
                    label: 'Semifinal',
                    url: 'https://www.youtube.com/watch?v=LJNfHqRRhBI&t=30s',
                    storagePath: '',
                    mimeType: '',
                    sizeBytes: null,
                    uploadedAtMs: null
                },
                {
                    id: 'clip-upload-new',
                    source: 'upload',
                    mediaType: 'video',
                    title: 'Putback',
                    label: 'Finals',
                    url: 'https://example.test/putback.mp4',
                    storagePath: 'athlete-profile-media/user-1/profile-1/putback.mp4',
                    mimeType: 'video/mp4',
                    sizeBytes: clip.size,
                    uploadedAtMs: 1234
                },
                {
                    id: 'clip-kept',
                    source: 'upload',
                    mediaType: 'video',
                    title: 'Existing kept clip',
                    label: '',
                    url: 'https://example.test/kept.mp4',
                    storagePath: 'athlete-profile-media/user-1/profile-1/kept.mp4',
                    mimeType: 'video/mp4',
                    sizeBytes: 2048,
                    uploadedAtMs: 100
                }
            ],
            selectedSeasonKeys: ['team-1::player-1']
        }), { profileId: 'profile-1' });
    });

    it('validates athlete profile external clip links before saving', async () => {
        expect(normalizeAthleteProfileHighlightClipUrl(' https://youtu.be/LJNfHqRRhBI ')).toBe('https://youtu.be/LJNfHqRRhBI');
        expect(normalizeAthleteProfileHighlightClipUrl('https://www.youtube.com/watch?v=LJNfHqRRhBI&t=30s')).toBe('https://www.youtube.com/watch?v=LJNfHqRRhBI&t=30s');
        expect(normalizeAthleteProfileHighlightClipUrl('https://www.hudl.com/video/3/123')).toBe('https://www.hudl.com/video/3/123');
        expect(() => normalizeAthleteProfileHighlightClipUrl('javascript:alert(1)')).toThrow('http or https');
        expect(() => normalizeAthleteProfileHighlightClipUrl('not a url')).toThrow('valid highlight clip link');

        await expect(saveParentAthleteProfileDraft({
            user: user(),
            teamId: 'team-1',
            playerId: 'player-1',
            profileId: 'profile-1',
            draft: {
                athlete: { name: 'Pat Star' },
                bio: {},
                privacy: 'private',
                clips: [{ id: 'clip-bad', source: 'external', url: 'ftp://video.example/clip.mp4' }]
            }
        })).rejects.toThrow('http or https');

        expect(dbMocks.uploadAthleteProfileMedia).not.toHaveBeenCalled();
        expect(dbMocks.saveAthleteProfile).not.toHaveBeenCalled();
    });

    it('rejects invalid athlete profile highlight clips before saving', async () => {
        const clip = new File(['not-media'], 'notes.txt', { type: 'text/plain' });

        await expect(saveParentAthleteProfileDraft({
            user: user(),
            teamId: 'team-1',
            playerId: 'player-1',
            profileId: 'profile-1',
            highlightClipFile: clip,
            draft: {
                athlete: { name: 'Pat Star' },
                bio: {},
                privacy: 'public',
                clips: []
            }
        })).rejects.toThrow('Highlight clips must be image or video files.');

        expect(dbMocks.uploadAthleteProfileMedia).not.toHaveBeenCalled();
        expect(dbMocks.saveAthleteProfile).not.toHaveBeenCalled();
    });

    it('cleans up uploaded athlete profile highlight clips when saving the profile fails', async () => {
        const clip = new File(['clip-bytes'], 'layup.png', { type: 'image/png' });
        dbMocks.saveAthleteProfile.mockRejectedValueOnce(new Error('profile save failed'));

        await expect(saveParentAthleteProfileDraft({
            user: user(),
            teamId: 'team-1',
            playerId: 'player-1',
            profileId: 'profile-1',
            highlightClipFile: clip,
            draft: {
                athlete: { name: 'Pat Star' },
                bio: {},
                privacy: 'public',
                clips: []
            }
        })).rejects.toThrow('profile save failed');

        expect(dbMocks.uploadAthleteProfileMedia).toHaveBeenCalledWith('user-1', 'profile-1', clip, { kind: 'clip' });
        expect(dbMocks.deleteAthleteProfileMediaByPath).toHaveBeenCalledWith('athlete-profile-media/user-1/profile-1/layup.png');
    });

    it('saves incentive rules under the parent account', async () => {
        await saveParentPlayerIncentiveRule({
            user: user(),
            teamId: 'team-1',
            playerId: 'player-1',
            playerName: 'Pat Star',
            rule: {
                statKey: 'pts',
                type: 'per_unit',
                amountCents: 100,
                active: true
            }
        });

        expect(incentiveMocks.saveIncentiveRule).toHaveBeenCalledWith('user-1', {
            teamId: 'team-1',
            playerId: 'player-1',
            playerName: 'Pat Star',
            statKey: 'pts',
            type: 'per_unit',
            amountCents: 100,
            threshold: null,
            thresholdOp: null,
            active: true
        });
    });
});
