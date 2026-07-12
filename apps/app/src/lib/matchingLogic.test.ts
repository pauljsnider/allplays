import { describe, expect, it } from 'vitest';
import type { ParentHomeModel } from './homeLogic';
import {
  buildMatchingDetails,
  buildMatchingSummary,
  buildMatchingTitle,
  clampMatchingExpiryDays,
  containsContactInfo,
  emptyMatchingFilters,
  filterMatchingPosts,
  getMatchingExpiryDate,
  getMatchingKindLabel,
  isMatchingPostKind,
  isMatchingPostOpen,
  MATCHING_DEFAULT_EXPIRY_DAYS,
  MATCHING_MAX_EXPIRY_DAYS,
  matchingPostToFeedItem,
  normalizeMatchingPost,
  selectRelevantMatchingPosts,
  type MatchingPost,
  type MatchingPostDraft
} from './matchingLogic';

const now = new Date('2026-07-11T12:00:00.000Z');

function playerDraft(overrides: Partial<MatchingPostDraft> = {}): MatchingPostDraft {
  return {
    kind: 'player_seeking_team',
    sport: 'Soccer',
    ageGroup: 'U12',
    city: 'Columbus',
    state: 'oh',
    playerFirstName: 'Ethan',
    ...overrides
  };
}

function teamDraft(overrides: Partial<MatchingPostDraft> = {}): MatchingPostDraft {
  return {
    kind: 'team_seeking_players',
    sport: 'Basketball',
    ageGroup: 'U14',
    zip: '43004',
    teamId: 'team-1',
    teamName: 'Rockets',
    ...overrides
  };
}

function post(overrides: Partial<MatchingPost> = {}): MatchingPost {
  return {
    id: 'post-1',
    kind: 'player_seeking_team',
    status: 'open',
    authorId: 'parent-1',
    authorName: 'Parent One',
    authorPhotoUrl: null,
    teamId: null,
    teamName: null,
    title: 'Ethan (U12 Soccer) is looking for a team',
    description: '',
    matching: {
      kind: 'player_seeking_team',
      sport: 'Soccer',
      ageGroup: 'U12',
      city: 'Columbus',
      state: 'OH',
      zip: '',
      positions: '',
      level: '',
      timeframe: '',
      openSpots: null,
      playerFirstName: 'Ethan',
      signupUrl: ''
    },
    createdAt: new Date('2026-07-01T12:00:00.000Z'),
    expiresAt: new Date('2026-08-30T12:00:00.000Z'),
    hidden: false,
    ...overrides
  };
}

describe('matching post kinds', () => {
  it('recognizes the two matching kinds only', () => {
    expect(isMatchingPostKind('player_seeking_team')).toBe(true);
    expect(isMatchingPostKind('team_seeking_players')).toBe(true);
    expect(isMatchingPostKind('manual_post')).toBe(false);
    expect(isMatchingPostKind('')).toBe(false);
  });

  it('labels both kinds', () => {
    expect(getMatchingKindLabel('player_seeking_team')).toBe('Player looking for team');
    expect(getMatchingKindLabel('team_seeking_players')).toBe('Team looking for players');
  });
});

describe('containsContactInfo', () => {
  it('detects emails', () => {
    expect(containsContactInfo('reach me at coach@example.com any time')).toBe(true);
  });

  it('detects phone numbers in common formats', () => {
    expect(containsContactInfo('call 614-555-0142')).toBe(true);
    expect(containsContactInfo('call (614) 555 0142')).toBe(true);
    expect(containsContactInfo('text 6145550142')).toBe(true);
  });

  it('does not flag season ranges or normal text', () => {
    expect(containsContactInfo('Available for the 2026-2027 season')).toBe(false);
    expect(containsContactInfo('Plays midfield and defense')).toBe(false);
    expect(containsContactInfo('')).toBe(false);
  });
});

