#!/usr/bin/env node
import { parentCoverageAuthoringContext } from './parent-coverage-contract.mjs';

const [workflowId, ...extra] = process.argv.slice(2);
if (!/^P\d{2}$/.test(workflowId || '') || extra.length > 0) {
    process.stderr.write('Usage: print-parent-coverage-authoring-context.mjs PNN\n');
    process.exit(2);
}

try {
    process.stdout.write(`${JSON.stringify(parentCoverageAuthoringContext(workflowId))}\n`);
} catch (error) {
    process.stderr.write(`${String(error?.message || 'unable to build authoring context')}\n`);
    process.exit(2);
}
