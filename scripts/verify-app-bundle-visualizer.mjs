import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM, VirtualConsole } from 'jsdom';

import { assertBundleVisualizerTooltipPatched } from '../apps/app/build/fixBundleVisualizerTooltip.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const artifactPath = path.join(repoRoot, 'apps/app/bundle-visualizer.html');
const artifactHtml = readFileSync(artifactPath, 'utf8');

assertBundleVisualizerTooltipPatched(artifactHtml);

const runtimeErrors = [];
const virtualConsole = new VirtualConsole();
virtualConsole.on('error', (...args) => runtimeErrors.push(new Error(args.map(String).join(' '))));
virtualConsole.on('jsdomError', (error) => runtimeErrors.push(error));

const dom = new JSDOM(artifactHtml, {
    pretendToBeVisual: true,
    runScripts: 'dangerously',
    url: 'http://localhost/',
    virtualConsole
});

function wait(milliseconds) {
    return new Promise(resolve => setTimeout(resolve, milliseconds));
}

async function waitFor(predicate, message, timeoutMs = 2000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (predicate()) return;
        await wait(20);
    }
    throw new Error(message);
}

try {
    const { document, Event, MouseEvent } = dom.window;
    await waitFor(
        () => document.querySelector('.node') && document.querySelector('.tooltip') && document.querySelector('#module-filter-include'),
        'Generated bundle visualizer did not render its node, tooltip, and include-filter controls.'
    );

    const firstNode = document.querySelector('.node');
    const tooltip = document.querySelector('.tooltip');
    const includeInput = document.querySelector('#module-filter-include');
    const initialNodeCount = document.querySelectorAll('.node').length;

    firstNode.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    await wait(0);
    if (tooltip.classList.contains('tooltip-hidden')) {
        throw new Error('Generated bundle visualizer did not show its tooltip when a module node was hovered.');
    }

    tooltip.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    await wait(0);
    if (tooltip.classList.contains('tooltip-hidden')) {
        throw new Error('Generated bundle visualizer hid its tooltip while the tooltip itself was hovered.');
    }

    includeInput.value = '**/react/**';
    includeInput.dispatchEvent(new Event('input', { bubbles: true }));
    includeInput.value = '**/react-dom/**';
    includeInput.dispatchEvent(new Event('input', { bubbles: true }));

    await waitFor(
        () => document.querySelector('svg')?.textContent.includes('react-dom') &&
            document.querySelectorAll('.node').length < initialNodeCount,
        'Generated bundle visualizer did not apply the final rapidly typed include-filter value.'
    );

    if (runtimeErrors.length > 0) {
        throw runtimeErrors[0];
    }

    console.log(`Bundle visualizer artifact verified (${initialNodeCount} rendered nodes).`);
} finally {
    dom.window.close();
}
