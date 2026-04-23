export const OVERTIME_MIXED_SCORING_LOG = [
  { undoData: { type: 'stat', statKey: 'PTS', value: 2, isOpponent: false } },
  { undoData: { type: 'stat', statKey: 'goals', value: '3', isOpponent: false } },
  { undoData: { type: 'stat', statKey: 'points', value: 1, isOpponent: true } },
  { undoData: { type: 'stat', statKey: 'fouls', value: 1, isOpponent: false } },
  { undoData: { type: 'note' } }
];

export const EMPTY_OR_NON_SCORING_LOG = [
  { undoData: { type: 'stat', statKey: 'reb', value: 4, isOpponent: false } },
  { undoData: { type: 'stat', statKey: 'fouls', value: 2, isOpponent: true } },
  { undoData: { type: 'note' } }
];

export const ZERO_VALUE_SCORING_LOG = [
  { undoData: { type: 'stat', statKey: 'PTS', value: 0, isOpponent: false } },
  { undoData: { type: 'stat', statKey: 'POINTS', value: '0', isOpponent: true } }
];
