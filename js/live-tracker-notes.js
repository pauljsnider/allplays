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

export function buildGameNoteLogText(noteText, type = 'text') {
  const note = normalizeGameNoteText(noteText);
  if (!note) return '';
  return type === 'voice' ? `Voice note: ${note}` : `Note: ${note}`;
}
