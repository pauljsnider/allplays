import type { AuthUser } from './types';
import {
  loadResourcePacketFamily,
  loadResourcePacketStaff,
  resourcePacketCommand,
  resourcePacketsAvailable,
  type PacketStaffView
} from './resourcePacketsService';

function readCursors(args: Record<string, unknown>): Record<string, string | null> | undefined {
  if (!args.cursors || typeof args.cursors !== 'object' || Array.isArray(args.cursors)) return undefined;
  return Object.fromEntries(
    Object.entries(args.cursors).filter((entry): entry is [string, string | null] => entry[1] === null || typeof entry[1] === 'string')
  );
}

async function loadPreparationView(teamId: string): Promise<PacketStaffView> {
  const view = await loadResourcePacketStaff(teamId);
  // Confirmation must include the complete audience, including later roster pages.
  for (let page = 0; page < 50; page++) {
    const cursors = Object.fromEntries(
      ['resources', 'assignments', 'players', 'tasks', 'deliveries', 'practices'].map((key) => [
        key,
        ['resources', 'assignments', 'players'].includes(key) ? (view.cursors?.[key] ?? null) : null
      ])
    );
    if (!Object.values(cursors).some(Boolean)) return view;
    const next = await loadResourcePacketStaff(teamId, cursors);
    view.resources.push(...next.resources);
    view.assignments.push(...next.assignments);
    view.players.push(...next.players);
    view.cursors = next.cursors;
  }
  throw new Error('The authorized collection is too large to prepare a complete confirmation. Use the practice packet page.');
}

