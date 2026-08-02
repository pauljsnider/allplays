import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const serverOnlyDefaultsBlock = `      match /settings/{settingId} {
        allow read: if settingId == 'certificateDefaults' &&
                       isTeamOwnerOrAdmin(teamId);
        // Certificate defaults can retire legacy uploader-owned Storage paths.
        // All writes must cross the callable's trusted provenance/tombstone checks.
        allow create, update, delete: if false;
      }`;

const compatibilityDefaultsBlock = `      match /settings/{settingId} {
        // Transitional compatibility only: the server writer and updated clients
        // deploy before the final ruleset removes these direct writes.
        allow read, create, update, delete: if settingId == 'certificateDefaults' &&
                                            isTeamOwnerOrAdmin(teamId);
      }`;

export function buildCertificateDefaultsCompatibilityRules(finalRules) {
    const firstMatch = finalRules.indexOf(serverOnlyDefaultsBlock);
    if (firstMatch === -1 || finalRules.indexOf(serverOnlyDefaultsBlock, firstMatch + 1) !== -1) {
        throw new Error('Expected exactly one server-only certificate defaults rules block.');
    }
    return finalRules.replace(serverOnlyDefaultsBlock, compatibilityDefaultsBlock);
}

async function main() {
    const [, , inputPath, outputPath] = process.argv;
    if (!inputPath || !outputPath) {
        throw new Error('Usage: build-certificate-defaults-compat-rules.mjs <input> <output>');
    }
    const finalRules = await readFile(inputPath, 'utf8');
    const compatibilityRules = buildCertificateDefaultsCompatibilityRules(finalRules);
    await writeFile(outputPath, compatibilityRules, 'utf8');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    await main();
}
