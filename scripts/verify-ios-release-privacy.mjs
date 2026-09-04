import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const archivePath = process.argv[2] ? path.resolve(process.argv[2]) : '';
if (!archivePath || !existsSync(archivePath)) {
  throw new Error('Pass the completed .xcarchive path to verify-ios-release-privacy.mjs.');
}

const forbiddenName = /(?:^|[-_.])(facebook|fbsdk|fbaem)/i;
const forbiddenContent = /facebook-ios-sdk|RGCFA_INCLUDE_FACEBOOK|ep1\.facebook\.com/i;
const findings = [];

function inspect(targetPath) {
  const relative = path.relative(archivePath, targetPath) || path.basename(targetPath);
  if (forbiddenName.test(path.basename(targetPath))) findings.push(relative);
  const stat = statSync(targetPath);
  if (stat.isDirectory()) {
    readdirSync(targetPath).forEach((entry) => inspect(path.join(targetPath, entry)));
    return;
  }
  if (stat.size <= 2 * 1024 * 1024) {
    const contents = readFileSync(targetPath);
    if (forbiddenContent.test(contents.toString('latin1'))) findings.push(`${relative} (content)`);
  }
}

inspect(archivePath);
if (findings.length) {
  throw new Error(`Unused Facebook SDK/privacy artifacts found in iOS archive:\n${[...new Set(findings)].join('\n')}`);
}
process.stdout.write('Verified iOS archive contains no Facebook SDK/privacy artifacts.\n');
