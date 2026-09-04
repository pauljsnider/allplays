import { closeSync, existsSync, openSync, readSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const archivePath = process.argv[2] ? path.resolve(process.argv[2]) : '';
if (!archivePath || !existsSync(archivePath)) {
  throw new Error('Pass the completed .xcarchive path to verify-ios-release-privacy.mjs.');
}

const forbiddenName = /(?:^|[-_.])(facebook|fbsdk|fbaem)/i;
const forbiddenContent = /facebook-ios-sdk|RGCFA_INCLUDE_FACEBOOK|ep1\.facebook\.com/i;
const findings = [];

function fileContainsForbiddenContent(targetPath) {
  const descriptor = openSync(targetPath, 'r');
  const buffer = Buffer.allocUnsafe(64 * 1024);
  let tail = '';
  try {
    while (true) {
      const bytesRead = readSync(descriptor, buffer, 0, buffer.length, null);
      if (bytesRead === 0) return false;
      const chunk = tail + buffer.subarray(0, bytesRead).toString('latin1');
      if (forbiddenContent.test(chunk)) return true;
      tail = chunk.slice(-64);
    }
  } finally {
    closeSync(descriptor);
  }
}

function inspect(targetPath) {
  const relative = path.relative(archivePath, targetPath) || path.basename(targetPath);
  if (forbiddenName.test(path.basename(targetPath))) findings.push(relative);
  const stat = statSync(targetPath);
  if (stat.isDirectory()) {
    readdirSync(targetPath).forEach((entry) => inspect(path.join(targetPath, entry)));
    return;
  }
  if (fileContainsForbiddenContent(targetPath)) findings.push(`${relative} (content)`);
}

inspect(archivePath);
if (findings.length) {
  throw new Error(`Unused Facebook SDK/privacy artifacts found in iOS archive:\n${[...new Set(findings)].join('\n')}`);
}
process.stdout.write('Verified iOS archive contains no Facebook SDK/privacy artifacts.\n');
