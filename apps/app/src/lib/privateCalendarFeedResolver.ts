import { functions, httpsCallable } from './adapters/legacyParentTools';
import { buildPrivateTeamCalendarFeedUrl } from './calendarFeedUrls';
import { callNativeFirebaseFunction } from './nativeCallable';
import { isNativeRuntime } from './nativeRuntime';

type PrivateCalendarFeedTokenResponse = {
  token?: unknown;
};

export async function resolvePrivateTeamCalendarFeedUrl(teamId: string) {
  const normalizedTeamId = String(teamId || '').trim();
  if (!normalizedTeamId) return '';

  try {
    const input = { teamId: normalizedTeamId };
    const data = isNativeRuntime()
      ? await callNativeFirebaseFunction<PrivateCalendarFeedTokenResponse>(
        'getPrivateTeamCalendarFeedToken',
        input,
        { errorLabel: 'Private calendar feed' }
      )
      : (await httpsCallable(functions, 'getPrivateTeamCalendarFeedToken')(input))?.data as PrivateCalendarFeedTokenResponse;
    const token = typeof data.token === 'string' ? data.token.trim() : '';
    return buildPrivateTeamCalendarFeedUrl(normalizedTeamId, token);
  } catch {
    return '';
  }
}