export function buildResourcePacketAiTools() {
  if (!resourcePacketsAvailable()) return [];
  return [
    {
      name: 'get_resource_packets',
      mode: 'read' as const,
      domain: 'practice',
      audience: 'all' as const,
      description:
        'Read authorized practice resource notes and reported progress. Args teamId and playerId for a family; teamId and view=staff for staff. Pass returned cursors to read another page. Link opened is only a click. Watched/practiced are self-reports. External video content is unavailable: never claim to have watched or summarize an unseen video.',
      resolve: async (_user: AuthUser, args: Record<string, unknown>) => ({
        externalVideoContentAvailable: false,
        evidenceMeaning: 'Link opened is a deliberate click, not proof of watching. Watched and practiced are family reports.',
        data:
          args.view === 'staff'
            ? await loadResourcePacketStaff(String(args.teamId || ''), readCursors(args))
            : await loadResourcePacketFamily(String(args.teamId || ''), String(args.playerId || ''), readCursors(args)?.tasks || undefined)
      })
    },
    {
      name: 'prepare_resource_packet',
      mode: 'write' as const,
      domain: 'practice',
      audience: 'manager' as const,
      description:
        'Prepare a staff resource, packet draft, or publication for explicit confirmation. Args teamId, action=saveResource|saveDraft|publish. Resources need title,url and optional teachingPoint and optional resourceId/drillId. Drafts need title,resourceIds,playerIds and optional matching resourceVersions,notes,practiceId,dueAt ISO,timeZone,assignmentId. New drafts require explicit practice acknowledgment; edits preserve the assignment policy. Omit resourceVersions to preserve versions from an existing assignment and select current versions for newly added resources; pass current versions to explicitly adopt updated media. Publish needs assignmentId and explicit notify boolean. Never invent video content or report an open on behalf of someone.',
      prepare: async (_user: AuthUser, args: Record<string, unknown>) => {
        const teamId = String(args.teamId || '');
        const view = await loadPreparationView(teamId);
        const action = args.action;
        if (!['saveResource', 'saveDraft', 'publish'].includes(String(action)))
          throw new Error('Choose a resource, draft, or publication action.');
        let prepared: Record<string, unknown>;
        let previewSummary: Record<string, unknown>;
        if (action === 'saveResource') {
          const existing = view.resources.find((row) => row.resourceId === args.resourceId);
          if (args.resourceId && !existing)
            throw new Error('That resource is not in this authorized page. Load the correct page before editing.');
          if (![args.title, args.url].every((value) => typeof value === 'string' && value.trim()))
            throw new Error('Provide a title and external URL before preparing the resource.');
          prepared = {
            teamId,
            action,
            resourceId: existing?.resourceId || crypto.randomUUID(),
            expectedRevision: existing?.version || 0,
            title: args.title,
            url: args.url,
            teachingPoint: args.teachingPoint || '',
            ...(args.drillId ? { drillId: args.drillId } : {})
          };
          previewSummary = {
            title: args.title,
            url: args.url,
            teachingPoint: args.teachingPoint || '',
            effect: 'Save a reusable resource; do not publish or notify.'
          };
        } else {
          const existing = view.assignments.find((row) => row.assignmentId === args.assignmentId);
          if (args.assignmentId && !existing)
            throw new Error('That packet is not in this authorized page. Load the correct page before editing.');
          if (action === 'publish') {
            if (!existing || typeof args.notify !== 'boolean')
              throw new Error('Choose an existing draft and whether guardians should be notified.');
            const players = existing.playerIds.map((id) => view.players.find((row) => row.id === id));
            if (players.some((player) => !player))
              throw new Error('The selected audience changed. Review the packet and its players before publishing.');
            prepared = {
              teamId,
              action,
              assignmentId: existing.assignmentId,
              expectedRevision: existing.revision,
              notify: args.notify,
              confirm: true
            };
            previewSummary = {
              title: existing.title,
              items: existing.items,
              players,
              dueAt: existing.dueAt,
              notify: args.notify,
              effect:
                'Publish a new version; preserve opened progress for unchanged video destinations; changed videos need a new open. Eligible notification channels and preferences apply.'
            };
          } else {
            if (!Array.isArray(args.resourceIds) || !args.resourceIds.every((value) => typeof value === 'string'))
              throw new Error('Choose the resources to include in the draft.');
            const resourceIds = args.resourceIds as string[];
            const suppliedVersions = args.resourceVersions;
            if (suppliedVersions !== undefined && (!Array.isArray(suppliedVersions) || suppliedVersions.length !== resourceIds.length))
              throw new Error('Choose a version for every resource.');
            const selectedItems = resourceIds.map((resourceId, index) => {
              const current = view.resources.find((row) => row.resourceId === resourceId);
              const prior = existing?.items.find((item) => item.resourceId === resourceId);
              const selectedVersion = Array.isArray(suppliedVersions)
                ? suppliedVersions[index]
                : (prior?.resourceVersion ?? current?.version);
              if (!Number.isInteger(selectedVersion) || Number(selectedVersion) < 1)
                throw new Error('Choose a valid version for every resource.');
              if (prior && prior.resourceVersion === selectedVersion) return prior;
              if (current && current.version === selectedVersion) return { ...current, resourceVersion: current.version };
              throw new Error('That resource version is not in this authorized page. Load the correct page before preparing the draft.');
            });
            prepared = {
              teamId,
              action,
              assignmentId: existing?.assignmentId || crypto.randomUUID(),
              expectedRevision: existing?.revision || 0,
              title: args.title,
              notes: args.notes || '',
              resourceIds,
              resourceVersions: selectedItems.map((item) => item.resourceVersion),
              playerIds: args.playerIds,
              practiceId: args.practiceId || null,
              dueAt: args.dueAt || null,
              timeZone: args.timeZone || null,
              completionPolicy: existing ? (existing.completionPolicy || 'link_opened_legacy') : 'practice_ack'
            };
            previewSummary = { ...prepared, items: selectedItems, effect: 'Save a draft only; do not publish or notify.' };
          }
        }
        return {
          args: { ...prepared, requestId: crypto.randomUUID() },
          summary: `Confirm practice packet action: ${action}`,
          previewSummary
        };
      },
      resolve: (user: AuthUser, args: Record<string, unknown>) => resourcePacketCommand(user.uid, args)
    }
  ];
}
