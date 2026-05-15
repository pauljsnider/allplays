import { describe, it, expect } from 'vitest';
import {
  isVoiceRecognitionSupported,
  normalizeGameNoteText,
  appendGameSummaryLine,
  buildGameNoteLogText,
  buildGoalSportNoteText
} from '../../js/live-tracker-notes.js';

describe('live tracker note helpers', () => {
  it('detects support when SpeechRecognition exists', () => {
    expect(isVoiceRecognitionSupported({ SpeechRecognition: function Mock() {} })).toBe(true);
  });

  it('detects support when webkitSpeechRecognition exists', () => {
    expect(isVoiceRecognitionSupported({ webkitSpeechRecognition: function Mock() {} })).toBe(true);
  });

  it('returns false when no recognition API exists', () => {
    expect(isVoiceRecognitionSupported({})).toBe(false);
  });

  it('normalizes note text by trimming whitespace', () => {
    expect(normalizeGameNoteText('  pushed pace in Q2  ')).toBe('pushed pace in Q2');
  });

  it('appends note lines to existing summary', () => {
    expect(appendGameSummaryLine('First note', 'Second note')).toBe('First note\nSecond note');
  });

  it('does not append empty note lines', () => {
    expect(appendGameSummaryLine('First note', '   ')).toBe('First note');
  });

  it('formats text note log entries', () => {
    expect(buildGameNoteLogText('Subbed in energy unit', 'text')).toBe('Note: Subbed in energy unit');
  });

  it('formats voice note log entries', () => {
    expect(buildGameNoteLogText('Great closeout by 12', 'voice')).toBe('Voice note: Great closeout by 12');
  });

  it('formats simple goal tracker notes with scoring context', () => {
    expect(buildGoalSportNoteText('Jr KC Current', ' Header off corner ')).toBe('Jr KC Current goal: Header off corner');
    expect(buildGoalSportNoteText('', 'Set piece')).toBe('Goal: Set piece');
    expect(buildGoalSportNoteText('Jr KC Current', '   ')).toBe('');
  });
});
