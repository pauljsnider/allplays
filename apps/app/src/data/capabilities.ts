import type { Capability, CapabilityCategory, MigrationStatus, UserRole } from '../lib/types';

const allRoles: UserRole[] = ['parent', 'coach', 'admin', 'platformAdmin'];
const staffRoles: UserRole[] = ['coach', 'admin', 'platformAdmin'];
const parentRoles: UserRole[] = ['parent', 'coach', 'admin', 'platformAdmin'];
const adminRoles: UserRole[] = ['admin', 'platformAdmin'];

function capability(
  id: string,
  title: string,
  legacyPath: string,
  category: CapabilityCategory,
  summary: string,
  features: string[],
  route = '/capabilities/' + id,
  status: MigrationStatus = 'legacy-link',
  roles: UserRole[] = allRoles
): Capability {
  return { id, title, legacyPath, category, roles, route, status, summary, features };
}

export const capabilities: Capability[] = [
  capability('home-entry', 'Homepage and product entry', 'index.html', 'Entry', 'Public product entry with live games, upcoming games, recent replays, and navigation.', ['Homepage', 'Product entry', 'Live games', 'Upcoming games', 'Recent replays', 'Navigation']),
  capability('login', 'Login and signup', 'login.html', 'Auth', 'Sign in, sign up, Google auth, activation code, and password reset entry.', ['Sign in', 'Sign up', 'Google auth', 'Activation code', 'Password reset']),
  capability('accept-invite', 'Accept invite', 'accept-invite.html', 'Auth', 'Invite redemption, invite code entry, account linking, and role-based redirect.', ['Invite redemption', 'Invite code entry', 'Account linking', 'Role redirect']),
  capability('reset-password', 'Reset password', 'reset-password.html', 'Auth', 'Password reset and account action handling.', ['Password reset', 'Account actions', 'Login redirect']),
  capability('verify-pending', 'Email verification', 'verify-pending.html', 'Auth', 'Email verification status, resend verification, and continue to dashboard.', ['Verification status', 'Resend email', 'Continue to dashboard']),
  capability('profile', 'Account profile', 'profile.html', 'Account', 'Account profile, email verification, notification preferences, and settings.', ['Profile photo', 'Email verification', 'Notification preferences', 'Account settings'], '/profile', 'native-shell'),

  capability('dashboard', 'My Teams dashboard', 'dashboard.html', 'Teams', 'My teams, create team, manage teams, unread chat counts, and role routing.', ['My teams', 'Create team', 'Manage teams', 'Unread chat counts', 'Role routing'], '/teams', 'native-shell', parentRoles),
  capability('parent-dashboard', 'Parent dashboard', 'parent-dashboard.html', 'Parent', 'Linked players, linked teams, RSVP, rideshare, fees, practice attendance, and home packets.', ['Linked players', 'Linked teams', 'RSVP', 'Rideshare', 'Team fees', 'Practice attendance', 'Home packets'], '/home', 'native-shell', parentRoles),
  capability('teams-browse', 'Browse teams', 'teams.html', 'Teams', 'Browse public teams, team discovery, and search.', ['Public teams', 'Discovery', 'Search'], '/teams/browse', 'native-shell'),
  capability('team-overview', 'Team overview', 'team.html', 'Teams', 'Team overview with roster, schedule, RSVP, standings, leaderboards, team pass, tracking summaries, and sponsor links.', ['Team info', 'Roster', 'Schedule', 'RSVP', 'Standings', 'Leaderboards', 'Team pass', 'Tracking summaries', 'Sponsor links'], '/teams/team-bears', 'native-shell', parentRoles),
  capability('calendar', 'Global calendar', 'calendar.html', 'Schedule', 'Global calendar with team filters, event filters, RSVP, ICS export, and external events.', ['Team filters', 'Event filters', 'RSVP', 'ICS export', 'External calendar events'], '/schedule', 'native-shell', parentRoles),
  capability('messages', 'Messages list', 'messages.html', 'Communication', 'Team chat list, unread messages, and quick chat access.', ['Team chat list', 'Unread messages', 'Quick chat access'], '/messages', 'native-shell', parentRoles),
  capability('team-chat', 'Team chat', 'team-chat.html', 'Communication', 'Team chat with conversations, AI assistant mention, attachments, reactions, edit/delete, and moderation.', ['Conversations', 'AI assistant mention', 'Attachments', 'Reactions', 'Edit/delete messages', 'Moderation'], '/messages/team-bears', 'native-shell', parentRoles),

  capability('admin', 'Platform admin dashboard', 'admin.html', 'Admin', 'Platform stats, teams admin, users admin, games admin, and access controls.', ['Platform stats', 'Teams admin', 'Users admin', 'Games admin', 'Access controls'], undefined, 'legacy-link', adminRoles),
  capability('check-admin-status', 'Admin entitlement check', 'check-admin-status.html', 'Admin', 'Admin entitlement check and current auth state.', ['Admin entitlement check', 'Auth state'], undefined, 'legacy-link', adminRoles),
  capability('edit-team', 'Team settings', 'edit-team.html', 'Teams', 'Legacy team settings shell with native staff/admin management and invite sharing now available in the app.', ['Team settings', 'Sport', 'Visibility', 'League link', 'Livestream link', 'ZIP', 'Staff/admin management', 'Native invite sharing', 'Registration setup'], undefined, 'stub', staffRoles),
  capability('edit-roster', 'Roster management', 'edit-roster.html', 'Roster', 'Add/edit players, review team staff access, deactivate/reactivate, parent invites, custom fields, AI import, registration sync, printable roster options, and tracking statuses.', ['Add players', 'Edit players', 'Staff visibility', 'Deactivate/reactivate', 'Parent invites', 'Custom fields', 'AI roster import', 'Registration sync', 'Printable roster', 'Tracking statuses'], undefined, 'stub', staffRoles),
  capability('edit-schedule', 'Schedule management', 'edit-schedule.html', 'Schedule', 'Games, practices, recurring events, calendar import, reminders, cancellations, officials, tournament tools, and tracker launch.', ['Games', 'Practices', 'Recurring events', 'Calendar import', 'RSVP reminders', 'Cancellations', 'Officials', 'Tournament tools', 'Tracker launch'], undefined, 'stub', staffRoles),
  capability('edit-config', 'Stat configuration', 'edit-config.html', 'Tracking', 'Stat configs, tracker columns, sport presets, and access checks.', ['Stat configs', 'Tracker columns', 'Sport presets', 'Access checks'], undefined, 'stub', staffRoles),
  capability('tracking-items', 'Tracking item setup', 'tracking-items.html', 'Roster', 'Tracking item setup, roster tracking statuses, and admin tracking controls.', ['Tracking setup', 'Roster statuses', 'Admin controls'], undefined, 'stub', staffRoles),
  capability('team-fees', 'Team fees', 'team-fees.html', 'Fees', 'Simple fee creation, recipient balances, Stripe checkout link sharing, parent fee visibility, offline payments, refunds, adjustments, and cancellations.', ['Fee creation', 'Recipient balances', 'Stripe checkout links', 'Native share sheet', 'Parent fee visibility', 'Offline payments', 'Refunds', 'Adjustments', 'Cancellations'], '/teams/team-bears/fees', 'native-shell', staffRoles),
  capability('team-media', 'Team media', 'team-media.html', 'Media', 'Albums, uploads, video links, visibility controls, covers, and bulk moderation.', ['Albums', 'Photo uploads', 'File uploads', 'Video links', 'Visibility controls', 'Album covers', 'Bulk move/delete'], undefined, 'stub', parentRoles),
  capability('registration', 'Public registration', 'registration.html', 'Registration', 'Public registration options, participant details, guardian details, waivers, fees, payment plans, and waitlist.', ['Registration options', 'Participant details', 'Guardian details', 'Waivers', 'Fees', 'Payment plans', 'Waitlist']),
  capability('organization-schedule', 'Organization schedule', 'organization-schedule.html', 'Schedule', 'Shared matchups, venue availability, blackouts, bulk CSV import, draft generation, and venues.', ['Shared matchups', 'Venue availability', 'Blackouts', 'CSV import', 'Draft generation', 'Organization venues'], undefined, 'future', staffRoles),
  capability('officials', 'Officials assignments', 'officials.html', 'Schedule', 'Upcoming assignments, accept/decline assignments, and claim open slots.', ['Upcoming assignments', 'Accept/decline', 'Claim open slots'], undefined, 'future', staffRoles),
  capability('drills', 'Practice command center', 'drills.html', 'Game Day', 'Drill library, team drills, favorites, AI coach, practice timeline, attendance, notes, and home packets.', ['Drill library', 'Team drills', 'Favorites', 'AI coach', 'Practice timeline', 'Attendance', 'Notes', 'Home packets'], '/teams/team-bears/drills', 'native-shell', staffRoles),
  capability('game-plan', 'Game planning', 'game-plan.html', 'Game Day', 'Lineup planning, autosave, and game-day handoff from the app game hub.', ['Game planning', 'Lineup planning', 'Autosave', 'Game-day handoff'], '/schedule', 'native-shell', staffRoles),
  capability('game-day', 'Game day command center', 'game-day.html', 'Game Day', 'RSVP breakdown, lineup builder, AI lineup, substitutions, live logs, wrap-up, AI analysis, and practice feed.', ['RSVP breakdown', 'Lineup builder', 'AI lineup', 'Substitutions', 'Live logs', 'Score wrap-up', 'AI analysis', 'Practice feed'], '/schedule', 'native-shell', staffRoles),

  capability('track-standard', 'Standard game tracker', 'track.html', 'Tracking', 'Stat entry, timer, opponent stats, undo, AI summary, email recap, and finish flow.', ['Stat entry', 'Timer', 'Opponent stats', 'Undo', 'AI summary', 'Email recap', 'Finish flow'], undefined, 'stub', staffRoles),
  capability('track-live', 'Live broadcast tracker', 'track-live.html', 'Tracking', 'Live scorekeeping, chat, game log, notes, and replay data.', ['Live scorekeeping', 'Chat', 'Game log', 'Notes', 'Replay data'], '/schedule', 'native-shell', staffRoles),
  capability('live-tracker', 'Basketball live tracker', 'live-tracker.html', 'Tracking', 'Clock, lineup, substitutions, fouls, opponent stats, and finish flow.', ['Clock', 'Lineup', 'Substitutions', 'Fouls', 'Opponent stats', 'Finish flow'], undefined, 'stub', staffRoles),
  capability('track-basketball', 'Basketball sideline tracker', 'track-basketball.html', 'Tracking', 'Starting lineup, substitutions, photos, queue mode, stats, and save complete.', ['Starting lineup', 'Substitutions', 'Player photos', 'Queue mode', 'Stats', 'Save complete'], undefined, 'stub', staffRoles),
  capability('track-statsheet', 'Statsheet import', 'track-statsheet.html', 'Tracking', 'Photo statsheet import, score sheet mapping, stat review, and apply stats.', ['Photo import', 'Score sheet mapping', 'Stat review', 'Apply stats'], '/schedule', 'native-shell', staffRoles),
  capability('live-game', 'Live game viewer', 'live-game.html', 'Public', 'Live scoreboard, stream embed, play-by-play, stats, chat, reactions, and replay.', ['Live scoreboard', 'Stream embed', 'Play-by-play', 'Stats', 'Chat', 'Reactions', 'Replay']),
  capability('game-report', 'Match report', 'game.html', 'Reports', 'Final score, summary, play-by-play, player performance, score sheet edits, and sharing.', ['Final score', 'Summary', 'Play-by-play', 'Player performance', 'Score sheet edits', 'Sharing'], '/games/game-1', 'native-shell', parentRoles),
  capability('player-profile', 'Player profile', 'player.html', 'Player', 'Player profile, game history, stat drilldown, and performance summaries.', ['Game history', 'Stat drilldown', 'Performance summaries'], '/players/player-1', 'native-shell', parentRoles),
  capability('athlete-profile-builder', 'Athlete profile builder', 'athlete-profile-builder.html', 'Player', 'Headshot upload, season selection, career stats, highlight clips, and share settings.', ['Headshot upload', 'Season selection', 'Career stats', 'Highlight clips', 'Share settings'], '/players/player-1', 'native-shell', parentRoles),
  capability('athlete-profile-public', 'Public athlete profile', 'athlete-profile.html', 'Public', 'Career stats, seasons, game clips, highlight clips, and sharing.', ['Career stats', 'Seasons', 'Game clips', 'Highlight clips', 'Sharing']),
  capability('certificates', 'Awards studio', 'certificates.html', 'Awards', 'Certificate drafts, player selection, AI narratives, preview, publish, and print.', ['Certificate drafts', 'Player selection', 'AI narratives', 'Preview', 'Publish', 'Print'], undefined, 'stub', staffRoles),
  capability('public-rsvp', 'Public RSVP', 'public-rsvp.html', 'Public', 'Child availability and response updates.', ['Child availability', 'Going/maybe/not going', 'Update response']),
  capability('widget-scoreboard', 'Scoreboard widget', 'widget-scoreboard.html', 'Public', 'Public scoreboard widget, team games, team link, and read-only embed.', ['Scoreboard widget', 'Team games', 'Team link', 'Read-only embed']),
  capability('changelog', 'Changelog', 'changelog.html', 'Help', 'Release notes and product updates.', ['Release notes', 'Product updates']),

  capability('help', 'Help portal', 'help.html', 'Help', 'Workflow search, role filters, and help routing.', ['Workflow search', 'Role filters', 'Help routing'], '/help', 'native-shell'),
  capability('help-account', 'Account help', 'help-account.html', 'Help', 'Account help, access help, and role ownership.', ['Account help', 'Access help', 'Role ownership']),
  capability('help-team-operations', 'Team operations help', 'help-team-operations.html', 'Help', 'Team operations, roster, and schedule help.', ['Team operations', 'Roster help', 'Schedule help']),
  capability('help-game-operations', 'Game operations help', 'help-game-operations.html', 'Help', 'Game operations, tracking, and postgame help.', ['Game operations', 'Tracking help', 'Postgame help']),
  capability('help-watch-chat', 'Watch and chat help', 'help-watch-chat.html', 'Help', 'Watch help, replay help, and chat help.', ['Watch help', 'Replay help', 'Chat help']),
  capability('help-page-reference', 'Page reference', 'help-page-reference.html', 'Help', 'Page reference, role matrix, and feature matrix.', ['Page reference', 'Role matrix', 'Feature matrix']),

  capability('workflow-getting-started', 'Getting started workflow', 'workflow-getting-started.html', 'Workflow', 'Account creation, login, password reset, and email verification workflow.', ['Account creation', 'Login', 'Password reset', 'Email verification']),
  capability('workflow-join-team', 'Join team workflow', 'workflow-join-team.html', 'Workflow', 'Invite link, invite code, and team access confirmation workflow.', ['Invite link', 'Invite code', 'Team access confirmation']),
  capability('workflow-home-dashboard', 'Choose home dashboard workflow', 'workflow-choose-home-dashboard.html', 'Workflow', 'Parent dashboard, coach dashboard, admin dashboard, and calendar workflow.', ['Parent dashboard', 'Coach dashboard', 'Admin dashboard', 'Calendar']),
  capability('workflow-team-setup', 'Team setup workflow', 'workflow-team-setup.html', 'Workflow', 'Team creation, registration import, and staff access workflow.', ['Team creation', 'Registration import', 'Staff access']),
  capability('workflow-roster', 'Roster workflow', 'workflow-roster.html', 'Workflow', 'Roster build, roster import, staff visibility, parent invite, and player status workflow.', ['Roster build', 'Roster import', 'Staff visibility', 'Parent invite', 'Player status']),
  capability('workflow-schedule', 'Schedule workflow', 'workflow-schedule.html', 'Workflow', 'Schedule planning, calendar import, recurring practice, and game launch workflow.', ['Schedule planning', 'Calendar import', 'Recurring practice', 'Game launch']),
  capability('workflow-game-day', 'Game day workflow', 'workflow-game-day.html', 'Workflow', 'Pre-game, lineup, live decision, and wrap-up workflow.', ['Pre-game', 'Lineup', 'Live decision', 'Wrap-up']),
  capability('workflow-track-game', 'Track game workflow', 'workflow-track-game.html', 'Workflow', 'Standard tracking, basketball tracking, live tracker, and statsheet workflow.', ['Standard tracking', 'Basketball tracking', 'Live tracker', 'Statsheet']),
  capability('workflow-live-tracker', 'Live tracker workflow', 'workflow-live-tracker.html', 'Workflow', 'Clock restore, substitution, foul/stat, and finish workflow.', ['Clock restore', 'Substitution', 'Foul/stat', 'Finish']),
  capability('workflow-live-watch-replay', 'Live watch and replay workflow', 'workflow-live-watch-replay.html', 'Workflow', 'Live watch, stream, replay, and report handoff workflow.', ['Live watch', 'Stream', 'Replay', 'Report handoff']),
  capability('workflow-postgame', 'Postgame workflow', 'workflow-postgame.html', 'Workflow', 'Report review, summary edit, score sheet, and sharing workflow.', ['Report review', 'Summary edit', 'Score sheet', 'Sharing']),
  capability('workflow-communication', 'Communication workflow', 'workflow-communication.html', 'Workflow', 'Team chat, RSVP, rideshare, and live chat workflow.', ['Team chat', 'RSVP', 'Rideshare', 'Live chat']),
  capability('workflow-registration', 'Registration workflow', 'workflow-registration.html', 'Workflow', 'Registration setup, application review, waitlist, and Sports Connect sync workflow.', ['Registration setup', 'Application review', 'Waitlist', 'Sports Connect sync']),
  capability('workflow-fees-payments', 'Fees and payments workflow', 'workflow-fees-payments.html', 'Workflow', 'Fee setup, Stripe payment, offline payment, and adjustment workflow.', ['Fee setup', 'Stripe payment', 'Offline payment', 'Adjustment']),
  capability('workflow-team-media', 'Team media workflow', 'workflow-team-media.html', 'Workflow', 'Album, upload, video link, and moderation workflow.', ['Album', 'Upload', 'Video link', 'Moderation']),
  capability('workflow-awards-certificates', 'Awards and certificates workflow', 'workflow-awards-certificates.html', 'Workflow', 'Certificate design, AI narrative, parent publish, and print/export workflow.', ['Certificate design', 'AI narrative', 'Parent publish', 'Print/export']),
  capability('workflow-admin-ops', 'Admin operations workflow', 'workflow-admin-ops.html', 'Workflow', 'Admin access, platform review, and team cleanup workflow.', ['Admin access', 'Platform review', 'Team cleanup'], undefined, 'legacy-link', adminRoles),

  capability('mobile-login', 'Mobile sign in', 'mobile-lite/index.html', 'Mobile', 'Mobile sign in and app redirect.', ['Mobile sign in', 'App redirect']),
  capability('mobile-parent-dashboard', 'Mobile parent dashboard', 'mobile-lite/parent-dashboard.html', 'Mobile', 'Mobile players, teams, fees, schedule, RSVP, and practice packets.', ['Players', 'Teams', 'Fees', 'Schedule', 'RSVP', 'Practice packets']),
  capability('mobile-calendar', 'Mobile calendar', 'mobile-lite/calendar.html', 'Mobile', 'Mobile calendar, RSVP, filters, and sync.', ['Calendar', 'RSVP', 'Filters', 'Calendar sync']),
  capability('mobile-messages', 'Mobile messages', 'mobile-lite/messages.html', 'Mobile', 'Mobile messages, team chat list, and unread access.', ['Messages', 'Team chat list', 'Unread access']),
  capability('mobile-team-chat', 'Mobile team chat', 'mobile-lite/team-chat.html', 'Mobile', 'Mobile team chat, conversations, attachments, reactions, and AI assistant.', ['Conversations', 'Attachments', 'Reactions', 'AI assistant']),

  capability('beta-basketball-mock', 'Basketball tracker mock', 'beta/track-basketball-mock.html', 'Beta', 'Starting five, live tracking mock, and final recap.', ['Starting five', 'Live tracking mock', 'Final recap'], undefined, 'legacy-link', staffRoles),
  capability('beta-basketball-mobile-mock', 'Mobile basketball tracker mock', 'beta/track-basketball-mobile-mock.html', 'Beta', 'Sideline tracking and substitutions.', ['Sideline tracking', 'Substitutions'], undefined, 'legacy-link', staffRoles),
  capability('beta-sub-tracker', 'Substitution prototype', 'beta/sub-tracker-prototype.html', 'Beta', 'Lineup setup, playing time, and sub flow.', ['Lineup setup', 'Playing time', 'Sub flow'], undefined, 'legacy-link', staffRoles),
  capability('beta-cheer-tracker', 'Cheer tracker beta', 'beta/cheer/track-cheer-mobile.html', 'Beta', 'Floor coach tracker and routine tracking.', ['Floor coach tracker', 'Routine tracking'], undefined, 'future', staffRoles),
  capability('mockup-game-day-command', 'Game day UI mockup', 'mockups/game-day-command-center.html', 'Beta', 'Pre-game, live command, and wrap-up mockup.', ['Pre-game', 'Live command', 'Wrap-up'], undefined, 'legacy-link', staffRoles),
  capability('mockup-practice-command', 'Practice UI mockup', 'mockups/practice-command-center.html', 'Beta', 'Drill library, practice timeline, and drill detail mockup.', ['Drill library', 'Practice timeline', 'Drill detail'], undefined, 'legacy-link', staffRoles),

  capability('test-recurring-rsvp', 'Recurring RSVP regression test', 'test-fix-recurring-rsvp.html', 'Test', 'Recurring RSVP regression test.', ['Recurring RSVP regression']),
  capability('test-schedule-drills', 'Schedule/drills regression test', 'test-fix-schedule-drills.html', 'Test', 'Schedule and drills regression test.', ['Schedule regression', 'Drills regression']),
  capability('test-foul-tracking', 'Foul tracking test', 'test-foul-tracking.html', 'Test', 'Foul tracking and score undo test.', ['Foul tracking', 'Score undo']),
  capability('test-game-day', 'Game day test', 'test-game-day.html', 'Test', 'Game day command center test.', ['Game day command center']),
  capability('test-pr-changes', 'PR smoke test', 'test-pr-changes.html', 'Test', 'Basketball detection, auth flow, and live sync tests.', ['PR smoke', 'Basketball detection', 'Auth flow', 'Live sync']),
  capability('test-statsheet-mapping', 'Statsheet mapping test', 'test-statsheet-mapping.html', 'Test', 'Statsheet mapping test.', ['Statsheet mapping']),
  capability('test-track-live', 'Live tracker broadcasting test', 'test-track-live.html', 'Test', 'Live tracker broadcasting test.', ['Live broadcasting']),
  capability('test-workflow-mobile-toc', 'Mobile workflow TOC test', 'test-workflow-mobile-toc-active-state.html', 'Test', 'Mobile workflow TOC active state test.', ['Mobile workflow TOC']),
  capability('test-youtube-stream', 'Stream URL parser test', 'test-youtube-stream.html', 'Test', 'Stream URL parser test.', ['Stream URL parser'])
];

export const primaryCapabilities = capabilities.filter((capability) => capability.status === 'native-shell');
