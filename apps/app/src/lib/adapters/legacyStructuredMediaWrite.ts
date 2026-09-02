import { structuredMediaWriteService as legacyStructuredMediaWriteService } from '@legacy/structured-media-write-service.js';

export type StructuredMediaWriteResult = {
  version: number;
  mutationId: string;
  requestHash: string;
  resourceKind: string;
  action: string;
  committed: true;
  targetId: string | null;
  resource: ({ id: string } & Record<string, unknown>) | null;
};

export type TeamFixedVideoWrite = {
  teamId: string;
  streamEmbedUrl: string | null;
  youtubeEmbedUrl: string | null;
  streamUrl: string | null;
  livestreamUrl: string | null;
  youtubeVideoId: string | null;
};

export type TeamMediaVideoLinkWrite = {
  teamId: string;
  folderId: string;
  title: string;
  url: string;
};

type LegacyStructuredMediaWriteService = {
  setTeamFixedVideo(options: TeamFixedVideoWrite): Promise<StructuredMediaWriteResult>;
  removeTeamFixedVideo(options: { teamId: string }): Promise<StructuredMediaWriteResult>;
  createTeamMediaVideoLink(options: TeamMediaVideoLinkWrite): Promise<StructuredMediaWriteResult & { targetId: string }>;
  removeTeamMediaVideoLink(options: { teamId: string; targetId: string }): Promise<StructuredMediaWriteResult>;
};

const structuredMediaWriteService = legacyStructuredMediaWriteService as LegacyStructuredMediaWriteService;

/**
 * Typed adapter boundary for the legacy structured-media mutation client.
 */
export function setTeamFixedVideo(options: TeamFixedVideoWrite): Promise<StructuredMediaWriteResult> {
  return structuredMediaWriteService.setTeamFixedVideo(options);
}

export function removeTeamFixedVideo(options: { teamId: string }): Promise<StructuredMediaWriteResult> {
  return structuredMediaWriteService.removeTeamFixedVideo(options);
}

export function createTeamMediaVideoLink(
  options: TeamMediaVideoLinkWrite
): Promise<StructuredMediaWriteResult & { targetId: string }> {
  return structuredMediaWriteService.createTeamMediaVideoLink(options);
}

export function removeTeamMediaVideoLink(
  options: { teamId: string; targetId: string }
): Promise<StructuredMediaWriteResult> {
  return structuredMediaWriteService.removeTeamMediaVideoLink(options);
}
