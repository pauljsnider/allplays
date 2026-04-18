## Minimal Patch Plan

1. In `track.html`, normalize `gameState.playerStats[player.id]` into a lowercase lookup map before building `normalizedStats`.
2. Fill configured columns from that lowercase map so persisted keys always match the lowercase schema, even if in-memory stats arrived as `PTS`, `ReB`, etc.
3. Preserve unexpected non-config stats, but only when neither the original key nor its lowercase equivalent is already represented, to avoid duplicate case variants.
4. Mirror the same normalization logic in `test-track-zero-stat-player-history.js` and add a regression for mixed-case source keys.

## Concrete Changes

```diff
--- track.html
+++ track.html
@@
 players.forEach((player) => {
     const playerStats = gameState.playerStats[player.id] || {};
+    const playerStatsByLowerKey = {};
     const normalizedStats = {};
 
+    Object.entries(playerStats).forEach(([statKey, value]) => {
+        playerStatsByLowerKey[String(statKey).toLowerCase()] = Number(value) || 0;
+    });
+
     currentConfig.columns.forEach((col) => {
         const key = String(col || '').toLowerCase();
-        normalizedStats[key] = Number(playerStats[key]) || 0;
+        normalizedStats[key] = Object.prototype.hasOwnProperty.call(playerStatsByLowerKey, key)
+            ? playerStatsByLowerKey[key]
+            : 0;
     });
 
     Object.entries(playerStats).forEach(([statKey, value]) => {
-        if (normalizedStats[statKey] === undefined) {
+        const normalizedKey = String(statKey).toLowerCase();
+        if (normalizedStats[statKey] === undefined && normalizedStats[normalizedKey] === undefined) {
             normalizedStats[statKey] = Number(value) || 0;
         }
     });
 });
```

```diff
--- test-track-zero-stat-player-history.js
+++ test-track-zero-stat-player-history.js
@@
 function buildAggregatedStatsWrites(players, columns, playerStatsById) {
     return players.map((player) => {
         const playerStats = playerStatsById[player.id] || {};
+        const playerStatsByLowerKey = {};
         const normalizedStats = {};
 
+        Object.entries(playerStats).forEach(([statKey, value]) => {
+            playerStatsByLowerKey[String(statKey).toLowerCase()] = Number(value) || 0;
+        });
+
         columns.forEach((col) => {
             const key = String(col || '').toLowerCase();
-            normalizedStats[key] = Number(playerStats[key]) || 0;
+            normalizedStats[key] = Object.prototype.hasOwnProperty.call(playerStatsByLowerKey, key)
+                ? playerStatsByLowerKey[key]
+                : 0;
         });
 
         Object.entries(playerStats).forEach(([statKey, value]) => {
-            if (normalizedStats[statKey] === undefined) {
+            const normalizedKey = String(statKey).toLowerCase();
+            if (normalizedStats[statKey] === undefined && normalizedStats[normalizedKey] === undefined) {
                 normalizedStats[statKey] = Number(value) || 0;
             }
         });
@@
+test('mixed-case configured stat keys are normalized without losing values', () => {
+    const writes = buildAggregatedStatsWrites(
+        [{ id: 'player-a', name: 'Player A', number: '12' }],
+        ['PTS', 'REB', 'AST'],
+        {
+            'player-a': { PTS: 8, ReB: 5, ast: 2 }
+        }
+    );
+
+    assertDeepEquals(
+        writes[0].data.stats,
+        { pts: 8, reb: 5, ast: 2 },
+        'Configured stat values should survive mixed-case source keys without duplicate variants'
+    );
+});
```

## Validation Commands

```bash
cd /tmp/allplays-pr557
node test-track-zero-stat-player-history.js
```

Ran in the repo, result:

```text
PASS writes one aggregated stats doc per rostered player
PASS zero-stat players get zeroed configured stats
PASS mixed-case configured stat keys are normalized without losing values
PASS existing non-config stat keys are preserved
All 4 tests passed.
```

## Notes

- The critical bug is real: mixed-case in-memory keys cause configured stats to persist as zeroed lowercase fields plus duplicate uppercase/mixed-case extras.
- This patch is minimal and backward-compatible. It fixes configured stat persistence without stripping unexpected non-config stats like `blocks`.
- The current local diff in `/tmp/allplays-pr557` already matches this plan and passes the targeted harness.
