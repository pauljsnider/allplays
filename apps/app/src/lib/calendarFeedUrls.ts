const defaultFunctionsOrigin = 'https://us-central1-game-flow-c6311.cloudfunctions.net';
const publicTeamIdPattern = /^[A-Za-z0-9_-]{1,128}$/;
const privateTokenPattern = /^[A-Za-z0-9_-]{1,128}$/;

function isValidPrivateTeamId(value: string) {
  return value.length > 0 && value.length <= 128 && !value.includes('/');
}

type CalendarFeedRuntime = typeof globalThis & {
  __ALLPLAYS_CONFIG__?: Record<string, unknown>;
  ALLPLAYS_CALENDAR_FUNCTION_URL?: unknown;
  ALLPLAYS_PUBLIC_GAMES_ICS_URL?: unknown;
  ALLPLAYS_TEAM_CALENDAR_FEED_URL?: unknown;
};

function getRuntime() {
  return globalThis as CalendarFeedRuntime;
}

function getConfiguredFunctionUrl(configKey: string, globalKey: keyof CalendarFeedRuntime, functionName: string) {
  const runtime = getRuntime();
  const configured = runtime.__ALLPLAYS_CONFIG__?.[configKey] || runtime[globalKey];
  if (typeof configured === 'string' && configured.trim()) return configured.trim();

  const calendarFetchUrl = runtime.__ALLPLAYS_CONFIG__?.calendarFetchFunctionUrl
    || runtime.ALLPLAYS_CALENDAR_FUNCTION_URL;
  if (typeof calendarFetchUrl === 'string' && calendarFetchUrl.includes('fetchCalendarIcs')) {
    return calendarFetchUrl.trim().replace('fetchCalendarIcs', functionName);
  }

  return `${defaultFunctionsOrigin}/${functionName}`;
}

export function buildPrivateTeamCalendarFeedUrl(teamId: string, token: unknown) {
  const normalizedTeamId = String(teamId || '').trim();
  const normalizedToken = typeof token === 'string' ? token.trim() : '';
  if (!isValidPrivateTeamId(normalizedTeamId) || !privateTokenPattern.test(normalizedToken)) return '';

  const baseUrl = getConfiguredFunctionUrl(
    'teamCalendarFeedFunctionUrl',
    'ALLPLAYS_TEAM_CALENDAR_FEED_URL',
    'teamCalendarFeed'
  );
  const separator = baseUrl.includes('?') ? '&' : '?';
  return `${baseUrl}${separator}teamId=${encodeURIComponent(normalizedTeamId)}&token=${encodeURIComponent(normalizedToken)}`;
}

export function buildPublicTeamGamesIcsUrl(teamId: string) {
  const normalizedTeamId = String(teamId || '').trim();
  if (!publicTeamIdPattern.test(normalizedTeamId)) return '';

  const baseUrl = getConfiguredFunctionUrl(
    'publicTeamGamesIcsFunctionUrl',
    'ALLPLAYS_PUBLIC_GAMES_ICS_URL',
    'publicTeamGamesIcs'
  );
  const separator = baseUrl.includes('?') ? '&' : '?';
  return `${baseUrl}${separator}teamId=${encodeURIComponent(normalizedTeamId)}`;
}
