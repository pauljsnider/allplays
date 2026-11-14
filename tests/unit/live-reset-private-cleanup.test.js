import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { getLiveStatsEpoch } from '../../js/live-aggregate-stats.js';
import { persistLiveAggregateSnapshot, clearResetPrivateStats } from '../../js/live-aggregate-persistence.js';

const html = readFileSync('track-live.html', 'utf8');
const callbacks = [...html.matchAll(/cleanupPersistedState: async \(\) => \{([\s\S]*?)\n                    \},\n                    logWarn:/g)];
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
function cleanup(index, getDocs, deleteDoc, runTransaction, game = {liveResetEventId:'new'}) {
  const names = ['db','currentTeamId','currentGameId','collection','getDocs','deleteDoc','clearResetPrivateStats','runTransaction','doc','getLiveStatsEpoch','currentGame'];
  return new AsyncFunction(...names,callbacks[index][1])({},'t','g',(_db,path)=>({path}),getDocs,deleteDoc,clearResetPrivateStats,runTransaction,(_db,path)=>({path}),getLiveStatsEpoch,game);
}

describe('explicit track-live reset private cleanup', () => {
  it('extracts both actual reset and cancellation callbacks with private cleanup', () => {
    expect(callbacks).toHaveLength(2);
    for (const [,body] of callbacks) expect(body).toContain('/privatePlayerStats');
  });
  it.each([0, 1])('cleanup %s clears untagged private history so a new-epoch snapshot can save', async index => {
    const prefix = 'teams/t/games/g';
    const rows = new Map([[`${prefix}/privatePlayerStats/p`, {stats: {secret: 9}}]]);
    const game = {liveResetEventId: 'new'};
    const saved = [];
    const args = { db: {}, gameRef: {path: prefix}, statsRef: {path: `${prefix}/aggregatedStats/p`},
      privateRef: {path: `${prefix}/privatePlayerStats/p`}, expectedEpoch: 'id:new',
      payload: {stats: {pts: 2}}, privatePayload: {stats: {secret: 1}},
      runTransaction: async (_db, fn) => fn({get: async ref => ({data: () => ref.path === prefix ? game : rows.get(ref.path)}),
        set: (ref,data) => saved.push([ref.path,data]), delete: ref => rows.delete(ref.path)}) };
    await expect(persistLiveAggregateSnapshot(args)).rejects.toThrow('unknown reset epoch');
    expect(saved).toEqual([]);
    const getDocs = async ref => ({docs: [...rows.keys()].filter(path => path.startsWith(ref.path+'/')).map(path => ({ref:{path}}))});
    await cleanup(index,getDocs,async ref => rows.delete(ref.path),args.runTransaction,game);
    expect(rows.size).toBe(0);
    await persistLiveAggregateSnapshot(args);
    expect(saved).toEqual([[`${prefix}/aggregatedStats/p`,{stats:{pts:2},liveStatsVersion:1,liveStatsEpoch:'id:new'}],
      [`${prefix}/privatePlayerStats/p`,{stats:{secret:1},liveStatsVersion:1,liveStatsEpoch:'id:new'}]]);
  });
  it('does not reinterpret private history if cleanup is denied', async () => {
    const reads = [];
    await expect(cleanup(0, async ref => { reads.push(ref.path); if(ref.path.endsWith('/privatePlayerStats')) throw new Error('denied'); return {docs:[]}; },
      async () => {throw new Error('unexpected delete');})).rejects.toThrow('denied');
    expect(reads.some(path => path.endsWith('/privatePlayerStats'))).toBe(true);
  });
});

it.each([0,1])('cleanup %s preserves a fresh private save after reset publication', async index => {
  const path = 'teams/t/games/g/privatePlayerStats/p';
  const game = {liveResetEventId:'new'};
  let row = {stats:{secret:9}};
  const deleted = [];
  await cleanup(index,async ref => ({docs: ref.path.endsWith('/privatePlayerStats') ? [{ref:{path}}] : []}),
    async ref => deleted.push(ref.path), async (_db,fn) => {
      // A new save replaces the captured ID after query, before transactional reread.
      row = {stats:{secret:1},liveStatsVersion:1,liveStatsEpoch:'id:new'};
      return fn({get:async ref=>({data:()=>ref.path===path ? row : game}),delete:ref=>deleted.push(ref.path)});
    },game);
  expect(deleted).toEqual([]);
  expect(row.stats.secret).toBe(1);
});
it('refuses private cleanup after a second reset', async () => {
  let deleted = false;
  await expect(clearResetPrivateStats({db:{},gameRef:{path:'game'},privateRef:{path:'private'},expectedEpoch:'id:first',
    runTransaction:async (_db,fn)=>fn({get:async ref=>({data:()=>ref.path==='game'?{liveResetEventId:'second'}:{stats:{secret:9}}}),delete:()=>{deleted=true;}})})).rejects.toThrow('reset changed');
  expect(deleted).toBe(false);
});
