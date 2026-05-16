export function isVoiceRecognitionSupported(win = globalThis) {
  if (!win) return false;
  return !!(win.SpeechRecognition || win.webkitSpeechRecognition);
}

export function normalizeGameNoteText(text) {
  return (text || '').trim();
}

export function appendGameSummaryLine(existingSummary, noteText) {
  const summary = normalizeGameNoteText(existingSummary);
  const note = normalizeGameNoteText(noteText);
  if (!note) return summary;
  return summary ? `${summary}\n${note}` : note;
}

export function removeGameSummaryLine(existingSummary, noteText) {
  const note = normalizeGameNoteText(noteText);
  if (!note) return normalizeGameNoteText(existingSummary);

  const lines = String(existingSummary || '').split('\n');
  const index = lines.map(normalizeGameNoteText).lastIndexOf(note);
  if (index === -1) return normalizeGameNoteText(existingSummary);

  lines.splice(index, 1);
  return lines.map(normalizeGameNoteText).filter(Boolean).join('\n');
}

export function buildGameNoteLogText(noteText, type = 'text') {
  const note = normalizeGameNoteText(noteText);
  if (!note) return '';
  return type === 'voice' ? `Voice note: ${note}` : `Note: ${note}`;
}

export function buildGoalSportNoteText(teamLabel, noteText) {
  const note = normalizeGameNoteText(noteText);
  if (!note) return '';
  const label = normalizeGameNoteText(teamLabel);
  if (!label) return `Goal: ${note}`;
  return `${label} goal: ${note}`;
}
