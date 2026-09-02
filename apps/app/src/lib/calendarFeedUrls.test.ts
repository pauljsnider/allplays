// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { buildPrivateTeamCalendarFeedUrl, buildPublicTeamGamesIcsUrl } from './calendarFeedUrls';

function clearRuntimeCalendarConfig() {
  delete (globalThis as any).__ALLPLAYS_CONFIG__;
  delete (globalThis as any).ALLPLAYS_CALENDAR_FUNCTION_URL;
  delete (globalThis as any).ALLPLAYS_PUBLIC_GAMES_ICS_URL;
  delete (globalThis as any).ALLPLAYS_TEAM_CALENDAR_FEED_URL;
}

afterEach(() => {
  clearRuntimeCalendarConfig();
});

describe('calendar feed URLs', () => {
  it('uses the deployed Firebase project when packaged apps have no runtime endpoint overrides', () => {
    clearRuntimeCalendarConfig();

    expect(buildPrivateTeamCalendarFeedUrl('team 1.blue:varsity', 'private-token')).toBe(
      'https://us-central1-game-flow-c6311.cloudfunctions.net/teamCalendarFeed?teamId=team%201.blue%3Avarsity&token=private-token'
    );
    expect(buildPublicTeamGamesIcsUrl('team-1_blue')).toBe(
      'https://us-central1-game-flow-c6311.cloudfunctions.net/publicTeamGamesIcs?teamId=team-1_blue'
    );
  });

  it('keeps explicit runtime endpoints authoritative and derives sibling endpoints from the calendar proxy', () => {
    (globalThis as any).__ALLPLAYS_CONFIG__ = {
      teamCalendarFeedFunctionUrl: ' https://calendar.example.test/private-feed?version=2 ',
      publicTeamGamesIcsFunctionUrl: 'https://calendar.example.test/public-feed'
    };

    expect(buildPrivateTeamCalendarFeedUrl('team-1', 'token-1')).toBe(
      'https://calendar.example.test/private-feed?version=2&teamId=team-1&token=token-1'
    );
    expect(buildPublicTeamGamesIcsUrl('team-1')).toBe(
      'https://calendar.example.test/public-feed?teamId=team-1'
    );

    (globalThis as any).__ALLPLAYS_CONFIG__ = {
      calendarFetchFunctionUrl: 'https://functions.example.test/fetchCalendarIcs'
    };
    expect(buildPrivateTeamCalendarFeedUrl('team-1', 'token-2')).toContain(
      'https://functions.example.test/teamCalendarFeed?'
    );
    expect(buildPublicTeamGamesIcsUrl('team-1')).toContain(
      'https://functions.example.test/publicTeamGamesIcs?'
    );
  });

  it('requires a server-returned bearer instead of reading team-stored credential aliases', () => {
    expect(buildPrivateTeamCalendarFeedUrl('team-1', '')).toBe('');
    expect(buildPrivateTeamCalendarFeedUrl('team-1', { calendarSubscriptionToken: 'stored-token' })).toBe('');
    expect(buildPrivateTeamCalendarFeedUrl('', 'token-1')).toBe('');
    expect(buildPrivateTeamCalendarFeedUrl('team/1', 'token-1')).toBe('');
    expect(buildPrivateTeamCalendarFeedUrl('team-1', 'token with spaces')).toBe('');
    expect(buildPublicTeamGamesIcsUrl('team/1')).toBe('');
  });
});
