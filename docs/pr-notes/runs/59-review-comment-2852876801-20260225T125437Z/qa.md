# QA Role Notes

## Target Regression
Save & Complete should keep unload/back warnings active until database write completion.

## Manual Validation Matrix
1. Start tracked game so `state.clock > 0`.
2. Trigger Save & Complete with throttled network (Slow 3G).
3. Attempt tab close/back before save resolves.
4. Expect warning prompt while write pending.
5. Allow save to complete and redirect.
6. Expect no warning loop post-success navigation.

## Guardrails
- Verify error path still re-enables Save button and preserves warnings.
- Verify duplicate submissions remain prevented by existing single-flight lock.
