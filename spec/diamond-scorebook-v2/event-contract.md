# Canonical Event and API Contract

## Documents

The game parent contains the routing discriminator and only bounded public
status fields. Canonical state lives beneath:

```text
teams/{teamId}/games/{gameId}/diamondScorebooks/v2
  events/{eventId}
  commands/{commandId}
  notes/{noteId}
  audit/{auditId}
  projections/{projectionId}
```

`events`, `commands`, `notes`, `audit`, and private projections are denied to all
direct client writes. Public state and public replay events are server-owned,
allowlisted projections stored separately from private canonical data.

## Command envelope

```ts
type DiamondCommand<TType extends DiamondCommandType> = {
  schemaVersion: 2;
  commandId: string;          // cryptographically random UUID
  teamId: string;
  gameId: string;
  expectedRevision: number;
  rulesProfileId: string;
  rulesProfileVersion: number;
  type: TType;
  payload: DiamondCommandPayload[TType];
};

type DiamondCommandResult = {
  outcome: "accepted" | "duplicate" | "rejected";
  revision: number;
  eventId?: string;
  state: DiamondPublicState;
  rejection?: { code: string; message: string; retryable: boolean };
};
```

The server derives actor and timestamps from the authenticated request. It stores
a canonical hash of the validated command. Reusing `commandId` with the same
hash returns the original result; a different hash is rejected.

## Command families

- Lifecycle: activate, start, suspend, resume, finalize, reopen-for-correction.
- Roster: set lineup, set defensive alignment, substitute, re-enter, set DP/FLEX,
  add courtesy runner, scorer handoff.
- Pitch: ball, called/swinging strike, foul, foul bunt, in-play, hit-by-pitch,
  catcher interference, illegal pitch/balk, pickoff attempt.
- Plate appearance: single, double, triple, home run, walk/intentional walk,
  strikeout, reached-on-error, fielder's choice, sacrifice bunt/fly, interference,
  dropped third strike, double/triple play.
- Runner: advance, score, steal, caught stealing, picked off, force/tag/appeal out,
  defensive indifference, wild pitch, passed ball, error, obstruction.
- Scoring: credit hit/error, RBI exclusion, earned/unearned responsibility,
  putout/assist/error chain, pitcher-of-record judgment.
- Administration: private note, rules decision, supersede event, void event.

Complex plays are one atomic command containing the plate-appearance result and
independent outcomes for every affected runner. The reducer either accepts the
whole transition or none of it.

## Event envelope

An accepted command appends one immutable event containing server sequence,
revision, command hash, actor UID, rules/catalog/reducer versions, complete
before/after state, normalized scorer judgments, and optional
`supersedesEventId`/`voidsEventId`. The projection checkpoint includes a stable
hash so replay-from-zero must equal the current state.

State stores innings pitched as integer outs. Display conversion to `4.2` occurs
only at the presentation boundary.

## Server interfaces

- `configureDiamondTeam` creates or updates explicit team opt-in and selected
  versioned profile.
- `activateDiamondGame` transactionally validates eligibility and claims the
  engine.
- `submitDiamondCommand` validates and appends one command/event revision.
- `getDiamondState` returns authorized private state or sanitized public state.
- `listDiamondEvents` returns a bounded page plus cursor, completion, revision,
  and truncation evidence.
- `parseDiamondVoice` returns a non-mutating command proposal.
- `regenerateDiamondProjection` is manager/admin recovery and emits no live
  notifications.

Every interface validates nonempty slash-free IDs, bounded strings/arrays,
supported schema versions, authorization, active-team state, game identity, and
engine ownership before reading or mutating canonical data.

