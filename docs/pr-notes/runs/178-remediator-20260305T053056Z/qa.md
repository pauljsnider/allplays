# QA Role Notes
- Manual checks:
  1. Completed home game still computes same W/L/PF/PA as before.
  2. Completed away game (`isHome: false`) now maps current team as away and preserves score orientation.
  3. Standings row for current team reflects expected record after including away games.
- Regression focus: ensure games without `isHome` keep prior behavior (team treated as home fallback).
