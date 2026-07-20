import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export function compactFirestoreRules(rulesSource) {
    const compactLines = rulesSource
        .split(/\r?\n/)
        .filter(line => !/^\s*\/\//.test(line))
        .map(line => line.trim())
        .filter(Boolean);

    return `${compactLines.join('\n')}\n`;
}

function main() {
    const [inputPath, outputPath] = process.argv.slice(2);
    if (!inputPath || !outputPath) {
        throw new Error('Usage: node scripts/compact-firestore-rules.mjs <input> <output>');
    }

    writeFileSync(outputPath, compactFirestoreRules(readFileSync(inputPath, 'utf8')));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main();
}
