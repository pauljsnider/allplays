# Architecture

Decision: hydrate upload-grant arrays at auth boundaries, keeping `canContributeTeamMedia` pure and synchronous.

- Legacy web copies sanitized `teamMediaUploadTeamIds` and `mediaUploadTeamIds` from `users/{uid}` profile onto the auth user.
- App `AuthUser` includes the same optional arrays and `toAuthUser` filters them to strings.
- Firestore and Storage rules remain authoritative. Client state only controls upload affordance visibility.
- No data migration or extra team-media reads are required.
