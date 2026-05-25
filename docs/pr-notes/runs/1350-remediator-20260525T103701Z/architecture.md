# Architecture

Decisions:
- Keep submitOfflineRegistration as the authoritative registration creation boundary.
- After submit, derive checkout amount from result.registration.feeSnapshot or result.feeSnapshot before client fallback.
- Wrap checkout creation/opening in its own try/catch so post-registration payment failures get specific guidance.
- Normalize selected option ID to empty only for option-less forms that do not require options.
