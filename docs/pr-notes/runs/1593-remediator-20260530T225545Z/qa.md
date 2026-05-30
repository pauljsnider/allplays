# QA

Add/update unit coverage so `loadPublicRegistrationDetail` succeeds when the form is readable but `getTeam` would reject. Assert the public loader does not call `getTeam`, derives `teamName` from the form, and still rejects unpublished/closed/archived forms.
