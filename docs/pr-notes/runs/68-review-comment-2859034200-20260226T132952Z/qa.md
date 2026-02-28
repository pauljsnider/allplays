# Risk Matrix
- High: Admin invite acceptance regression (role assignment blocked).
- Medium: Incorrect email source precedence could alter existing successful paths.
- Low: Parent invite and manual code path regressions.

# Automated Tests To Add/Update
- None in repo currently for this page-level flow; no test harness exists for this exact path.

# Manual Test Plan
- Accept admin invite with profile email populated: success to `dashboard.html`.
- Accept admin invite with profile email absent but auth email present: success.
- Accept admin invite with profile/auth email absent and invite `data.email` present: success.
- Accept parent invite path unchanged.

# Negative Tests
- Invalid/expired code still errors.
- Admin invite where all email sources are empty still throws `Missing user email`.

# Release Gates
- Code diff limited to targeted fallback line.
- Basic syntax/parsing check passes for modified file.

# Post-Deploy Checks
- Spot-check one admin invite acceptance in production telemetry/logs.
- Verify no increase in invite failure errors for `Missing user email`.
