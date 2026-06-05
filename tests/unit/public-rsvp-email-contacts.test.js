import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function extractFunction(source, signature) {
    const start = source.indexOf(signature);
    expect(start, `Expected function signature to exist: ${signature}`).toBeGreaterThanOrEqual(0);

    const parenStart = source.indexOf('(', start);
    let parenDepth = 1;
    let parenEnd = -1;
    for (let index = parenStart + 1; index < source.length; index += 1) {
        const ch = source[index];
        if (ch === '(') parenDepth += 1;
        if (ch === ')') parenDepth -= 1;
        if (parenDepth === 0) {
            parenEnd = index;
            break;
        }
    }

    const braceStart = source.indexOf('{', parenEnd);
    let depth = 1;
    for (let index = braceStart + 1; index < source.length; index += 1) {
        const ch = source[index];
        if (ch === '{') depth += 1;
        if (ch === '}') depth -= 1;
        if (depth === 0) {
            return source.slice(start, index + 1);
        }
    }

    throw new Error(`Could not extract function for signature: ${signature}`);
}

const source = readFileSync(resolve(process.cwd(), 'functions/index.js'), 'utf8');
const normalizeTextSource = extractFunction(source, 'function normalizePublicRsvpText(');
const normalizeEmailSource = extractFunction(source, 'function normalizePublicRsvpEmail(');
const contactsSource = extractFunction(source, 'function getPublicRsvpParentContacts(');
const factory = new Function(`${normalizeTextSource}\n${normalizeEmailSource}\n${contactsSource}\nreturn getPublicRsvpParentContacts;`);
const getPublicRsvpParentContacts = factory();

describe('public RSVP parent contact resolution', () => {
    it('uses private-profile parents when public roster docs no longer expose contacts', () => {
        expect(getPublicRsvpParentContacts({
            privateProfileParents: [{ email: 'private@example.com', userId: 'parent-1', relation: 'Mother' }]
        })).toEqual([
            { name: 'Mother', email: 'private@example.com', userId: 'parent-1' }
        ]);
    });
});
