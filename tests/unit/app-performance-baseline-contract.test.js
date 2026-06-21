import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const repoRoot = new URL('../../', import.meta.url);

function readRepoFile(relativePath) {
    return readFileSync(new URL(relativePath, repoRoot), 'utf8');
}

describe('app performance baseline contract', () => {
    it('documents the app-performance metric set and repeatable procedure', () => {
        const doc = readRepoFile('docs/app-performance-baseline.md');

        [
            'Cold-start TTI (Home)',
            'Warm resume time',
            'Firestore reads / Home mount',
            'Firestore reads / Schedule mount',
            'Firestore reads / Messages mount',
            'Entry chunk size (gzip)',
            'RSVP tap latency',
            'Chat send latency',
            'Measurement procedure (repeatable)',
            'Baseline → After'
        ].forEach((snippet) => {
            expect(doc).toContain(snippet);
        });
    });

    it('keeps canonical uxTiming labels wired to telemetry and app entry points', () => {
        const uxTiming = readRepoFile('apps/app/src/lib/uxTiming.ts');
        const telemetry = readRepoFile('apps/app/src/lib/telemetry.ts');
        const main = readRepoFile('apps/app/src/main.tsx');
        const home = readRepoFile('apps/app/src/pages/Home.tsx');
        const schedule = readRepoFile('apps/app/src/pages/Schedule.tsx');
        const messages = readRepoFile('apps/app/src/pages/Messages.tsx');

        [
            "appStartup: 'app startup'",
            "firstMeaningfulRender: 'first meaningful render'",
            "homeMount: 'home mount load'",
            "scheduleMount: 'schedule mount load'",
            "messagesMount: 'messages mount load'",
            "rsvpTap: 'rsvp tap latency'",
            "chatSend: 'chat send latency'"
        ].forEach((label) => {
            expect(uxTiming).toContain(label);
        });

        expect(uxTiming).toContain('recordAppUxTiming(label, startedAt, meta)');
        expect(telemetry).toContain("return createAppTimer('app startup', { stage: 'startup' });");
        expect(main).toContain('const startupTimer = startAppStartupTimer();');
        expect(home).toContain("startScreenMountTimer('home'");
        expect(home).toContain("recordFirstMeaningfulRender('home'");
        expect(schedule).toContain("startScreenMountTimer('schedule'");
        expect(schedule).toContain("recordFirstMeaningfulRender('schedule'");
        expect(messages).toContain("startScreenMountTimer('messages'");
    });

    it('records RSVP and chat-send interaction latency around the write paths', () => {
        const scheduleService = readRepoFile('apps/app/src/lib/scheduleService.ts');
        const chatService = readRepoFile('apps/app/src/lib/chatService.ts');

        expect(scheduleService).toContain("import { startInteractionTimer, startUxTimer, UX_TIMING } from './uxTiming';");
        expect(scheduleService).toContain('const interaction = startInteractionTimer(UX_TIMING.rsvpTap, { response });');
        expect(scheduleService).toContain("interaction.end({ path: 'sdk' });");
        expect(scheduleService).toContain("interaction.end({ path: 'rest' });");
        expect(chatService).toContain("import { startInteractionTimer, UX_TIMING } from './uxTiming';");
        expect(chatService).toContain('const interaction = startInteractionTimer(UX_TIMING.chatSend, {');
        expect(chatService).toContain("interaction.end({ path: isNativeRuntime() ? 'native' : 'sdk' });");
    });
});
