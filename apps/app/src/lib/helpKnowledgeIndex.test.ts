import { describe, expect, it } from 'vitest';
import { helpKnowledgeIndex } from './helpKnowledgeIndex';

describe('helpKnowledgeIndex', () => {
  it('uses app routes instead of legacy auth filenames in app-facing account help', () => {
    const accountEntry = helpKnowledgeIndex.find((entry) => entry.id === 'help-account');

    expect(accountEntry).toBeDefined();
    expect(accountEntry?.text).toContain('#/auth');
    expect(accountEntry?.text).toContain('#/reset-password');
    expect(accountEntry?.text).toContain('#/accept-invite');
    expect(accountEntry?.text).toContain('#/verify-pending');
    expect(accountEntry?.text).toContain('#/profile');
    expect(accountEntry?.text).toContain('admin tools');
    expect(accountEntry?.text).not.toMatch(/\b(?:login|reset-password|accept-invite|verify-pending|profile|admin)\.html\b/);
  });

  it('preserves account help sections and list items for article rendering', () => {
    const accountEntry = helpKnowledgeIndex.find((entry) => entry.id === 'help-account');

    expect(accountEntry).toBeDefined();
    expect(accountEntry?.text).toContain('\nLogin and Session\n- Member/Parent/Coach/Admin: Log in from #/auth');
    expect(accountEntry?.text).toContain('\nForgot Password and Recovery\n- Member/Parent/Coach/Admin: Start reset from #/auth / #/reset-password');
    expect(accountEntry?.text).toContain('\nProfile and Identity\n- Member/Parent/Coach/Admin: Update profile data in #/profile');
  });

  it('keeps communication mention guidance aligned with supported chat behavior', () => {
    const communicationEntry = helpKnowledgeIndex.find((entry) => entry.id === 'communication');

    expect(communicationEntry).toBeDefined();
    expect(communicationEntry?.text).toContain('@ALL PLAYS');
    expect(communicationEntry?.text).toContain('recipient picker');
    expect(communicationEntry?.text).toContain('person and group @ mentions are not supported');
    expect(communicationEntry?.text).not.toContain('@mention autocomplete');
    expect(communicationEntry?.text).not.toContain('Use @ in the composer to open mention autocomplete');
    expect(communicationEntry?.text).not.toContain('Choose a suggested recipient');
    expect(communicationEntry?.text).not.toContain('Mention notification did not arrive');
    expect(communicationEntry?.text).not.toContain('mentioned user');
  });

  it('indexes targeted conversation notification troubleshooting', () => {
    const communicationEntry = helpKnowledgeIndex.find((entry) => entry.id === 'communication');

    expect(communicationEntry).toBeDefined();
    expect(communicationEntry?.text).toContain('Conversation notification did not arrive');
    expect(communicationEntry?.text).toContain('participant in the conversation');
    expect(communicationEntry?.text).toContain('message was not muted');
    expect(communicationEntry?.text).toContain('relevant push category enabled');
  });
});
