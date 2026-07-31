// AUTO-GENERATED from apps/app/src/lib/privateAiService.ts (privateAiToolDefinitions).
// The shared AllPlays assistant tool CONTRACT: names, modes, descriptions, aliases.
// This is the single source of truth for both the in-app AI chat and the ChatGPT
// MCP service. Per-platform code supplies the resolver for each tool; this module
// carries no Firebase or platform dependency. Regenerate with scripts/gen-assistant-registry.mjs.

export const TOOL_REGISTRY = Object.freeze([
  Object.freeze({ name: 'get_profile', mode: 'read', aliases: [], description: 'Account profile, roles, notification preferences, linked teams, and linked players.' }),
  Object.freeze({ name: 'get_home', mode: 'read', aliases: ['list_tasks'], description: 'Parent dashboard tasks, players, teams, next events, unread messages, packets, fees, and priority actions.' }),
  Object.freeze({ name: 'list_schedule', mode: 'read', aliases: ['get_schedule'], description: 'Schedule events with RSVP, rideshare, assignments, score, location, and player context.' }),
  Object.freeze({ name: 'get_last_game', mode: 'read', aliases: ['last_game', 'get_previous_game'], description: 'Most recent past game for the parent account, including RSVP status. Args: teamId, teamName, playerId, childId, playerName, childName.' }),
  Object.freeze({ name: 'get_schedule_event', mode: 'read', aliases: [], description: 'One schedule event with detail context. Args: eventId, teamId, playerName, teamName.' }),
  Object.freeze({ name: 'list_rsvps', mode: 'read', aliases: [], description: 'RSVP status and summaries for schedule events.' }),
  Object.freeze({ name: 'list_ride_offers', mode: 'read', aliases: [], description: 'Rideshare offers and requests for one event. Args: eventId, teamId, playerName, teamName.' }),
  Object.freeze({ name: 'list_assignments', mode: 'read', aliases: ['get_assignments', 'list_tasks_for_event'], description: 'Volunteer/task assignments for one schedule event. Args: eventId, teamId, playerName, teamName.' }),
  Object.freeze({ name: 'get_practice_packet', mode: 'read', aliases: [], description: 'Parent practice/home packet details and completion status for a practice. Args: eventId, teamId, playerName, teamName.' }),
  Object.freeze({ name: 'get_messages', mode: 'read', aliases: [], description: 'Team chat inbox, unread counts, and latest previews.' }),
  Object.freeze({ name: 'list_message_threads', mode: 'read', aliases: ['get_message_threads'], description: 'Message conversations/threads for an accessible team. Args: teamId or teamName.' }),
  Object.freeze({ name: 'get_team_detail', mode: 'read', aliases: ['get_teams'], description: 'Accessible team detail, roster sample, upcoming events, recent results, leaderboards, and tracking summaries.' }),
  Object.freeze({ name: 'get_player_stats', mode: 'read', aliases: ['get_player_development', 'get_players'], description: 'Linked player profile, recent game stats/data, tracking, incentives, certificates, clips, and development context.' }),
  Object.freeze({ name: 'get_fees', mode: 'read', aliases: [], description: 'Parent fee records, balances, statuses, due dates, line items, and checkout availability.' }),
  Object.freeze({ name: 'get_registrations', mode: 'read', aliases: ['get_parent_tools'], description: 'Published parent registration options for linked teams.' }),
  Object.freeze({ name: 'get_certificates', mode: 'read', aliases: [], description: 'Published certificates for linked players.' }),
  Object.freeze({ name: 'get_household', mode: 'read', aliases: [], description: 'Linked players and household invite/member state.' }),
  Object.freeze({ name: 'get_family_share', mode: 'read', aliases: [], description: 'Family share children and share links.' }),
  Object.freeze({ name: 'get_access_requests', mode: 'read', aliases: ['list_access_requests', 'find_access_teams'], description: 'Parent access request status and searchable team/player options. Args: query, teamId.' }),
  Object.freeze({ name: 'get_help', mode: 'read', aliases: [], description: 'ALL PLAYS help/workflow documentation.' }),
  Object.freeze({ name: 'update_rsvp', mode: 'write', aliases: [], description: 'Update one linked child RSVP. Args: eventId, teamId, childId/playerId optional, response going|maybe|not_going, note.' }),
  Object.freeze({ name: 'update_rsvps_for_children', mode: 'write', aliases: [], description: 'Update multiple linked children on the same event. Args: eventId, teamId, response going|maybe|not_going, note.' }),
  Object.freeze({ name: 'claim_assignment', mode: 'write', aliases: ['claim_task'], description: 'Claim a volunteer/task assignment slot. Args: eventId, teamId, role.' }),
  Object.freeze({ name: 'release_assignment', mode: 'write', aliases: ['release_task'], description: 'Release a volunteer/task assignment claim. Args: eventId, teamId, role.' }),
  Object.freeze({ name: 'mark_practice_packet_complete', mode: 'write', aliases: ['complete_practice_packet'], description: 'Mark a practice/home packet complete for a linked child. Args: eventId, teamId, childId/playerId optional, playerName optional.' }),
  Object.freeze({ name: 'create_ride_offer', mode: 'write', aliases: [], description: 'Create a rideshare offer. Args: eventId, teamId, seatCapacity, direction to|from|round-trip, note.' }),
  Object.freeze({ name: 'request_ride_spot', mode: 'write', aliases: [], description: 'Request a seat for a linked child. Args: eventId, teamId, offerId, childId/playerId optional.' }),
  Object.freeze({ name: 'cancel_ride_request', mode: 'write', aliases: [], description: 'Cancel a ride request. Args: eventId, teamId, offerId, requestId.' }),
  Object.freeze({ name: 'set_ride_offer_status', mode: 'write', aliases: ['close_or_reopen_ride_offer'], description: 'Close or reopen a ride offer. Args: eventId, teamId, offerId, status open|closed|cancelled.' }),
  Object.freeze({ name: 'send_team_message', mode: 'write', aliases: ['send_message'], description: 'Send a team chat message. Args: teamId or teamName, text/message, target full_team|staff.' }),
  Object.freeze({ name: 'create_household_invite', mode: 'write', aliases: [], description: 'Invite a household contact for a linked player. Args: playerKey or teamId+playerId, email, displayName, relation.' }),
  Object.freeze({ name: 'create_family_share_link', mode: 'write', aliases: [], description: 'Create a family share link. Args: label, extraCalendarUrls.' }),
  Object.freeze({ name: 'revoke_family_share_link', mode: 'write', aliases: ['revoke_family_share'], description: 'Revoke a family share link. Args: tokenId.' }),
  Object.freeze({ name: 'update_family_share_calendars', mode: 'write', aliases: [], description: 'Update extra calendar URLs attached to a family share link. Args: tokenId, extraCalendarUrls.' }),
  Object.freeze({ name: 'submit_access_request', mode: 'write', aliases: ['request_parent_access'], description: 'Request parent access to a team/player. Args: teamId, playerId, relation.' }),
  Object.freeze({ name: 'update_player_profile', mode: 'write', aliases: [], description: 'Update parent-editable private player profile fields. Args: teamId, playerId, emergencyContactName, emergencyContactPhone, medicalInfo.' }),
  Object.freeze({ name: 'save_player_incentive_rule', mode: 'write', aliases: ['set_player_incentive_rule'], description: 'Create or update a parent player incentive rule. Args: teamId, playerId/playerName, statKey, amountCents or amount, type per_unit|threshold, threshold, thresholdOp.' }),
  Object.freeze({ name: 'toggle_player_incentive_rule', mode: 'write', aliases: [], description: 'Activate or deactivate a player incentive rule. Args: teamId, playerId/playerName, ruleId, active true|false.' }),
  Object.freeze({ name: 'retire_player_incentive_rule', mode: 'write', aliases: [], description: 'Retire/remove a player incentive rule. Args: teamId, playerId/playerName, ruleId.' }),
  Object.freeze({ name: 'set_player_incentive_cap', mode: 'write', aliases: [], description: 'Set or clear a per-game incentive cap. Args: teamId, playerId/playerName, maxPerGameCents or maxPerGameAmount.' }),
  Object.freeze({ name: 'mark_player_incentive_paid', mode: 'write', aliases: [], description: 'Mark player incentive earnings paid for a game. Args: teamId, playerId/playerName, gameId, amountCents or amount.' }),
]);

const byName = new Map();
for (const tool of TOOL_REGISTRY) {
  byName.set(tool.name, tool);
  for (const alias of tool.aliases) if (!byName.has(alias)) byName.set(alias, tool);
}

/** Resolve a tool descriptor by canonical name or alias; null if unknown. */
export function getToolDescriptor(name) {
  return byName.get(name) || null;
}

/** Canonical tool names in registry order. */
export function toolNames() {
  return TOOL_REGISTRY.map((tool) => tool.name);
}

/** The 'AVAILABLE TOOLS' block shared by the planner prompt across surfaces. */
export function renderAvailableTools(registry = TOOL_REGISTRY) {
  return registry.map((tool) => `- ${tool.name} (${tool.mode}): ${tool.description}`).join('\n');
}
