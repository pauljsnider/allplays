# Code plan

1. Replace the existing two-document pass-through test, whose mocked range is non-sequential, with a 20-document form submission using a sequential range.
2. Make one middle upload reject and verify the next upload keeps its preassigned order.
3. Make the document form require the multi-file reservation result to be complete and sequential before entering the helper loop; do not change photo or single-document behavior.
4. Assert malformed ranges invoke no helpers, the valid reservation precedes all helper invocations, and assigned orders are unique.
5. Run only the focused legacy Team Media form test and commit the source, test, and role artifacts.

The requested code session could not start because `sessions_spawn` returned `published reply runtime missing for main`; this artifact records the code-role plan completed by the main run.