describe('buildMatchingDetails validation', () => {
  it('normalizes a valid player draft', () => {
    const details = buildMatchingDetails(playerDraft());
    expect(details.kind).toBe('player_seeking_team');
    expect(details.state).toBe('OH');
    expect(details.playerFirstName).toBe('Ethan');
    expect(details.signupUrl).toBe('');
    expect(details.openSpots).toBeNull();
  });

  it('normalizes a valid team draft with open spots', () => {
    const details = buildMatchingDetails(teamDraft({ openSpots: '3', signupUrl: 'https://allplays.ai/signup?code=abc' }));
    expect(details.openSpots).toBe(3);
    expect(details.signupUrl).toBe('https://allplays.ai/signup?code=abc');
    expect(details.playerFirstName).toBe('');
  });

  it('requires sport, age group, and a location', () => {
    expect(() => buildMatchingDetails(playerDraft({ sport: ' ' }))).toThrow(/sport/i);
    expect(() => buildMatchingDetails(playerDraft({ ageGroup: '' }))).toThrow(/age group/i);
    expect(() => buildMatchingDetails(playerDraft({ city: '', state: '', zip: '' }))).toThrow(/location/i);
  });

  it('accepts ZIP-only location', () => {
    const details = buildMatchingDetails(playerDraft({ city: '', state: '', zip: '43004' }));
    expect(details.zip).toBe('43004');
  });

  it('requires a player first name for player posts', () => {
    expect(() => buildMatchingDetails(playerDraft({ playerFirstName: '' }))).toThrow(/first name/i);
  });

  it('requires a team for team posts', () => {
    expect(() => buildMatchingDetails(teamDraft({ teamId: '' }))).toThrow(/team/i);
  });

  it('rejects signup links outside allplays.ai', () => {
    expect(() => buildMatchingDetails(teamDraft({ signupUrl: 'https://evil.example.com/join' }))).toThrow(/allplays/i);
  });

  it('rejects contact details in allplays.ai signup links', () => {
    expect(() => buildMatchingDetails(teamDraft({ signupUrl: 'https://allplays.ai/signup?email=child@example.com' }))).toThrow(/emails and phone/i);
    expect(() => buildMatchingDetails(teamDraft({ signupUrl: 'https://allplays.ai/signup?phone=614-555-0142' }))).toThrow(/emails and phone/i);
  });

  it('rejects signup links on player posts', () => {
    expect(() => buildMatchingDetails(playerDraft({ signupUrl: 'https://allplays.ai/signup' }))).toThrow(/team posts/i);
  });

  it('blocks contact details in the description', () => {
    expect(() => buildMatchingDetails(playerDraft({ description: 'email me at p@x.com' }))).toThrow(/emails and phone/i);
    expect(() => buildMatchingDetails(playerDraft({ description: 'call 614-555-0142' }))).toThrow(/emails and phone/i);
  });

  it('rejects descriptions over the length cap', () => {
    expect(() => buildMatchingDetails(playerDraft({ description: 'a'.repeat(501) }))).toThrow(/500/);
  });

  it('clamps out-of-range open spots to null', () => {
    expect(buildMatchingDetails(teamDraft({ openSpots: 0 })).openSpots).toBeNull();
    expect(buildMatchingDetails(teamDraft({ openSpots: 250 })).openSpots).toBeNull();
    expect(buildMatchingDetails(teamDraft({ openSpots: 'lots' })).openSpots).toBeNull();
  });
});

describe('titles and summaries', () => {
  it('builds a player title with first name only', () => {
    const details = buildMatchingDetails(playerDraft());
    expect(buildMatchingTitle(details)).toBe('Ethan (U12 Soccer) is looking for a team');
  });

  it('builds a team title', () => {
    const details = buildMatchingDetails(teamDraft());
    expect(buildMatchingTitle(details, 'Rockets')).toBe('Rockets (U14 Basketball) is looking for players');
  });

  it('summarizes structured fields including open spots', () => {
    const details = buildMatchingDetails(teamDraft({ openSpots: 2, level: 'Competitive' }));
    const summary = buildMatchingSummary(details);
    expect(summary).toContain('U14');
    expect(summary).toContain('Basketball');
    expect(summary).toContain('43004');
    expect(summary).toContain('2 open spots');
    expect(summary).toContain('Competitive');
  });
});

describe('expiry lifecycle', () => {
  it('defaults to 60 days and caps at 90', () => {
    expect(clampMatchingExpiryDays(undefined)).toBe(MATCHING_DEFAULT_EXPIRY_DAYS);
    expect(clampMatchingExpiryDays(-5)).toBe(MATCHING_DEFAULT_EXPIRY_DAYS);
    expect(clampMatchingExpiryDays(120)).toBe(MATCHING_MAX_EXPIRY_DAYS);
    expect(clampMatchingExpiryDays(30)).toBe(30);
  });

  it('computes the expiry date from now', () => {
    const expiry = getMatchingExpiryDate(now);
    const diffDays = (expiry.getTime() - now.getTime()) / (24 * 60 * 60 * 1000);
    expect(diffDays).toBe(MATCHING_DEFAULT_EXPIRY_DAYS);
  });

  it('treats expired, hidden, filled, and closed posts as not open', () => {
    expect(isMatchingPostOpen(post(), now)).toBe(true);
    expect(isMatchingPostOpen(post({ status: 'filled' }), now)).toBe(false);
    expect(isMatchingPostOpen(post({ status: 'closed' }), now)).toBe(false);
    expect(isMatchingPostOpen(post({ hidden: true }), now)).toBe(false);
    expect(isMatchingPostOpen(post({ expiresAt: new Date('2026-07-01T00:00:00.000Z') }), now)).toBe(false);
    expect(isMatchingPostOpen(post({ expiresAt: null }), now)).toBe(true);
  });
});

