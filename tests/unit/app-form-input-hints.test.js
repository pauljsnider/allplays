import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();

function readSource(relativePath) {
  return readFileSync(join(root, relativePath), 'utf8');
}

describe('app form mobile input hints', () => {
  test('invite acceptance fields expose email and one-time-code hints', () => {
    const source = readSource('apps/app/src/pages/AcceptInvite.tsx');

    expect(source).toContain('type="email" inputMode="email" autoComplete="email" enterKeyHint="next"');
    expect(source).toContain('inputMode="text" autoCapitalize="characters" autoComplete="one-time-code" enterKeyHint="go"');
  });

  test('registration detail fields infer keyboard and autocomplete hints', () => {
    const source = readSource('apps/app/src/pages/RegistrationDetail.tsx');

    expect(source).toContain('data-quantity-field type="number" inputMode="numeric" enterKeyHint="next"');
    expect(source).toContain('{...getFieldInputHints(field.type)}');
    expect(source).toContain("if (type === 'email') return { inputMode: 'email', autoComplete: 'email', enterKeyHint: 'next' };");
    expect(source).toContain("if (type === 'tel') return { inputMode: 'tel', autoComplete: 'tel', enterKeyHint: 'next' };");
    expect(source).toContain("if (type === 'number') return { inputMode: 'numeric', enterKeyHint: 'next' };");
  });

  test('parent tools invite and household fields expose expected hints', () => {
    const accessTool = readSource('apps/app/src/pages/parent-tools/AccessTool.tsx');
    const householdInviteTool = readSource('apps/app/src/pages/parent-tools/HouseholdInviteTool.tsx');

    expect(accessTool).toContain('autoComplete="one-time-code"');
    expect(householdInviteTool).toContain('autoComplete="email" enterKeyHint="send"');
    expect(householdInviteTool).toContain('autoComplete="name" enterKeyHint="next"');
  });

  test('messages search and composers expose search/send enter key hints', () => {
    const source = readSource('apps/app/src/pages/Messages.tsx');

    expect(source).toContain('placeholder="Search team chats"');
    expect(source).toContain('enterKeyHint="search"');
    expect(source).toContain('className="chat-composer-textarea"');
    expect(source).toContain('enterKeyHint="send"');
  });

  test('team and player detail numeric and email fields expose keyboard hints', () => {
    const teamDetail = readSource('apps/app/src/pages/TeamDetail.tsx');
    const playerDetail = readSource('apps/app/src/pages/PlayerDetail.tsx');

    expect(teamDetail).toContain('inputMode="numeric"');
    expect(teamDetail).toContain('type="email"');
    expect(teamDetail).toContain('autoComplete="email"');
    expect(playerDetail).toContain('label="Jersey number" value={number} onChange={setNumber} placeholder="Number" inputMode="numeric"');
    expect(playerDetail).toContain("if (type === 'email') return { inputMode: 'email', autoComplete: 'email', enterKeyHint: 'next' };");
    expect(playerDetail).toContain("if (type === 'tel') return { inputMode: 'tel', autoComplete: 'tel', enterKeyHint: 'next' };");
    expect(playerDetail).toContain("if (type === 'number') return { inputMode: 'decimal', enterKeyHint: 'next' };");
  });
});
