import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbMocks = vi.hoisted(() => ({
    getAggregatedStatsForPlayer: vi.fn(),
    getGames: vi.fn(),
    getPlayerPrivateProfile: vi.fn(),
    getPlayerTrackingStatuses: vi.fn(),
    getPlayers: vi.fn(),
    getPublicTrackingItems: vi.fn(),
    getTeam: vi.fn(),
    inviteCoParentToAthlete: vi.fn(),
    listAthleteProfilesForParent: vi.fn(),
    listCertificatesForPlayer: vi.fn(),
    saveAthleteProfile: vi.fn(),
    updatePlayerProfile: vi.fn(),
    uploadPlayerPhoto: vi.fn()
}));

const scheduleMocks = vi.hoisted(() => ({
    loadParentSchedule: vi.fn()
}));

const profileStatMocks = vi.hoisted(() => ({
    collectPlayerVideoClips: vi.fn()
}));

const trackingMocks = vi.hoisted(() => ({
    getVisiblePlayerTrackingSummary: vi.fn()
}));

const incentiveMocks = vi.hoisted(() => ({
    calculateEarnings: vi.fn(),
    getApplicableRulesForGame: vi.fn(),
    getCapSetting: vi.fn(),
    getIncentiveRules: vi.fn(),
    getPaidGames: vi.fn(),
    getStatOptionsForTeam: vi.fn(),
    isCurrentRuleVersion: vi.fn(),
    markGamePaid: vi.fn(),
    retireIncentiveRule: vi.fn(),
    saveCapSetting: vi.fn(),
    saveIncentiveRule: vi.fn(),
    toggleIncentiveRule: vi.fn()
}));

vi.mock('../../js/db.js', () => dbMocks);
vi.mock('../../js/player-profile-stats.js', () => profileStatMocks);
vi.mock('../../js/player-tracking-summary.js', () => trackingMocks);
vi.mock('../../js/parent-incentives.js', () => incentiveMocks);
vi.mock('../../apps/app/src/lib/scheduleService.ts', () => scheduleMocks);

import {
    loadParentPlayerDetail,
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
    scheduleMocks.loadParentSchedule.mockResolvedValue({
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
    dbMocks.updatePlayerProfile.mockResolvedValue(undefined);
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
    it('loads a team-scoped linked player with schedule actions, stats, clips, certificates, and tracking', async () => {
        const detail = await loadParentPlayerDetail(user(), 'team-1', 'player-1');

        expect(scheduleMocks.loadParentSchedule).toHaveBeenCalledWith(expect.objectContaining({ uid: 'user-1' }));
        expect(dbMocks.getTeam).toHaveBeenCalledWith('team-1', { includeInactive: true });
        expect(dbMocks.getPlayers).toHaveBeenCalledWith('team-1', { includeInactive: true });
        expect(dbMocks.getGames).toHaveBeenCalledWith('team-1');
        expect(dbMocks.getAggregatedStatsForPlayer).toHaveBeenCalledWith('team-1', 'game-final', 'player-1');
        expect(dbMocks.getPlayerPrivateProfile).toHaveBeenCalledWith('team-1', 'player-1');
        expect(dbMocks.listCertificatesForPlayer).toHaveBeenCalledWith('team-1', 'player-1', { status: 'published', limit: 5 });
        expect(dbMocks.listAthleteProfilesForParent).toHaveBeenCalledWith('user-1');
        expect(incentiveMocks.getIncentiveRules).toHaveBeenCalledWith('user-1', 'player-1');
        expect(incentiveMocks.getPaidGames).toHaveBeenCalledWith('user-1', 'player-1');
        expect(incentiveMocks.getCapSetting).toHaveBeenCalledWith('user-1', 'player-1');
        expect(incentiveMocks.getStatOptionsForTeam).toHaveBeenCalledWith('team-1');
        expect(profileStatMocks.collectPlayerVideoClips).toHaveBeenCalledWith(expect.any(Array), {
            teamId: 'team-1',
            playerId: 'player-1'
        });
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
        expect(detail.clips).toHaveLength(1);
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
        expect(detail.athleteProfile).toMatchObject({
            profile: expect.objectContaining({ id: 'profile-1' }),
            shareUrl: 'https://allplays.ai/athlete-profile.html?profileId=profile-1'
        });
    });

    it('falls back to the legacy player-only route and blocks unlinked players', async () => {
        const legacyDetail = await loadParentPlayerDetail(user(), '', 'player-2');
        expect(legacyDetail.child).toMatchObject({ teamId: 'team-2', playerId: 'player-2' });

        await expect(loadParentPlayerDetail(user(), 'team-9', 'player-9')).rejects.toThrow('This player is not linked to your account.');
        await expect(loadParentPlayerDetail(null, 'team-1', 'player-1')).rejects.toThrow('signed-in user');
    });

    it('keeps the player page usable when optional profile data fails', async () => {
        dbMocks.getTeam.mockRejectedValue(new Error('team unavailable'));
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