describe('normalizeMatchingPost', () => {
  it('returns null for non-matching post types', () => {
    expect(normalizeMatchingPost({ id: 'x', type: 'manual_post' })).toBeNull();
  });

  it('maps a firestore doc into a matching post', () => {
    const normalized = normalizeMatchingPost({
      id: 'doc-1',
      type: 'team_seeking_players',
      status: 'open',
      authorId: 'coach-1',
      authorName: 'Coach',
      teamId: 'team-1',
      teamName: 'Rockets',
      title: 'Rockets (U14 Basketball) is looking for players',
      caption: 'Two open spots for spring.',
      matching: { sport: 'Basketball', ageGroup: 'U14', zip: '43004', openSpots: 2 },
      createdAt: { seconds: 1780000000 },
      expiresAt: { seconds: 1785000000 },
      hidden: false
    });
    expect(normalized).not.toBeNull();
    expect(normalized?.kind).toBe('team_seeking_players');
    expect(normalized?.matching.openSpots).toBe(2);
    expect(normalized?.description).toBe('Two open spots for spring.');
    expect(normalized?.expiresAt).toBeInstanceOf(Date);
  });

  it('falls back to closed for unknown statuses', () => {
    const normalized = normalizeMatchingPost({
      id: 'doc-2',
      type: 'player_seeking_team',
      status: 'weird',
      matching: { sport: 'Soccer', ageGroup: 'U12' }
    });
    expect(normalized?.status).toBe('closed');
  });
});

describe('filterMatchingPosts', () => {
  const posts = [
    post({ id: 'a' }),
    post({
      id: 'b',
      kind: 'team_seeking_players',
      matching: { ...post().matching, kind: 'team_seeking_players', sport: 'Basketball', ageGroup: 'U14', city: 'Dayton', state: 'OH' }
    }),
    post({ id: 'c', status: 'filled' })
  ];

  it('excludes non-open posts and applies the kind filter', () => {
    const all = filterMatchingPosts(posts, emptyMatchingFilters, now);
    expect(all.map((entry) => entry.id).sort()).toEqual(['a', 'b']);
    const teams = filterMatchingPosts(posts, { ...emptyMatchingFilters, kind: 'team_seeking_players' }, now);
    expect(teams.map((entry) => entry.id)).toEqual(['b']);
  });

  it('filters by sport, age group, and location', () => {
    expect(filterMatchingPosts(posts, { ...emptyMatchingFilters, sport: 'soc' }, now).map((entry) => entry.id)).toEqual(['a']);
    expect(filterMatchingPosts(posts, { ...emptyMatchingFilters, ageGroup: 'U14' }, now).map((entry) => entry.id)).toEqual(['b']);
    expect(filterMatchingPosts(posts, { ...emptyMatchingFilters, location: 'dayton' }, now).map((entry) => entry.id)).toEqual(['b']);
    expect(filterMatchingPosts(posts, { ...emptyMatchingFilters, location: 'columbus' }, now).map((entry) => entry.id)).toEqual(['a']);
  });
});

describe('feed integration', () => {
  it('maps a matching post to a community feed item routed to /opportunities', () => {
    const item = matchingPostToFeedItem(post());
    expect(item.type).toBe('player_seeking_team');
    expect(item.visibility).toBe('community');
    expect(item.route).toBe('/opportunities');
    expect(item.playerNames).toEqual(['Ethan']);
    expect(item.media).toEqual([]);
  });

  it('prefers posts matching the home teams sport or state and skips own posts', () => {
    const home = {
      teams: [{ teamId: 't1', teamName: 'Home FC', sport: 'Soccer', state: 'OH' }],
      players: [],
      upcomingEvents: []
    } as unknown as ParentHomeModel;
    const candidates = [
      post({ id: 'mine', authorId: 'me' }),
      post({ id: 'soccer-match', createdAt: new Date('2026-06-01T00:00:00.000Z') }),
      post({
        id: 'other-sport',
        createdAt: new Date('2026-07-02T00:00:00.000Z'),
        matching: { ...post().matching, sport: 'Chess', state: 'TX', city: 'Austin' }
      })
    ];
    const selected = selectRelevantMatchingPosts(candidates, home, 'me', 2, now);
    expect(selected.map((entry) => entry.id)).toEqual(['soccer-match', 'other-sport']);
    expect(selected.find((entry) => entry.id === 'mine')).toBeUndefined();
  });
});
