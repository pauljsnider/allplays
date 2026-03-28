## QA Role

Focus:
- Regression guardrail for the remaining duplicate-risk path after successful persistence.

Checks:
- Confirm the new helper exists and logs refresh failures as post-persist warnings.
- Confirm both partial-success and full-success paths call the helper.
- Re-run existing CSV helper tests to ensure parsing and preview behavior stays unchanged.

Residual risk:
- This does not make multi-row import atomic. It prevents refresh-only failures from being misreported as full import failure.
