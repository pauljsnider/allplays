# QA role notes
Manual checks for changed flow:
1. Create team with pending admin email where invite code is missing -> no email send attempt, fallback/manual follow-up reported.
2. Click Save twice scenario after successful pending invite processing -> second submit has no duplicate pending invite attempts.
3. Existing user invite in new-team path with code -> code/link appears in follow-up prompt.
4. Existing user invite without code -> unresolved follow-up alert count increments.
