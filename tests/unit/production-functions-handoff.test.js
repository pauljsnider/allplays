import { execFileSync, spawnSync } from 'node:child_process';
import {
    chmodSync,
    lstatSync,
    mkdtempSync,
    mkdirSync,
    readlinkSync,
    rmSync,
    statSync,
    symlinkSync,
    writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const extractor = resolve('scripts/extract-production-functions-handoff.py');
const temporaryRoots = [];

function makeRoot() {
    const root = mkdtempSync(join(tmpdir(), 'allplays-functions-handoff-'));
    temporaryRoots.push(root);
    mkdirSync(join(root, 'source'));
    mkdirSync(join(root, 'destination'));
    return root;
}

function createValidRuntime(root) {
    const functionsRoot = join(root, 'source', 'functions');
    const binDirectory = join(functionsRoot, 'node_modules', '.bin');
    const targetDirectory = join(functionsRoot, 'node_modules', 'firebase-functions', 'lib', 'bin');
    mkdirSync(binDirectory, { recursive: true });
    mkdirSync(targetDirectory, { recursive: true });
    const target = join(targetDirectory, 'firebase-functions.js');
    writeFileSync(target, '#!/usr/bin/env node\n');
    chmodSync(target, 0o755);
    symlinkSync('../firebase-functions/lib/bin/firebase-functions.js', join(binDirectory, 'firebase-functions'));
}

function createTar(root) {
    const archive = join(root, 'functions-runtime.tar');
    execFileSync('tar', ['-C', join(root, 'source'), '-cf', archive, 'functions'], {
        env: { ...process.env, COPYFILE_DISABLE: '1' }
    });
    chmodSync(archive, 0o644);
    return archive;
}

function createSyntheticTar(root, pythonBody) {
    const archive = join(root, 'functions-runtime.tar');
    execFileSync('python3', ['-c', `import io, sys, tarfile\n${pythonBody}`, archive]);
    return archive;
}

function runExtractor(archive, destination) {
    return spawnSync('python3', [extractor, archive, destination], { encoding: 'utf8' });
}

afterEach(() => {
    while (temporaryRoots.length) {
        rmSync(temporaryRoots.pop(), { recursive: true, force: true });
    }
});

describe('production Functions handoff extraction', () => {
    it('preserves the npm bin symlink and executable target through a 0644 artifact', () => {
        const root = makeRoot();
        createValidRuntime(root);
        const archive = createTar(root);
        const destination = join(root, 'destination');

        const result = runExtractor(archive, destination);

        expect(result.status, result.stderr).toBe(0);
        const binLink = join(destination, 'functions', 'node_modules', '.bin', 'firebase-functions');
        const binTarget = join(destination, 'functions', 'node_modules', 'firebase-functions', 'lib', 'bin', 'firebase-functions.js');
        expect(lstatSync(binLink).isSymbolicLink()).toBe(true);
        expect(readlinkSync(binLink)).toBe('../firebase-functions/lib/bin/firebase-functions.js');
        expect(statSync(binTarget).mode & 0o111).toBe(0o111);
    });

    it('rejects traversal before writing outside the destination', () => {
        const root = makeRoot();
        const archive = createSyntheticTar(root, `
with tarfile.open(sys.argv[1], 'w') as archive:
    root = tarfile.TarInfo('functions')
    root.type = tarfile.DIRTYPE
    archive.addfile(root)
    payload = b'escape'
    item = tarfile.TarInfo('../escape')
    item.size = len(payload)
    archive.addfile(item, io.BytesIO(payload))`);

        const result = runExtractor(archive, join(root, 'destination'));

        expect(result.status).toBe(1);
        expect(result.stderr).toContain('non-canonical Functions archive path');
        expect(() => statSync(join(root, 'escape'))).toThrow();
    });

    it('rejects a symlink that resolves outside the fixed Functions root', () => {
        const root = makeRoot();
        const archive = createSyntheticTar(root, `
with tarfile.open(sys.argv[1], 'w') as archive:
    root = tarfile.TarInfo('functions')
    root.type = tarfile.DIRTYPE
    archive.addfile(root)
    link = tarfile.TarInfo('functions/node_modules/.bin/firebase-functions')
    link.type = tarfile.SYMTYPE
    link.linkname = '../../../../escape'
    archive.addfile(link)`);

        const result = runExtractor(archive, join(root, 'destination'));

        expect(result.status).toBe(1);
        expect(result.stderr).toContain('unsafe Functions symlink');
    });

    it('fails closed when the required executable runtime is absent', () => {
        const root = makeRoot();
        mkdirSync(join(root, 'source', 'functions'));
        const archive = createTar(root);

        const result = runExtractor(archive, join(root, 'destination'));

        expect(result.status).toBe(1);
        expect(result.stderr).toContain('firebase-functions .bin entry is not a preserved symlink');
    });
});
