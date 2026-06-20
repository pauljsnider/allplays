import { describe, expect, it } from 'vitest';

import { getStatConfigPresetById, getStatConfigPresetOptions } from '../../../../js/stat-config-presets.js';

type PresetOption = { id: string };
import {
  buildStatTrackerConfigPayload,
  createEmptyStatTrackerConfigDraft,
  createStatTrackerConfigDraft,
  createStatTrackerConfigDraftFromPreset,
  validateStatTrackerConfigDraft
} from './statTrackerConfigEditor';

describe('statTrackerConfigEditor', () => {
  it('builds a legacy-compatible payload from each named preset', () => {
    const presetIds = (getStatConfigPresetOptions() as PresetOption[]).map((preset) => preset.id).filter((presetId) => presetId !== 'blank');

    presetIds.forEach((presetId: string) => {
      const draft = createStatTrackerConfigDraftFromPreset(presetId);
      const payload = buildStatTrackerConfigPayload(draft);
      const expected = getStatConfigPresetById(presetId);

      expect(payload).toEqual(expect.objectContaining({
        name: expected?.name,
        baseType: expected?.baseType,
        columns: expected?.columns,
        statDefinitions: expected?.statDefinitions
      }));
    });
  });

  it('keeps stat ids stable when a label is renamed on an existing config', () => {
    const draft = createStatTrackerConfigDraft(getStatConfigPresetById('basketball'));
    draft.columns[0] = {
      ...draft.columns[0],
      label: 'Points'
    };

    const payload = buildStatTrackerConfigPayload(draft);

    expect(payload.columns[0]).toBe('Points');
    expect(payload.statDefinitions).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'pts', label: 'Points', acronym: 'Points' })
    ]));
  });

  it('matches the validation matrix for empty names, zero columns, duplicates, and reorder persistence', () => {
    const emptyDraft = createEmptyStatTrackerConfigDraft();
    expect(validateStatTrackerConfigDraft(emptyDraft)).toEqual({
      valid: false,
      errors: ['Please add a config name.', 'Please add at least one column.']
    });

    const duplicateDraft = createStatTrackerConfigDraft(getStatConfigPresetById('basketball'));
    duplicateDraft.name = 'Basketball Standard';
    duplicateDraft.columns = [
      duplicateDraft.columns[0],
      { ...duplicateDraft.columns[1], key: 'PTS', label: 'Points again' }
    ];
    expect(validateStatTrackerConfigDraft(duplicateDraft)).toEqual({
      valid: false,
      errors: ['Column keys must be unique.']
    });

    const reorderedDraft = createStatTrackerConfigDraft(getStatConfigPresetById('soccer'));
    reorderedDraft.columns = [reorderedDraft.columns[2], reorderedDraft.columns[0], reorderedDraft.columns[1], reorderedDraft.columns[3], reorderedDraft.columns[4]];
    const payload = buildStatTrackerConfigPayload(reorderedDraft);
    expect(payload.columns.slice(0, 3)).toEqual(['SHOTS_ON_TARGET', 'GOALS', 'SHOTS']);
  });
});
