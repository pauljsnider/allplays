import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const uxTimingSource = readFileSync(new URL('../../apps/app/src/lib/uxTiming.ts', import.meta.url), 'utf8');
const uxTimingTestSource = readFileSync(new URL('../../apps/app/src/lib/uxTiming.test.ts', import.meta.url), 'utf8');
const performanceContractSource = readFileSync(new URL('./app-performance-baseline-contract.test.js', import.meta.url), 'utf8');
const homeSource = readFileSync(new URL('../../apps/app/src/pages/Home.tsx', import.meta.url), 'utf8');
const scheduleSource = readFileSync(new URL('../../apps/app/src/pages/Schedule.tsx', import.meta.url), 'utf8');
const messagesSource = readFileSync(new URL('../../apps/app/src/pages/Messages.tsx', import.meta.url), 'utf8');
const scheduleRsvpHookSource = readFileSync(new URL('../../apps/app/src/hooks/schedule/useScheduleEventRsvp.ts', import.meta.url), 'utf8');
const chatServiceSource = readFileSync(new URL('../../apps/app/src/lib/chatService.ts', import.meta.url), 'utf8');

describe('issue 2281 ux timing coverage source contract', () => {
    it('keeps canonical UX timing labels mapped to route mounts and telemetry', () => {
        expect(uxTimingSource).toContain('export const UX_TIMING = {');
        expect(uxTimingSource).toContain('home: UX_TIMING.homeMount');
        expect(uxTimingSource).toContain('schedule: UX_TIMING.scheduleMount');
        expect(uxTimingSource).toContain('messages: UX_TIMING.messagesMount');
        expect(uxTimingSource).toContain('recordAppUxTiming(label, startedAt, meta)');
        expect(uxTimingSource).toContain('recordUxTiming(UX_TIMING.firstMeaningfulRender, 0, { route, ...meta });');
    });

    it('keeps app screens and user interactions instrumented', () => {
        expect(homeSource).toContain("startScreenMountTimer('home'");
        expect(homeSource).toContain("recordFirstMeaningfulRender('home'");
        expect(scheduleSource).toContain("startScreenMountTimer('schedule'");
        expect(scheduleSource).toContain("recordFirstMeaningfulRender('schedule'");
        expect(messagesSource).toContain("startScreenMountTimer('messages'");
        expect(scheduleRsvpHookSource).toContain('const interaction = startInteractionTimer(UX_TIMING.rsvpTap, { response });');
        expect(chatServiceSource).toContain('const interaction = startInteractionTimer(UX_TIMING.chatSend, {');
        expect(chatServiceSource).toContain('if (!skipInteractionTiming) {');
    });

    it('keeps direct tests for timing labels, render milestones, and baseline contracts', () => {
        expect(uxTimingTestSource).toContain('startScreenMountTimer uses stable labels and bounded screen metadata');
        expect(uxTimingTestSource).toContain('startInteractionTimer tags the span as an interaction');
        expect(uxTimingTestSource).toContain('records first meaningful render');
        expect(performanceContractSource).toContain('keeps canonical uxTiming labels wired to telemetry and app entry points');
    });
});
