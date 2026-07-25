import { describe, expect, it } from 'vitest';
import {
    buildPrivateAiLaunchPath,
    buildPrivateAiLaunchPrompt,
    getPrivateAiLaunchIntentLabel,
    parsePrivateAiLaunchContext
} from '../../apps/app/src/lib/privateAiLaunch.ts';

describe('private AI launch routing', () => {
    it('builds a new team-scoped schedule chat with an unsent import prompt', () => {
        const path = buildPrivateAiLaunchPath({
            intent: 'schedule-import',
            teamId: 'team-1',
            teamName: 'K - Cougars'
        });
        const context = parsePrivateAiLaunchContext(path.slice(path.indexOf('?')));

        expect(path.startsWith('/ai?')).toBe(true);
        expect(context).toEqual({
            newChat: true,
            intent: 'schedule-import',
            teamId: 'team-1',
            teamName: 'K - Cougars',
            prompt: buildPrivateAiLaunchPrompt('schedule-import', 'K - Cougars')
        });
        expect(context.prompt).toContain('CSV, image, or PDF');
        expect(context.prompt).toContain('editable review');
        expect(getPrivateAiLaunchIntentLabel(context.intent)).toBe('Schedule management');
    });

    it('builds a roster draft that explicitly preserves fields and delays emails', () => {
        const path = buildPrivateAiLaunchPath({
            intent: 'roster-import',
            teamId: 'team&2',
            teamName: 'Vipers 12U'
        });
        const context = parsePrivateAiLaunchContext(path.slice(path.indexOf('?')));

        expect(context.teamId).toBe('team&2');
        expect(context.teamName).toBe('Vipers 12U');
        expect(context.prompt).toContain('Preserve every supplied field');
        expect(context.prompt).toContain('before saving players or emailing contacts');
        expect(getPrivateAiLaunchIntentLabel(context.intent)).toBe('Roster import');
    });
});
