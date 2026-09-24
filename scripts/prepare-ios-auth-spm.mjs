import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const defaultManifestPath = path.resolve('node_modules/@capacitor-firebase/authentication/Package.swift');

const facebookManifestLines = [
  /^\s*\.package\(url: "https:\/\/github\.com\/facebook\/facebook-ios-sdk\.git", from: "[^"]+"\),?\r?\n/m,
  /^\s*\.product\(name: "FacebookCore", package: "facebook-ios-sdk"\),?\r?\n/m,
  /^\s*\.product\(name: "FacebookLogin", package: "facebook-ios-sdk"\),?\r?\n/m,
  /^\s*\.define\("RGCFA_INCLUDE_FACEBOOK"\),?\r?\n/m
];

export function buildAppleGoogleOnlyAuthenticationManifest(source) {
  let prepared = String(source || '');
  facebookManifestLines.forEach((pattern) => {
    prepared = prepared.replace(pattern, '');
  });

  if (!prepared.includes('CapacitorFirebaseAuthentication')
      || !prepared.includes('GoogleSignIn-iOS')
      || !prepared.includes('RGCFA_INCLUDE_GOOGLE')) {
    throw new Error('The Capacitor Firebase Authentication Swift package has an unexpected shape.');
  }
  if (/facebook-ios-sdk|FacebookCore|FacebookLogin|RGCFA_INCLUDE_FACEBOOK/.test(prepared)) {
    throw new Error('The iOS authentication package still links the unused Facebook SDK.');
  }
  return prepared;
}

export function prepareIosAuthenticationSwiftPackage(manifestPath = defaultManifestPath) {
  if (!existsSync(manifestPath)) {
    throw new Error(`Missing Capacitor Firebase Authentication manifest: ${manifestPath}`);
  }
  const source = readFileSync(manifestPath, 'utf8');
  const prepared = buildAppleGoogleOnlyAuthenticationManifest(source);
  if (prepared !== source) writeFileSync(manifestPath, prepared);
  return { manifestPath, changed: prepared !== source };
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  const result = prepareIosAuthenticationSwiftPackage(process.argv[2] ? path.resolve(process.argv[2]) : defaultManifestPath);
  process.stdout.write(`${result.changed ? 'Prepared' : 'Verified'} Apple/Google-only iOS authentication package.\n`);
}
