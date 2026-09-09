import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  setDoc,
  Timestamp,
  updateDoc,
} from "firebase/firestore";

const rules = readFileSync(
  new URL("../../firestore.rules", import.meta.url),
  "utf8",
);
const indexes = JSON.parse(
  readFileSync(
    new URL("../../firestore.indexes.json", import.meta.url),
    "utf8",
  ),
);

describe("Diamond Scorebook v2 Firestore boundary", () => {
  it("defines a server-authoritative game boundary and fail-closed policy schema", () => {
    expect(rules).toContain(
      "function isDiamondScorebookPolicyPayloadValid(data)",
    );
    expect(rules).toContain(
      "data.mode in ['disabled', 'internal', 'pilot', 'enabled']",
    );
    expect(rules).toContain("data.rolloutPercent in [1, 10, 50, 100]");
    expect(rules).toContain(
      "resource.data.get('trackingEngine', '') == 'diamond-v2'",
    );
    expect(rules).toContain("'diamondScorebookInstanceId'");
    expect(rules).toContain("'diamondStatConfigSnapshotHash'");
    expect(rules).toContain("'diamondProjectionCheckpointHash'");
    expect(rules).toContain("'diamondPublicTeamStats'");
    expect(rules).toContain("'aiRecap'");
    expect(rules).toMatch(
      /match \/diamondScorebooks\/\{document=\*\*\} \{\s*allow read, write: if false;/,
    );
    expect(rules).toMatch(
      /match \/diamondPublic\/\{document=\*\*\} \{\s*allow read, write: if false;/,
    );
    expect(rules).toMatch(
      /match \/diamondManagerStatReadControls\/\{controlId\} \{\s*allow read, write: if false;/,
    );
    expect(
      indexes.fieldOverrides.filter(
        (override) =>
          override.collectionGroup === "diamondManagerStatReadControls",
      ),
    ).toEqual([
      {
        collectionGroup: "diamondManagerStatReadControls",
        fieldPath: "*",
        indexes: [],
      },
      {
        collectionGroup: "diamondManagerStatReadControls",
        fieldPath: "expiresAt",
        ttl: true,
        indexes: [],
      },
    ]);
    expect(rules).toContain("match /diamondStatGenerations/{instanceId}");
    expect(rules).toContain("match /publicPlayerStats/{playerId}");
    expect(rules).toContain(
      "gameUsesDiamondGeneration(teamId, gameId, instanceId)",
    );
  });

  describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)(
    "rules-engine coverage",
    () => {
      let testEnv;

      beforeAll(async () => {
        testEnv = await initializeTestEnvironment({
          projectId: `allplays-diamond-scorebook-${Date.now()}`,
          firestore: { rules },
        });
      }, 30_000);

      beforeEach(async () => {
        await testEnv.clearFirestore();
        await testEnv.withSecurityRulesDisabled(async (context) => {
          const db = context.firestore();
          await setDoc(doc(db, "users/platform-admin"), { isAdmin: true });
          await setDoc(doc(db, "teams/team-a"), {
            ownerId: "owner-a",
            sport: "Baseball",
            active: true,
            adminEmails: [],
            isPublic: true,
          });
          const diamondSettings = {
            enabled: true,
            sport: "baseball",
            rulesProfileId: "baseball-youth",
            rulesProfileVersion: 1,
            captureMode: "quick",
          };
          await setDoc(doc(db, "teams/enrolled-team"), {
            ownerId: "owner-a",
            name: "Enrolled",
            sport: "Baseball",
            diamondScorebook: diamondSettings,
            adminEmails: [],
          });
          await setDoc(doc(db, "teams/mismatched-team"), {
            ownerId: "owner-a",
            name: "Needs repair",
            sport: "Soccer",
            diamondScorebook: diamondSettings,
            adminEmails: [],
          });
          await setDoc(doc(db, "teams/fastpitch-team"), {
            ownerId: "owner-a",
            name: "Fastpitch",
            sport: "Softball",
            diamondScorebook: {
              ...diamondSettings,
              sport: "fastpitch",
              rulesProfileId: "fastpitch-youth",
            },
            adminEmails: [],
          });
          await setDoc(doc(db, "teams/team-a/games/diamond-game"), {
            type: "game",
            status: "live",
            liveStatus: "live",
            trackingEngine: "diamond-v2",
            diamondScorebookInstanceId: "00000000-0000-4000-8000-000000000001",
            homeScore: 1,
            awayScore: 0,
            location: "Field A",
            diamondPublicTeamStats: { publicStatIds: ["r"], stats: { r: 1 } },
          });
          await setDoc(doc(db, "teams/team-a/games/legacy-game"), {
            type: "game",
            status: "live",
            liveStatus: "live",
            homeScore: 0,
            awayScore: 0,
          });
          await setDoc(
            doc(
              db,
              "teams/team-a/games/diamond-game/diamondStatGenerations/00000000-0000-4000-8000-000000000001/publicPlayerStats/current",
            ),
            {
              trackingEngine: "diamond-v2",
              teamId: "team-a",
              diamondGameId: "diamond-game",
              instanceId: "00000000-0000-4000-8000-000000000001",
              stats: { h: 1 },
            },
          );
          await setDoc(
            doc(
              db,
              "teams/team-a/games/diamond-game/diamondStatGenerations/00000000-0000-4000-8000-000000000099/publicPlayerStats/stale",
            ),
            {
              trackingEngine: "diamond-v2",
              teamId: "team-a",
              diamondGameId: "diamond-game",
              instanceId: "00000000-0000-4000-8000-000000000099",
              stats: { h: 99 },
            },
          );
          await setDoc(
            doc(
              db,
              "teams/team-a/games/legacy-game/diamondStatGenerations/00000000-0000-4000-8000-000000000098/publicPlayerStats/stale-diamond",
            ),
            {
              trackingEngine: "diamond-v2",
              teamId: "team-a",
              diamondGameId: "legacy-game",
              instanceId: "00000000-0000-4000-8000-000000000098",
              stats: { h: 98 },
            },
          );
          await setDoc(
            doc(db, "teams/team-a/games/legacy-game/aggregatedStats/classic"),
            { R: 1 },
          );
          await setDoc(
            doc(
              db,
              "teams/team-a/games/diamond-game/diamondStatGenerations/00000000-0000-4000-8000-000000000001/privatePlayerStats/p1",
            ),
            { stats: { h: 1 } },
          );
          await setDoc(
            doc(
              db,
              "teams/team-a/games/diamond-game/diamondStatGenerations/00000000-0000-4000-8000-000000000001/teamStats/team",
            ),
            { stats: { r: 1 } },
          );
          await setDoc(
            doc(db, "teams/team-a/games/diamond-game/privatePlayerStats/p1"),
            { stats: { h: 1 } },
          );
          await setDoc(
            doc(db, "teams/team-a/games/diamond-game/teamStats/team"),
            { stats: { r: 1 } },
          );
          await setDoc(
            doc(db, "teams/team-a/games/legacy-game/privatePlayerStats/p1"),
            { stats: { h: 1 } },
          );
          await setDoc(
            doc(db, "teams/team-a/games/legacy-game/teamStats/team"),
            { stats: { r: 1 } },
          );
          await setDoc(
            doc(db, "teams/team-a/games/diamond-game/diamondScorebooks/v2"),
            {
              revision: 1,
              scorerUid: "owner-a",
            },
          );
          await setDoc(
            doc(db, "teams/team-a/games/diamond-game/diamondPublic/state"),
            {
              revision: 1,
              homeScore: 1,
              awayScore: 0,
            },
          );
        });
      });

      afterAll(async () => testEnv?.cleanup());

      it("allows only a platform admin to manage a valid rollout policy", async () => {
        const ownerDb = testEnv.authenticatedContext("owner-a").firestore();
        const adminDb = testEnv
          .authenticatedContext("platform-admin")
          .firestore();
        const valid = {
          mode: "disabled",
          revision: 1,
          teamIds: [],
          updatedBy: "platform-admin",
          updatedAt: Timestamp.now(),
        };
        await assertFails(
          setDoc(doc(ownerDb, "securityPolicies/diamondScorebook"), valid),
        );
        await assertSucceeds(
          setDoc(doc(adminDb, "securityPolicies/diamondScorebook"), valid),
        );
        await assertFails(
          setDoc(doc(adminDb, "securityPolicies/diamondScorebook"), {
            ...valid,
            mode: "wide-open",
          }),
        );
        await assertFails(
          setDoc(doc(adminDb, "securityPolicies/diamondScorebook"), {
            ...valid,
            mode: "enabled",
          }),
        );
        await assertSucceeds(
          setDoc(doc(adminDb, "securityPolicies/diamondScorebook"), {
            ...valid,
            mode: "enabled",
            rolloutPercent: 10,
          }),
        );
        await assertFails(
          setDoc(doc(adminDb, "securityPolicies/diamondScorebook"), {
            ...valid,
            mode: "enabled",
            rolloutPercent: 5,
          }),
        );
        await assertFails(
          setDoc(doc(adminDb, "securityPolicies/diamondScorebook"), {
            ...valid,
            mode: "pilot",
            rolloutPercent: 10,
          }),
        );
      });

      it("denies every client operation on manager-stat and recap-source read controls", async () => {
        const controlIds = [
          "existing-manager-control",
          "recap-admission-hash",
          "recap-scope-hash",
        ];
        await testEnv.withSecurityRulesDisabled(async (context) => {
          for (const controlId of controlIds) {
            await setDoc(
              doc(
                context.firestore(),
                `diamondManagerStatReadControls/${controlId}`,
              ),
              { expiresAt: Timestamp.now() },
            );
          }
        });

        const contexts = [
          testEnv.unauthenticatedContext(),
          testEnv.authenticatedContext("owner-a"),
          testEnv.authenticatedContext("platform-admin"),
        ];
        for (const context of contexts) {
          const db = context.firestore();
          await assertFails(
            getDocs(collection(db, "diamondManagerStatReadControls")),
          );
          for (const controlId of controlIds) {
            const existing = doc(
              db,
              `diamondManagerStatReadControls/${controlId}`,
            );
            await assertFails(getDoc(existing));
            await assertFails(updateDoc(existing, { clientWrite: true }));
            await assertFails(deleteDoc(existing));
          }
          for (const controlId of [
            "client-created",
            "recap-admission-client-created",
            "recap-scope-client-created",
          ]) {
            await assertFails(
              setDoc(doc(db, `diamondManagerStatReadControls/${controlId}`), {
                expiresAt: Timestamp.now(),
              }),
            );
          }
        }
      });

      it("blocks legacy score and aggregate writes after the engine is claimed", async () => {
        const db = testEnv.authenticatedContext("owner-a").firestore();
        const game = doc(db, "teams/team-a/games/diamond-game");
        await assertFails(updateDoc(game, { homeScore: 2 }));
        await assertFails(
          updateDoc(game, {
            liveClockMs: 60_000,
            liveClockRunning: true,
            liveClockPeriod: "T1",
            liveClockUpdatedAt: Date.now(),
          }),
        );
        await assertFails(
          updateDoc(game, {
            liveLineup: { onCourt: ["p1"], bench: [] },
          }),
        );
        await assertFails(
          updateDoc(game, {
            liveResetAt: Timestamp.now(),
            liveResetEventId: "legacy-reset",
            servingTeam: "away",
          }),
        );
        await assertFails(
          setDoc(doc(db, "teams/team-a/games/diamond-game/events/e1"), {
            type: "run",
          }),
        );
        await assertFails(
          setDoc(
            doc(db, "teams/team-a/games/diamond-game/aggregatedStats/p1"),
            { R: 1 },
          ),
        );
        await assertFails(
          setDoc(
            doc(db, "teams/team-a/games/diamond-game/privatePlayerStats/p1"),
            { pitches: 10 },
          ),
        );
        await assertFails(
          setDoc(doc(db, "teams/team-a/games/diamond-game/liveEvents/e1"), {
            description: "run",
          }),
        );
        await assertFails(
          updateDoc(game, { statTrackerConfigId: "another-config" }),
        );
        const orientationMutations = [
          { isHome: false },
          { teamSide: "away" },
          { homeAway: "away" },
          { homeTeamId: "opponent-team" },
          { awayTeamId: "team-a" },
          { opponentTeamId: "opponent-team" },
        ];
        for (const mutation of orientationMutations) {
          await assertFails(updateDoc(game, mutation));
        }
        await assertFails(
          updateDoc(game, {
            aiRecap: { status: "published", text: "client-forged" },
          }),
        );
        await assertFails(
          updateDoc(game, {
            diamondPublicTeamStats: {
              publicStatIds: ["r", "h"],
              stats: { r: 2, h: 9 },
            },
          }),
        );
        await assertSucceeds(updateDoc(game, { location: "Field B" }));
      });

      it("exposes the server-owned public team subset to an authorized game reader", async () => {
        const ownerDb = testEnv.authenticatedContext("owner-a").firestore();
        const snapshot = await assertSucceeds(
          getDoc(doc(ownerDb, "teams/team-a/games/diamond-game")),
        );
        expect(snapshot.data()?.diamondPublicTeamStats).toEqual({
          publicStatIds: ["r"],
          stats: { r: 1 },
        });
      });

      it("preserves existing legacy game writers", async () => {
        const db = testEnv.authenticatedContext("owner-a").firestore();
        const legacyGame = doc(db, "teams/team-a/games/legacy-game");
        await assertSucceeds(
          updateDoc(legacyGame, {
            homeScore: 1,
          }),
        );
        await assertSucceeds(
          updateDoc(legacyGame, {
            statTrackerConfigId: "baseball-config",
          }),
        );
        const orientationMutations = [
          { isHome: false },
          { teamSide: "away" },
          { homeAway: "away" },
          { homeTeamId: "opponent-team" },
          { awayTeamId: "team-a" },
          { opponentTeamId: "opponent-team" },
        ];
        for (const mutation of orientationMutations) {
          await assertSucceeds(updateDoc(legacyGame, mutation));
        }
        await assertSucceeds(
          setDoc(doc(db, "teams/team-a/games/legacy-game/events/e1"), {
            type: "run",
          }),
        );
        await assertSucceeds(
          setDoc(doc(db, "teams/team-a/games/legacy-game/aggregatedStats/p1"), {
            R: 1,
          }),
        );
      });

      it("routes Diamond private stats through the callable while preserving legacy reads", async () => {
        const db = testEnv.authenticatedContext("owner-a").firestore();
        await assertFails(
          getDoc(
            doc(
              db,
              "teams/team-a/games/diamond-game/diamondStatGenerations/00000000-0000-4000-8000-000000000001/privatePlayerStats/p1",
            ),
          ),
        );
        await assertFails(
          getDoc(
            doc(
              db,
              "teams/team-a/games/diamond-game/diamondStatGenerations/00000000-0000-4000-8000-000000000001/teamStats/team",
            ),
          ),
        );
        await assertFails(
          getDoc(
            doc(db, "teams/team-a/games/diamond-game/privatePlayerStats/p1"),
          ),
        );
        await assertFails(
          getDoc(doc(db, "teams/team-a/games/diamond-game/teamStats/team")),
        );
        await assertSucceeds(
          getDoc(
            doc(db, "teams/team-a/games/legacy-game/privatePlayerStats/p1"),
          ),
        );
        await assertSucceeds(
          getDoc(doc(db, "teams/team-a/games/legacy-game/teamStats/team")),
        );
      });

      it("fences stale Diamond stats across current and recreated game generations", async () => {
        const db = testEnv.authenticatedContext("owner-a").firestore();
        await assertSucceeds(
          getDoc(
            doc(
              db,
              "teams/team-a/games/diamond-game/diamondStatGenerations/00000000-0000-4000-8000-000000000001/publicPlayerStats/current",
            ),
          ),
        );
        await assertFails(
          getDoc(
            doc(
              db,
              "teams/team-a/games/diamond-game/diamondStatGenerations/00000000-0000-4000-8000-000000000099/publicPlayerStats/stale",
            ),
          ),
        );
        const recreatedStale = doc(
          db,
          "teams/team-a/games/legacy-game/diamondStatGenerations/00000000-0000-4000-8000-000000000098/publicPlayerStats/stale-diamond",
        );
        await assertFails(getDoc(recreatedStale));
        await assertFails(updateDoc(recreatedStale, { stats: { h: 100 } }));
        await assertFails(deleteDoc(recreatedStale));
        await assertFails(
          setDoc(
            doc(
              db,
              "teams/team-a/games/diamond-game/diamondStatGenerations/00000000-0000-4000-8000-000000000001/publicPlayerStats/forged-diamond",
            ),
            {
              trackingEngine: "diamond-v2",
              instanceId: "00000000-0000-4000-8000-000000000098",
              stats: { h: 1 },
            },
          ),
        );
        await assertSucceeds(
          getDocs(
            collection(
              db,
              "teams/team-a/games/diamond-game/diamondStatGenerations/00000000-0000-4000-8000-000000000001/publicPlayerStats",
            ),
          ),
        );
        await assertFails(
          getDocs(
            collection(
              db,
              "teams/team-a/games/diamond-game/diamondStatGenerations/00000000-0000-4000-8000-000000000099/publicPlayerStats",
            ),
          ),
        );
        await assertFails(
          getDocs(
            collection(
              db,
              "teams/team-a/games/legacy-game/diamondStatGenerations/00000000-0000-4000-8000-000000000098/publicPlayerStats",
            ),
          ),
        );
        await assertSucceeds(
          getDoc(
            doc(db, "teams/team-a/games/legacy-game/aggregatedStats/classic"),
          ),
        );
        await assertSucceeds(
          updateDoc(
            doc(db, "teams/team-a/games/legacy-game/aggregatedStats/classic"),
            { R: 2 },
          ),
        );
      });

      it("prevents a client from claiming the engine on game creation or update", async () => {
        const db = testEnv.authenticatedContext("owner-a").firestore();
        await assertFails(
          setDoc(doc(db, "teams/team-a/games/client-claim"), {
            type: "game",
            status: "scheduled",
            trackingEngine: "diamond-v2",
          }),
        );
        await assertFails(
          setDoc(doc(db, "teams/team-a/games/client-marker"), {
            type: "game",
            status: "scheduled",
            diamondScorebookInstanceId: "forged-generation",
          }),
        );
        await assertFails(
          updateDoc(doc(db, "teams/team-a/games/legacy-game"), {
            trackingEngine: "diamond-v2",
          }),
        );
        await assertFails(
          updateDoc(doc(db, "teams/team-a/games/legacy-game"), {
            diamondProjectionRevision: 1,
          }),
        );
      });

      it("keeps the team opt-in server-authoritative", async () => {
        const db = testEnv.authenticatedContext("owner-a").firestore();
        await assertFails(
          updateDoc(doc(db, "teams/team-a"), {
            diamondScorebook: {
              enabled: true,
              sport: "baseball",
              rulesProfileId: "baseball-youth",
              rulesProfileVersion: 1,
              captureMode: "quick",
            },
          }),
        );
        await assertFails(
          setDoc(doc(db, "teams/client-configured-team"), {
            ownerId: "owner-a",
            sport: "Baseball",
            diamondScorebook: {
              enabled: true,
              sport: "baseball",
              rulesProfileId: "baseball-youth",
              rulesProfileVersion: 1,
              captureMode: "quick",
            },
          }),
        );
      });

      it("prevents stale or direct sport changes from invalidating an enrolled Diamond team", async () => {
        const db = testEnv.authenticatedContext("owner-a").firestore();
        const enrolledTeam = doc(db, "teams/enrolled-team");
        const mismatchedTeam = doc(db, "teams/mismatched-team");
        const fastpitchTeam = doc(db, "teams/fastpitch-team");

        await assertSucceeds(updateDoc(enrolledTeam, { name: "Enrolled renamed" }));
        await assertSucceeds(updateDoc(enrolledTeam, { sport: "baseball" }));
        await assertFails(updateDoc(enrolledTeam, { sport: "Soccer" }));
        await assertFails(updateDoc(enrolledTeam, {
          sport: "",
          sportType: "Soccer",
          activity: "Soccer",
        }));
        await assertFails(updateDoc(enrolledTeam, {
          sport: "",
          sportType: "",
          activity: "Soccer",
        }));

        await assertSucceeds(updateDoc(mismatchedTeam, { name: "Repair pending" }));
        await assertFails(updateDoc(mismatchedTeam, { sport: "Basketball" }));
        await assertSucceeds(updateDoc(mismatchedTeam, { sport: "Baseball" }));

        await assertSucceeds(updateDoc(fastpitchTeam, { sport: "Fastpitch-Softball" }));
        await assertFails(updateDoc(fastpitchTeam, { sport: "Baseball" }));
      });

      it("keeps canonical, private-note, audit, and public projection documents behind callables", async () => {
        const ownerDb = testEnv.authenticatedContext("owner-a").firestore();
        const publicDb = testEnv.unauthenticatedContext().firestore();
        const canonical =
          "teams/team-a/games/diamond-game/diamondScorebooks/v2";
        const projection =
          "teams/team-a/games/diamond-game/diamondPublic/state";
        await assertFails(getDoc(doc(ownerDb, canonical)));
        await assertFails(getDoc(doc(publicDb, projection)));
        await assertFails(
          setDoc(doc(ownerDb, `${canonical}/notes/n1`), {
            transcript: "private",
          }),
        );
        await assertFails(
          setDoc(doc(ownerDb, `${canonical}/events/e2`), { revision: 2 }),
        );
      });
    },
  );
});
