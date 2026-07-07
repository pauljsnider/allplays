import { describe, expect, it } from 'vitest';
import { helpKnowledgeIndex } from './helpKnowledgeIndex';

describe('helpKnowledgeIndex', () => {
  it('keeps communication mention guidance aligned with supported chat behavior', () => {
    const communicationEntry = helpKnowledgeIndex.find((entry) => entry.id === 'communication');

    expect(communicationEntry).toBeDefined();
    expect(communicationEntry?.text).toContain('@ALL PLAYS');
    expect(communicationEntry?.text).toContain('recipient picker');
    expect(communicationEntry?.text).toContain('person and group @ mentions are not supported');
    expect(communicationEntry?.text).not.toContain('Use @ in the composer to open mention autocomplete');
    expect(communicationEntry?.text).not.toContain('Choose a suggested recipient');
  });
});
