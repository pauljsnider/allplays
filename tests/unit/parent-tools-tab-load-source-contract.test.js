import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const parentToolsSource = readFileSync(new URL('../../apps/app/src/pages/ParentTools.tsx', import.meta.url), 'utf8');

describe('Parent Tools tab load boundary', () => {
    it('mounts only visited Parent Tools panels instead of every workflow on first access load', () => {
        expect(parentToolsSource).toContain("const [visitedTools, setVisitedTools] = useState<ParentToolId[]>(() => activeTool ? [activeTool] : ['access']);");
        expect(parentToolsSource).toContain("if (!mounted) return null;");
        expect(parentToolsSource).toContain("<KeepAliveTool active={activeTool === 'access'} mounted={visitedTools.includes('access')}>");
        expect(parentToolsSource).toContain("<KeepAliveTool active={activeTool === 'registrations'} mounted={visitedTools.includes('registrations')}>");
        expect(parentToolsSource).toContain("<KeepAliveTool active={activeTool === 'certificates'} mounted={visitedTools.includes('certificates')}>");
    });

    it('keeps access-linked tab refreshes deferred until a stale visited tab is reopened', () => {
        expect(parentToolsSource).toContain("const accessDependentToolIds = tools.map((tool) => tool.id).filter((id): id is ParentToolId => id !== 'access');");
        expect(parentToolsSource).toContain('staleToolsRef.current.has(activeTool)');
        expect(parentToolsSource).toContain('[activeTool]: current[activeTool] + 1');
        expect(parentToolsSource).toContain('setStaleTools(() => new Set(accessDependentToolIds.filter((id) => id !== currentActiveTool && currentVisitedTools.includes(id))))');
    });
});
