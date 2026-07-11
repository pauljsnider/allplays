import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const liveGameHtml = readFileSync(new URL('../../live-game.html', import.meta.url), 'utf8');
const liveGameJs = readFileSync(new URL('../../js/live-game.js', import.meta.url), 'utf8');

describe('live game camera setup and stream controls', () => {
    it('exposes Begin Streaming only as a local preview-stream action', () => {
        expect(liveGameHtml).toContain('Camera/Mic Setup');
        expect(liveGameHtml).toContain('Local stream only');
        expect(liveGameHtml).toContain('Start Camera/Mic Setup');
        expect(liveGameHtml).toContain('id="native-camera-begin-stream-btn"');
        expect(liveGameHtml).toContain('Begin Streaming');
        expect(liveGameHtml).toContain('No external ingest or cloud recording is started.');
    });

    it('wires visible stream states and an inline retry without backend ingest', () => {
        const copySurface = `${liveGameHtml}\n${liveGameJs}`;
        const beginStart = liveGameJs.indexOf('async function beginNativeBroadcastStream()');
        const beginEnd = liveGameJs.indexOf('async function retryNativeBroadcastStream()', beginStart);
        const beginSource = liveGameJs.slice(beginStart, beginEnd);

        expect(liveGameHtml).toContain('id="native-broadcast-state"');
        expect(liveGameHtml).toContain('id="native-broadcast-error"');
        expect(liveGameHtml).toContain('id="native-broadcast-retry-btn"');
        expect(copySurface).toContain('BROADCAST_STREAM_STATUSES.STARTING');
        expect(copySurface).toContain('BROADCAST_STREAM_STATUSES.LIVE');
        expect(copySurface).toContain('BROADCAST_STREAM_STATUSES.FAILED');
        expect(beginSource).toContain('state.nativeCameraStream');
        expect(beginSource).toContain('await els.nativeCameraPreview.play()');
        expect(beginSource).not.toContain('updateGame(');
        expect(beginSource).not.toContain('saveBroadcastSetupSession(');
        expect(copySurface).toContain('No backend ingest or cloud recording is active.');
        expect(copySurface).not.toContain('MediaRecorder');
    });

    it('re-checks the active preview stream before marking a pending play live', () => {
        const beginStart = liveGameJs.indexOf('async function beginNativeBroadcastStream()');
        const beginEnd = liveGameJs.indexOf('async function retryNativeBroadcastStream()', beginStart);
        const beginSource = liveGameJs.slice(beginStart, beginEnd);
        const afterPlaySource = beginSource.slice(beginSource.indexOf('await els.nativeCameraPreview.play()'));

        expect(beginSource).toContain('const stream = state.nativeCameraStream;');
        expect(beginSource).toContain('els.nativeCameraPreview.srcObject = stream;');
        expect(afterPlaySource).toContain('state.nativeCameraStream !== stream');
        expect(afterPlaySource).toContain('els.nativeCameraPreview.srcObject !== stream');
        expect(afterPlaySource).toContain('const postPlayReadiness = getNativeCameraReadiness();');
        expect(afterPlaySource).toContain('!postPlayReadiness.cameraReady || !postPlayReadiness.microphoneReady');
        expect(afterPlaySource.indexOf('state.nativeCameraStream !== stream')).toBeLessThan(afterPlaySource.indexOf('setNativeBroadcastStatus(BROADCAST_STREAM_STATUSES.LIVE)'));
    });
});
