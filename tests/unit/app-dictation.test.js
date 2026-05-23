import { describe, expect, it } from 'vitest';
import {
    appendDictationTranscript,
    collectFinalDictationTranscript,
    getDictationErrorMessage,
    isCapacitorNativeRuntime,
    isSpeechDictationSupported,
    pickNativeDictationTranscript
} from '../../apps/app/src/lib/dictation.ts';

describe('app dictation helpers', () => {
    it('detects browser speech recognition support', () => {
        expect(isSpeechDictationSupported({ SpeechRecognition: function MockRecognition() {} })).toBe(true);
        expect(isSpeechDictationSupported({ webkitSpeechRecognition: function MockRecognition() {} })).toBe(true);
        expect(isSpeechDictationSupported({})).toBe(false);
    });

    it('detects Capacitor native runtimes for app dictation', () => {
        expect(isCapacitorNativeRuntime({ location: { protocol: 'capacitor:' } })).toBe(true);
        expect(isCapacitorNativeRuntime({ Capacitor: { isNativePlatform: () => true } })).toBe(true);
        expect(isCapacitorNativeRuntime({ Capacitor: { getPlatform: () => 'android' } })).toBe(true);
        expect(isCapacitorNativeRuntime({ location: { protocol: 'http:' } })).toBe(false);
    });

    it('appends dictated text cleanly to the draft', () => {
        expect(appendDictationTranscript('', '  What is next?  ')).toBe('What is next?');
        expect(appendDictationTranscript('Show my schedule', 'today')).toBe('Show my schedule today');
        expect(appendDictationTranscript('Show my schedule ', 'today')).toBe('Show my schedule today');
    });

    it('collects final transcript chunks from recognition results', () => {
        expect(collectFinalDictationTranscript({
            resultIndex: 1,
            results: [
                { isFinal: true, 0: { transcript: 'Ignore earlier' } },
                { isFinal: true, 0: { transcript: 'Who needs' } },
                { isFinal: true, 0: { transcript: 'RSVP?' } },
                { isFinal: false, 0: { transcript: 'unfinished' } }
            ]
        })).toBe('Who needs RSVP?');
    });

    it('maps common dictation errors to parent-friendly messages', () => {
        expect(getDictationErrorMessage({ error: 'not-allowed' })).toContain('Microphone access was blocked');
        expect(getDictationErrorMessage({ error: 'no-speech' })).toContain('No speech was heard');
        expect(getDictationErrorMessage({ error: 'network' })).toContain('network connection');
        expect(getDictationErrorMessage({ code: 'permission-denied' })).toContain('Microphone access was blocked');
    });

    it('picks the first native speech match with text', () => {
        expect(pickNativeDictationTranscript({ matches: ['', '  Show unread messages  '] })).toBe('Show unread messages');
        expect(pickNativeDictationTranscript({ matches: [] })).toBe('');
    });
});
