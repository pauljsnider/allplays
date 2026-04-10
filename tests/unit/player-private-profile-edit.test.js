import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

function readPlayerPage() {
    return readFileSync(new URL('../../player.html', import.meta.url), 'utf8');
}

function readDbSource() {
    return readFileSync(new URL('../../js/db.js', import.meta.url), 'utf8');
}

function extractFunction(source, signature) {
    const start = source.indexOf(signature);
    expect(start, `Expected function signature to exist: ${signature}`).toBeGreaterThanOrEqual(0);

    const parenStart = source.indexOf('(', start);
    expect(parenStart, `Expected opening paren for: ${signature}`).toBeGreaterThanOrEqual(0);

    let parenDepth = 1;
    let parenEnd = -1;
    for (let i = parenStart + 1; i < source.length; i += 1) {
        const ch = source[i];
        if (ch === '(') parenDepth += 1;
        if (ch === ')') parenDepth -= 1;
        if (parenDepth === 0) {
            parenEnd = i;
            break;
        }
    }

    expect(parenEnd, `Expected closing paren for: ${signature}`).toBeGreaterThanOrEqual(0);

    const braceStart = source.indexOf('{', parenEnd);
    expect(braceStart, `Expected opening brace for: ${signature}`).toBeGreaterThanOrEqual(0);

    let depth = 1;
    for (let i = braceStart + 1; i < source.length; i += 1) {
        const ch = source[i];
        if (ch === '{') depth += 1;
        if (ch === '}') depth -= 1;
        if (depth === 0) {
            return source.slice(start, i + 1);
        }
    }

    throw new Error(`Could not extract function for signature: ${signature}`);
}

function buildPlayerProfileUpdatePayload(overrides = {}) {
    const source = readPlayerPage();
    const fnSource = extractFunction(source, 'function buildPlayerProfileUpdatePayload(');
    const factory = new Function(`${fnSource}; return buildPlayerProfileUpdatePayload;`);
    const buildPayload = factory();

    return buildPayload({
        emergencyContactName: '',
        emergencyContactPhone: '',
        medicalInfo: '',
        privateProfileLoadFailed: false,
        privateFieldsDirty: {
            emergencyContact: false,
            medicalInfo: false
        },
        ...overrides
    });
}

function buildUpdatePlayerProfile() {
    const source = readDbSource();
    const fnSource = extractFunction(source, 'export async function updatePlayerProfile(')
        .replace('export async function updatePlayerProfile', 'async function updatePlayerProfile');

    const factory = new Function('deps', `
        const { Timestamp, updateDoc, doc, db, setDoc } = deps;
        ${fnSource}
        return updatePlayerProfile;
    `);

    const deps = {
        Timestamp: {
            now: vi.fn(() => 'ts-now')
        },
        updateDoc: vi.fn(() => Promise.resolve()),
        setDoc: vi.fn(() => Promise.resolve()),
        doc: vi.fn((database, path, maybeId) => maybeId ? `${path}/${maybeId}` : path),
        db: {}
    };

    return {
        deps,
        updatePlayerProfile: factory(deps)
    };
}

describe('player private-profile edit payload', () => {
    it('omits untouched private fields when a photo-only save follows a private-profile load failure', () => {
        const payload = buildPlayerProfileUpdatePayload({
            privateProfileLoadFailed: true,
            photoUrl: 'https://img.example/player.jpg'
        });

        expect(payload).toEqual({
            photoUrl: 'https://img.example/player.jpg'
        });
        expect(payload).not.toHaveProperty('emergencyContact');
        expect(payload).not.toHaveProperty('medicalInfo');
    });

    it('includes private fields during normal profile saves when the private-profile load succeeded', () => {
        const payload = buildPlayerProfileUpdatePayload({
            emergencyContactName: 'Pat Parent',
            emergencyContactPhone: '555-0100',
            medicalInfo: 'Asthma inhaler'
        });

        expect(payload).toEqual({
            emergencyContact: {
                name: 'Pat Parent',
                phone: '555-0100'
            },
            medicalInfo: 'Asthma inhaler'
        });
    });

    it('includes only explicitly edited private fields after a private-profile load failure', () => {
        const payload = buildPlayerProfileUpdatePayload({
            emergencyContactName: 'New Contact',
            emergencyContactPhone: '555-0111',
            privateProfileLoadFailed: true,
            privateFieldsDirty: {
                emergencyContact: true,
                medicalInfo: false
            }
        });

        expect(payload).toEqual({
            emergencyContact: {
                name: 'New Contact',
                phone: '555-0111'
            }
        });
        expect(payload).not.toHaveProperty('medicalInfo');
    });
});

describe('updatePlayerProfile private doc writes', () => {
    it('skips the private profile document when only photoUrl is present', async () => {
        const { deps, updatePlayerProfile } = buildUpdatePlayerProfile();

        await updatePlayerProfile('team-1', 'player-1', {
            photoUrl: 'https://img.example/player.jpg'
        });

        expect(deps.updateDoc).toHaveBeenCalledTimes(1);
        expect(deps.setDoc).not.toHaveBeenCalled();
    });
});
