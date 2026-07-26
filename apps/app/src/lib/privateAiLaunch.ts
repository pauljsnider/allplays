export type PrivateAiLaunchIntent = 'roster-import' | 'schedule-import';

export type PrivateAiLaunchContext = {
  newChat: boolean;
  intent: PrivateAiLaunchIntent | '';
  teamId: string;
  teamName: string;
  prompt: string;
};

export function buildPrivateAiLaunchPrompt(intent: PrivateAiLaunchIntent, teamName: string) {
  const name = cleanText(teamName) || 'this team';
  if (intent === 'roster-import') {
    return `Import or update the ${name} roster. I can attach a CSV, image, or PDF, or paste player and family contact details. Preserve every supplied field and show me an editable review before saving players or emailing contacts.`;
  }
  return `Manage the ${name} schedule. I can add or update games, add one-time or recurring practices, cancel events, send RSVP reminders, or attach a CSV, image, or PDF for bulk schedule changes. Use ${name} unless I explicitly choose another managed team, and show me an editable review before saving or sending anything.`;
}

export function buildPrivateAiLaunchPath({
  intent,
  teamId,
  teamName
}: {
  intent: PrivateAiLaunchIntent;
  teamId: string;
  teamName: string;
}) {
  const normalizedTeamId = cleanText(teamId);
  const normalizedTeamName = cleanText(teamName);
  const params = new URLSearchParams({
    newChat: '1',
    intent,
    teamId: normalizedTeamId,
    teamName: normalizedTeamName,
    prompt: buildPrivateAiLaunchPrompt(intent, normalizedTeamName)
  });
  return `/ai?${params.toString()}`;
}

export function parsePrivateAiLaunchContext(search: string): PrivateAiLaunchContext {
  const params = new URLSearchParams(search);
  const rawIntent = cleanText(params.get('intent'));
  const intent: PrivateAiLaunchIntent | '' = rawIntent === 'roster-import' || rawIntent === 'schedule-import'
    ? rawIntent
    : '';
  return {
    newChat: params.get('newChat') === '1',
    intent,
    teamId: cleanText(params.get('teamId')),
    teamName: cleanText(params.get('teamName')),
    prompt: cleanText(params.get('prompt'))
  };
}

export function getPrivateAiLaunchIntentLabel(intent: PrivateAiLaunchIntent | '') {
  if (intent === 'roster-import') return 'Roster import';
  if (intent === 'schedule-import') return 'Schedule management';
  return 'Team management';
}

function cleanText(value: unknown) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}
