# Architecture

Use a component-level derived result set so `computeAppSearchResults` remains the search source of truth and the UI applies only the transient role filter. Build `helpResults` from `results.help`, then build `flatResults` in display order from actions, teams, filtered help, and players. All offsets, bounds checks, arrow handling, Enter handling, and empty-state checks must reference the displayed result set.
