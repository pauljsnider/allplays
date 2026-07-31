import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
    TOOL_REGISTRY,
    getToolDescriptor,
    toolNames,
    renderAvailableTools,
    buildPlannerPrompt,
    buildFinalAnswerPrompt,
    summarizeSignedInUser,
    formatToolResultsForPrompt
} from '../../services/chatgpt-mcp/src/assistant-core/index.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

describe('assistant-core: shared tool registry', () => {
    it('carries the full app tool contract (41 tools: 20 read, 21 write)', () => {
        expect(TOOL_REGISTRY).toHaveLength(41);
        expect(TOOL_REGISTRY.filter((t) => t.mode === 'read')).toHaveLength(20);
        expect(TOOL_REGISTRY.filter((t) => t.mode === 'write')).toHaveLength(21);
    });

    it('resolves tools by canonical name and by alias', () => {
        expect(getToolDescriptor('list_schedule')?.name).toBe('list_schedule');
        expect(getToolDescriptor('get_schedule')?.name).toBe('list_schedule'); // alias
        expect(getToolDescriptor('claim_task')?.name).toBe('claim_assignment'); // alias
        expect(getToolDescriptor('nonexistent')).toBeNull();
    });

    it('exposes the MVP read tools the MCP implements', () => {
        for (const name of ['get_profile', 'list_schedule']) {
            expect(toolNames()).toContain(name);
        }
    });

    it('is frozen (immutable contract)', () => {
        expect(Object.isFrozen(TOOL_REGISTRY)).toBe(true);
        expect(Object.isFrozen(TOOL_REGISTRY[0])).toBe(true);
    });
});

describe('assistant-core: shared prompts', () => {
    const input = {
        user: { uid: 'u1', email: 'p@example.com', displayName: 'Parent', roles: ['parent'], emailVerified: true },
        question: 'what does my family have this week?',
        history: [],
        toolResults: []
    };

    it('planner prompt uses the ALL PLAYS framing and lists every tool', () => {
        const p = buildPlannerPrompt(input);
        expect(p).toContain('You are ALL PLAYS');
        expect(p).toContain('AVAILABLE TOOLS:');
        for (const t of TOOL_REGISTRY) {
            expect(p).toContain(`- ${t.name} (${t.mode}): ${t.description}`);
        }
    });

    it('planner can be given a custom registry (the app injects its own live one)', () => {
        const custom = [{ name: 'only_tool', mode: 'read', aliases: [], description: 'just one' }];
        const p = buildPlannerPrompt(input, custom);
        expect(p).toContain('- only_tool (read): just one');
        expect(p).not.toContain('- list_schedule (read)');
    });

    it('final-answer prompt keeps the account-scoped, confirmation-aware framing', () => {
        const p = buildFinalAnswerPrompt(input);
        expect(p).toContain('Use ONLY this account-scoped data');
        expect(p).toContain('reply "yes" to confirm');
    });

    it('summarizeSignedInUser and formatToolResultsForPrompt match the app shapes', () => {
        expect(summarizeSignedInUser(input.user)).toEqual({
            uid: 'u1', email: 'p@example.com', displayName: 'Parent', roles: ['parent'], emailVerified: true
        });
        expect(formatToolResultsForPrompt([{ name: 'x', ok: true, data: { a: 1 } }])).toEqual([
            { name: 'x', ok: true, data: { a: 1 }, error: undefined, requiresConfirmation: false }
        ]);
    });

    it('renderAvailableTools produces one line per tool', () => {
        expect(renderAvailableTools().split('\n')).toHaveLength(TOOL_REGISTRY.length);
    });
});

describe('assistant-core: drift guard', () => {
    it('registry.js is in sync with the app source of truth (privateAiService.ts)', () => {
        // Fails if someone edits the app registry without regenerating the
        // shared one — the single-source guarantee that keeps the ChatGPT MCP
        // service and the in-app AI chat from diverging.
        expect(() => execFileSync('node', ['scripts/gen-assistant-registry.mjs', '--check'], {
            cwd: repoRoot,
            stdio: 'pipe'
        })).not.toThrow();
    });
});
