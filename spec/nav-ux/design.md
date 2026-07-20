# Primary Navigation UX Design

## Navigation model

Desktop keeps the complete sidebar because width and labels make all seven destinations scannable. Mobile uses a five-item bottom bar:

1. Home
2. Schedule
3. Messages
4. My Teams
5. More

More opens a focused bottom sheet with Profile, Family, and Discover. Each row contains an icon, destination name, short purpose statement, and current-page treatment. This keeps frequent tasks one tap away while making lower-frequency destinations explicit instead of truncating six labels or hiding Family inside settings.

## Screen rules

- Page headers use the existing `app-card` language and one `h1`.
- Page components live inside the shell's `main` landmark.
- Route-changing controls use links and `aria-current`.
- Same-page view switches use tab semantics.
- Error states explain what failed and provide Retry.
- Empty states pair guidance with the next available action.
- Primary interactive targets use a 44px minimum.

## Responsive behavior

- 320–767px: five bottom destinations, icon plus short label, More bottom sheet.
- Desktop shell: existing complete sidebar remains unchanged.
- More is not used for signed-out visitors because their three-item public navigation already fits.

## Non-goals

- No data schema, Firebase rule, role, or permission changes.
- No route renames.
- No redesign of team detail, schedule event detail, chat detail, or individual Family panels.
- No changes to public listing trust or moderation behavior.
