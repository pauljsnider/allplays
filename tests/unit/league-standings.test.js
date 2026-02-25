import { describe, it, expect } from 'vitest';
import {
  parseTeamSidelineStandings,
  normalizeTeamKey,
  findBestStandingMatch
} from '../../js/league-standings.js';

const SAMPLE_STANDINGS_HTML = `
  <div id="ContentPlaceHolder1_StandingsResultsControl_StandingsPanel">
    <table id="ctl00_ContentPlaceHolder1_StandingsResultsControl_standingsGrid_ctl00" class="rgMasterTable">
      <thead>
        <tr>
          <th>Team</th><th>W</th><th>L</th><th>T</th><th>PCT</th><th>PF</th><th>PA</th><th>PD</th><th>Coach</th>
        </tr>
      </thead>
      <tbody>
        <tr class="rgRow">
          <td>Wilcox</td><td align="center">5</td><td align="center">0</td><td align="center">0</td><td>1.000</td><td>99</td><td>50</td><td>49</td><td>Andrew Wilcox</td>
        </tr>
        <tr class="rgAltRow">
          <td>Blue Valley A</td><td align="center">4</td><td align="center">1</td><td align="center">0</td><td>0.800</td><td>65</td><td>43</td><td>22</td><td>Nellie Betzen</td>
        </tr>
      </tbody>
    </table>
  </div>
`;

const SAMPLE_STANDINGS_HTML_SINGLE_QUOTE_ID = `
  <table id='ctl00_ContentPlaceHolder1_StandingsResultsControl_standingsGrid_ctl00'>
    <tr>
      <th>Team</th><th>W</th><th>L</th>
    </tr>
    <tr>
      <td>Red Hawks</td><td>3</td><td>2</td>
    </tr>
  </table>
`;

describe('league standings parser', () => {
  it('parses TeamSideline rows with W/L/T values', () => {
    const rows = parseTeamSidelineStandings(SAMPLE_STANDINGS_HTML);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      team: 'Wilcox',
      w: 5,
      l: 0,
      t: 0,
      record: '5-0',
      pct: '1.000',
      pf: 99,
      pa: 50,
      pd: 49
    });
  });

  it('normalizes names for stable matching', () => {
    expect(normalizeTeamKey('Blue Valley A')).toBe('bluevalleya');
    expect(normalizeTeamKey('Blue-Valley A!')).toBe('bluevalleya');
  });

  it('finds best match with exact or partial normalization', () => {
    const rows = parseTeamSidelineStandings(SAMPLE_STANDINGS_HTML);
    expect(findBestStandingMatch(rows, 'Blue Valley A')?.record).toBe('4-1');
    expect(findBestStandingMatch(rows, 'Blue Valley')?.record).toBe('4-1');
    expect(findBestStandingMatch(rows, 'Unknown Team')).toBeNull();
  });

  it('returns empty results when no standings table exists', () => {
    expect(parseTeamSidelineStandings('<html><body>No standings here</body></html>')).toEqual([]);
  });

  it('parses standings table when id uses single quotes', () => {
    const rows = parseTeamSidelineStandings(SAMPLE_STANDINGS_HTML_SINGLE_QUOTE_ID);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      team: 'Red Hawks',
      w: 3,
      l: 2,
      record: '3-2'
    });
  });

  it('handles large non-table input safely', () => {
    const payload = `${'x'.repeat(250000)}<div>${'y'.repeat(250000)}</div>`;
    expect(parseTeamSidelineStandings(payload)).toEqual([]);
  });
});
