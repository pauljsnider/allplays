import { describe, it, expect } from 'vitest';
import { resolveViewerLineup, renderViewerLineupSections } from '../../js/live-game-state.js';

describe('live game viewer lineup sync', () => {
  it('renders late-join persisted lineup with starters on court and remaining roster on bench', () => {
    const players = [
      { id: 'p1', name: 'Ava', num: '1' },
      { id: 'p2', name: 'Bree', num: '2' },
      { id: 'p3', name: 'Cami', num: '3' },
      { id: 'p4', name: 'Dani', num: '4' }
    ];

    expect(resolveViewerLineup({
      players,
      onCourt: ['p3', 'p1'],
      bench: ['p4', 'p2']
    })).toEqual({
      onCourtIds: ['p1', 'p3'],
      benchIds: ['p2', 'p4']
    });
  });

  it('renders lineup event updates from explicit onCourt and bench arrays while ignoring unknown ids', () => {
    const players = [
      { id: 'p1', name: 'Ava', num: '1' },
      { id: 'p2', name: 'Bree', num: '2' },
      { id: 'p3', name: 'Cami', num: '3' },
      { id: 'p4', name: 'Dani', num: '4' }
    ];
    const stats = {
      p1: { pts: 8, reb: 4, ast: 2 },
      p2: { pts: 3, reb: 1, ast: 5 },
      p4: { pts: 1, reb: 6, ast: 0 }
    };

    const rendered = renderViewerLineupSections({
      players,
      stats,
      statColumns: ['PTS', 'REB', 'AST'],
      onCourt: ['p2', 'ghost', 'p1'],
      bench: ['ghost', 'p4']
    });

    expect(rendered.onCourtHtml).toContain('Ava');
    expect(rendered.onCourtHtml).toContain('Bree');
    expect(rendered.onCourtHtml).not.toContain('Cami');
    expect(rendered.benchHtml).toContain('Dani');
    expect(rendered.benchHtml).not.toContain('Cami');
    expect(rendered.benchHtml).not.toContain('ghost');
    expect(rendered.onCourtHtml).toContain('8 PTS');
    expect(rendered.onCourtHtml).toContain('4 REB');
    expect(rendered.onCourtHtml).toContain('2 AST');
    expect(rendered.benchHtml).toContain('1 PTS');
    expect(rendered.benchHtml).toContain('6 REB');
    expect(rendered.benchHtml).toContain('0 AST');
  });
});
