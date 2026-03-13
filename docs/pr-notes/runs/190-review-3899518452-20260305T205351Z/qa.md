# QA role

## Regression checks
- Syntax validation for cloud function file passes.
- Manual code inspection confirms three findings are directly remediated.

## High-risk scenarios to verify in staging
- Profile-email spoof attempt does not add unauthorized recipient.
- Team with >500 notification devices receives pushes across chunks.
- Image-only team chat message triggers notification body fallback.

## Residual risk
- No automated function-level unit harness exists in this repo snapshot for trigger simulation.
