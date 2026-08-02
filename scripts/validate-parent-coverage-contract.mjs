#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { readValidatedCatalog, readValidatedContract } from './parent-coverage-contract.mjs';

function readArg(name) {
    const index = process.argv.indexOf(name);
    return index >= 0 ? String(process.argv[index + 1] || '') : '';
}

const catalogPath = readArg('--catalog');
const contractPath = readArg('--input');
const workflowId = readArg('--workflow-id');
const expectedDigest = readArg('--sha256').toLowerCase();
if (!catalogPath || !contractPath || !workflowId || !/^[a-f0-9]{64}$/.test(expectedDigest)) {
    throw new Error('Usage: validate-parent-coverage-contract.mjs --catalog <path> --input <path> --workflow-id PNN --sha256 <digest>');
}

const raw = await readFile(contractPath);
const actualDigest = createHash('sha256').update(raw).digest('hex');
if (actualDigest !== expectedDigest) throw new Error('contract digest does not match the requested immutable artifact');
const catalog = await readValidatedCatalog(catalogPath);
const contract = await readValidatedContract(contractPath, catalog, workflowId);
process.stdout.write(JSON.stringify({ workflowId: contract.workflowId, digest: actualDigest, valid: true }));
