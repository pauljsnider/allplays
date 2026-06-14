# Baseball and Softball Support Requirements

## Introduction

Add first-class baseball and softball support for newly created teams. The first release should feel native across team setup, stat templates, game tracking, live viewing, game planning, and practice planning while staying passive enough for a parent or coach to use from the sideline.

The feature intentionally avoids full pitch-by-pitch scoring. Users should be able to record inning-level context, runs, simple hitting stats, and basic fielding plays without needing to document every pitch, count, or substitution in real time.

## User Stories

- **US-1:** As a coach creating a new baseball or softball team, I want the correct sport option and a default stat template so that I can schedule and track games without manual config setup.
- **US-2:** As a scorekeeper, I want a passive baseball/softball tracker so that I can record key offensive and fielding outcomes without managing pitch counts.
- **US-3:** As a family member watching a live game, I want innings and baseball/softball stats to appear correctly so that the live view makes sense for the sport.
- **US-4:** As a coach planning a game, I want baseball and softball field templates plus batting order planning so that I can prepare defense and lineup together.
- **US-5:** As a coach planning practice, I want baseball/softball drill categories and starter templates so that practice planning starts from sport-relevant work.

## Requirements

### 1. New-Team Sport Setup

1.1 The system shall list `Baseball` and `Softball` as selectable sports when creating a new team.

1.2 When a new baseball team is created, the system shall auto-create a default stat tracker config named `Baseball Standard`.

1.3 When a new softball team is created, the system shall auto-create a default stat tracker config named `Softball Standard`.

1.4 The default baseball and softball configs shall include offensive and fielding columns suitable for passive tracking.

1.5 The system shall not attempt to migrate existing baseball or softball teams in this release.

### 2. Stat Templates

2.1 The baseball and softball templates shall support core hitting stats: `AB`, `H`, `R`, `RBI`, and `BB`.

2.2 The baseball and softball templates shall support at least one fielding-play stat so a scorekeeper can capture defensive contribution without full scorebook detail.

2.3 The templates shall use the same stat config storage model as the existing basketball and soccer templates.

2.4 The edit-config page shall provide quick templates for baseball and softball.

### 3. Passive Game Tracking

3.1 The standard game tracker shall load baseball and softball stat configs without routing users into basketball-specific beta/photo trackers.

3.2 The live tracker shall use inning period labels for baseball and softball: `T1/B1` through `T7/B7`.

3.3 Baseball and softball tracking shall avoid required pitch-by-pitch input, ball/strike counts, or pitch sequencing.

3.4 The system shall allow users to record team/player stats and final scores using existing save/complete flows.

3.5 Fielding play capture shall be available through the configured stat columns rather than a full defensive scoring workflow.

### 4. Live Game Viewing

4.1 Live game display shall show inning labels instead of basketball quarter labels for baseball and softball.

4.2 Live event descriptions and stat tables shall use the configured baseball/softball columns.

4.3 Replay and live status flows shall continue to work with baseball/softball games using the existing live event model.

### 5. Game Planning

5.1 Game planning shall include a `Baseball 9` formation with standard defensive positions.

5.2 Game planning shall include a `Softball 10` formation with a tenth fielder position.

5.3 Baseball and softball game plans shall support 7 innings by default.

5.4 Baseball and softball game plans shall include batting order planning in addition to defensive position assignments.

5.5 Batting order planning shall be persisted with the game plan data.

### 6. Practice Planning

6.1 The drill taxonomy shall include baseball and softball skill categories.

6.2 Practice planning shall expose baseball/softball starter drill templates.

6.3 Baseball/softball practice drill support shall use the existing drill schema and team sport filtering.

6.4 Starter templates shall prioritize youth-coach friendly drills that are easy to run without specialized equipment.

## Out of Scope

- Existing team migration.
- Full pitch-by-pitch scorekeeping.
- Pitch count management.
- Umpire/scorebook rule adjudication.
- Advanced baseball analytics.
- League-specific lineup legality enforcement.

