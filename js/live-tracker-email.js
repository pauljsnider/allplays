export function resolveSummaryRecipient({ teamNotificationEmail, userEmail }) {
  const teamRecipient = (teamNotificationEmail || '').trim();
  if (teamRecipient) {
    return teamRecipient;
  }

  return (userEmail || '').trim();
}
