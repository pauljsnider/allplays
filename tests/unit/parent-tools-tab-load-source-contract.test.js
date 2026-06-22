import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const parentToolsSource = readFileSync(new URL('../../apps/app/src/pages/ParentTools.tsx', import.meta.url), 'utf8');
const parentToolPanelSources = [
    'AccessTool.tsx',
    'CalendarTool.tsx',
    'CertificatesTool.tsx',
    'FamilyShareTool.tsx',
    'FeesTool.tsx',
    'HouseholdInviteTool.tsx',
    'RegistrationsTool.tsx'
].map((fileName) => ({
    fileName,
    source: readFileSync(new URL(`../../apps/app/src/pages/parent-tools/${fileName}`, import.meta.url), 'utf8')
}));

describe('Parent Tools tab load boundary', () => {
    it('mounts only visited Parent Tools panels instead of every workflow on first access load', () => {
        expect(parentToolsSource).toContain("const [visitedTools, setVisitedTools] = useState<ParentToolId[]>(() => activeTool ? [activeTool] : ['access']);");
        expect(parentToolsSource).toContain("if (!mounted) return null;");
        expect(parentToolsSource).toContain("{tools.map((tool) => (");
        expect(parentToolsSource).toContain("<KeepAliveTool key={tool.id} active={activeTool === tool.id} mounted={visitedTools.includes(tool.id)}>");
        expect(parentToolsSource).toContain("<ParentToolPanel");
    });

    it('keeps access-linked tab refreshes deferred until a stale visited tab is reopened', () => {
        expect(parentToolsSource).toContain("const accessDependentToolIds = tools.map((tool) => tool.id).filter((id): id is ParentToolId => id !== 'access');");
        expect(parentToolsSource).toContain('staleToolsRef.current.has(activeTool)');
        expect(parentToolsSource).toContain('[activeTool]: current[activeTool] + 1');
        expect(parentToolsSource).toContain('setStaleTools(() => new Set(accessDependentToolIds.filter((id) => id !== currentActiveTool && currentVisitedTools.includes(id))))');
    });

    it('keeps extracted panels from depending on fresh async-operation objects in load effects', () => {
        const unstableOperationDependency = /\[[^\]]*(?:accessLoadOperation|teamLoadOperation|playerLoadOperation|loadOperation|submitOperation|redeemOperation|saveOperation|exportOperation|feedOperation|payOperation)[^\]]*\]/;

        parentToolPanelSources.forEach(({ fileName, source }) => {
            expect(source, fileName).not.toMatch(unstableOperationDependency);
        });

        const accessSource = parentToolPanelSources.find(({ fileName }) => fileName === 'AccessTool.tsx').source;
        expect(accessSource).not.toContain('playerLoadOperation.error');
        expect(accessSource).not.toMatch(/\[[^\]]*playerLoadError[^\]]*\]/);
    });
});
