import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildAppleGoogleOnlyAuthenticationManifest } from '../../scripts/prepare-ios-auth-spm.mjs';

const upstreamManifest = `
dependencies: [
  .package(url: "https://github.com/google/GoogleSignIn-iOS", from: "9.0.0"),
  .package(url: "https://github.com/facebook/facebook-ios-sdk.git", from: "18.0.0")
],
.target(
  name: "CapacitorFirebaseAuthentication",
  dependencies: [
    .product(name: "GoogleSignIn", package: "GoogleSignIn-iOS"),
    .product(name: "FacebookCore", package: "facebook-ios-sdk"),
    .product(name: "FacebookLogin", package: "facebook-ios-sdk")
  ],
  swiftSettings: [
    .define("RGCFA_INCLUDE_GOOGLE"),
    .define("RGCFA_INCLUDE_FACEBOOK")
  ])
`;

describe('iOS authentication Swift package privacy boundary', () => {
  it('removes only the unused Facebook provider and keeps Google sign-in', () => {
    const prepared = buildAppleGoogleOnlyAuthenticationManifest(upstreamManifest);
    expect(prepared).toContain('GoogleSignIn-iOS');
    expect(prepared).toContain('RGCFA_INCLUDE_GOOGLE');
    expect(prepared).not.toMatch(/facebook-ios-sdk|FacebookCore|FacebookLogin|RGCFA_INCLUDE_FACEBOOK/);
  });

  it('keeps the installed package prepared after npm install', () => {
    const manifest = readFileSync('node_modules/@capacitor-firebase/authentication/Package.swift', 'utf8');
    expect(manifest).toContain('RGCFA_INCLUDE_GOOGLE');
    expect(manifest).not.toMatch(/facebook-ios-sdk|FacebookCore|FacebookLogin|RGCFA_INCLUDE_FACEBOOK/);
  });

  it('verifies the signed archive in the release workflow', () => {
    const workflow = readFileSync('.github/workflows/mobile-release.yml', 'utf8');
    expect(workflow).toContain('node scripts/verify-ios-release-privacy.mjs "$RUNNER_TEMP/ALLPLAYS.xcarchive"');
  });
});
