import {
  loadCompleteCertificateNarrativeStats as legacyLoadCompleteCertificateNarrativeStats
} from '@legacy/diamond-legacy-game-context.js';

export const loadCompleteCertificateNarrativeStats = legacyLoadCompleteCertificateNarrativeStats as (...args: any[]) => Promise<{
  totalsByPlayer: Record<string, Record<string, number>>;
  statsEvidenceByPlayer: Record<string, Record<string, any>>;
  promptEvidence: Record<string, any> | null;
}>;
