export function resolveSummaryRecipient({ teamNotificationEmail, userEmail }) {
  const teamRecipient = (teamNotificationEmail || '').trim();
  if (teamRecipient) {
    return teamRecipient;
  }

  return (userEmail || '').trim();
}

export function resolveFinalScore(inputValue, liveScore) {
  const parsedScore = Number.parseInt(inputValue, 10);
  return Number.isNaN(parsedScore) ? liveScore : parsedScore;
}
