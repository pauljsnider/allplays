import { getTeamScorePair as legacyGetTeamScorePair } from '@legacy/season-record.js';

export const getTeamScorePair = legacyGetTeamScorePair as (game: Record<string, unknown>) => {
  teamScore: unknown;
  opponentScore: unknown;
};
