import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

function readSource(path) {
    return readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
}

const packageSource = readSource('package.json');
const appPackageSource = readSource('apps/app/package.json');
const baselineDocSource = readSource('docs/app-performance-baseline.md');
const bundleSizeScriptSource = readSource('scripts/check-app-bundle-size.mjs');
const uxTimingSource = readSource('apps/app/src/lib/uxTiming.ts');
const telemetrySource = readSource('apps/app/src/lib/telemetry.ts');
const mainSource = readSource('apps/app/src/main.tsx');
const homeSource = readSource('apps/app/src/pages/Home.tsx');
const scheduleSource = readSource('apps/app/src/pages/Schedule.tsx');
const messagesSource = readSource('apps/app/src/pages/Messages.tsx');
const scheduleServiceSource = readSource('apps/app/src/lib/scheduleService.ts');
const chatServiceSource = readSource('apps/app/src/lib/chatService.ts');

describe('app performance measurement initiative source contract', () => {
    it('keeps the performance baseline doc reproducible and tied to issue 2050 closure', () => {
        [
            '# App Performance Baseline & Verification',
            'Measurement procedure (repeatable)',
            'Baseline → After',
            'Cold-start TTI (Home)',
            'Warm resume time',
            'Firestore reads / Home mount',
            'Entry chunk size (gzip)',
            'RSVP tap latency',
            'Chat send latency',
            'paste',
            'the completed table into #2050 before closing it'
        ].forEach((snippet) => {
            expect(baselineDocSource).toContain(snippet);
        });

        expect(baselineDocSource).toContain('`npm run app:build && npm run app:preview`');
        expect(baselineDocSource).toContain('Numbers are medians of 3 runs.');
    });

    it('keeps app preview and bundle budget commands available for baseline captures', () => {
        expect(packageSource).toContain('"app:build": "npm --prefix apps/app run build"');
        expect(packageSource).toContain('"app:preview": "npm --prefix apps/app run preview"');
        expect(packageSource).toContain('"app:check-bundle-size": "node scripts/check-app-bundle-size.mjs"');
        expect(appPackageSource).toContain('"preview": "vite preview --host 0.0.0.0"');

        expect(bundleSizeScriptSource).toContain("const defaultEntryBudgetBytes = 1_420_000;");
        expect(bundleSizeScriptSource).toContain('process.env.APP_ENTRY_CHUNK_LIMIT_BYTES');
        expect(bundleSizeScriptSource).toContain('Unable to find the app entry chunk');
        expect(bundleSizeScriptSource).toContain('App entry chunk ${path.relative(repoRoot, entryChunkPath)} is ${entrySizeKb} KB');
    });

    it('keeps canonical UX timing labels flowing through telemetry', () => {
        [
            "appStartup: 'app startup'",
            "firstMeaningfulRender: 'first meaningful render'",
            "homeMount: 'home mount load'",
            "scheduleMount: 'schedule mount load'",
            "messagesMount: 'messages mount load'",
            "rsvpTap: 'rsvp tap latency'",
            "chatSend: 'chat send latency'"
        ].forEach((label) => {
            expect(uxTimingSource).toContain(label);
        });

        expect(uxTimingSource).toContain('recordAppUxTiming(label, startedAt, meta);');
        expect(uxTimingSource).toContain('console.info(`[ux] ${label} ${JSON.stringify({ durationMs, ...meta })}`);');
        expect(telemetrySource).toContain("captureAppTelemetryEvent('app_ux_timing', {");
        expect(telemetrySource).toContain('durationMs,');
        expect(telemetrySource).toContain('outcome,');
        expect(telemetrySource).toContain("return createAppTimer('app startup', { stage: 'startup' });");
    });

    it('keeps startup, screen-mount, and first meaningful render instrumentation wired in app entry points', () => {
        expect(mainSource).toContain('const startupTimer = startAppStartupTimer();');
        expect(mainSource).toContain("startupTimer.end({ phase: 'initial-render' });");
        expect(mainSource).toContain("captureAppStartupFailure(error, { phase: 'initial-render' });");

        expect(homeSource).toContain("startScreenMountTimer('home'");
        expect(homeSource).toContain("recordFirstMeaningfulRender('home'");
        expect(scheduleSource).toContain("startScreenMountTimer('schedule'");
        expect(scheduleSource).toContain("recordFirstMeaningfulRender('schedule'");
        expect(messagesSource).toContain("startScreenMountTimer('messages'");
    });

    it('keeps RSVP and chat send latency timers around their write paths', () => {
        expect(scheduleServiceSource).toContain("import { startInteractionTimer, startUxTimer, UX_TIMING } from './uxTiming';");
        expect(scheduleServiceSource).toContain('const interaction = startInteractionTimer(UX_TIMING.rsvpTap, { response });');
        expect(scheduleServiceSource).toContain("interaction.end({ path: 'sdk' });");
        expect(scheduleServiceSource).toContain("interaction.end({ path: 'rest' });");

        expect(chatServiceSource).toContain("import { startInteractionTimer, UX_TIMING } from './uxTiming';");
        expect(chatServiceSource).toContain('const interaction = startInteractionTimer(UX_TIMING.chatSend, {');
        expect(chatServiceSource).toContain("interaction.end({ path: isNativeRuntime() ? 'native' : 'sdk' });");
    });
});
