# Architecture

Use the registration form document as the public boundary. `loadPublicRegistrationDetail` should read `teams/{teamId}/registrationForms/{formId}` directly, normalize it, validate published/open state, and derive display fields from form data with safe fallbacks. Do not call `getTeam(teamId)` in the anonymous public path.
