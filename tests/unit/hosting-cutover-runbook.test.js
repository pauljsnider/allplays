import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = process.cwd();
const runbook = readFileSync(
    join(repoRoot, 'docs', 'hosting-cutover-runbook.md'),
    'utf8'
);
const appCheckRollout = readFileSync(
    join(repoRoot, 'docs', 'firebase-app-check-rollout.md'),
    'utf8'
);

function section(source, heading) {
    const start = source.indexOf(`## ${heading}`);
    expect(start, `missing "${heading}" section`).toBeGreaterThanOrEqual(0);
    const next = source.indexOf('\n## ', start + 4);
    return source.slice(start, next === -1 ? source.length : next);
}

function normalize(source) {
    return source.replace(/\s+/g, ' ').trim();
}

describe('hosting cutover runbook contract', () => {
    it('gates cutover on candidate public and authenticated smoke while App Check is unenforced', () => {
        const gate = normalize(section(runbook, 'Pre-cutover gate'));

        expect(gate).toContain('https://game-flow-c6311.web.app');
        expect(gate).toContain('npm run smoke:candidate-host -- https://game-flow-c6311.web.app');
        expect(gate).toContain('node scripts/verify-response-headers.mjs https://game-flow-c6311.web.app');
        expect(gate).toContain('tests/smoke/candidate-host-auth.spec.js');
        expect(gate).toContain('successful public and authenticated');
        expect(gate).toContain('every Firebase API remains **Unenforced**');
        expect(gate).toMatch(/failed, skipped, stale, or missing-credential result is a no-go/i);
    });

    it('defines objective DNS propagation and TLS certificate checks', () => {
        const validation = normalize(section(runbook, 'DNS and TLS validation'));

        expect(validation).toContain('authoritative nameservers');
        expect(validation).toContain('1.1.1.1');
        expect(validation).toContain('8.8.8.8');
        expect(validation).toContain('A, AAAA, and CNAME');
        expect(validation).toContain('recorded pre-cutover TTL');
        expect(validation).toContain('subjectAltName');
        expect(validation).toContain('notBefore');
        expect(validation).toContain('notAfter');
        expect(validation).toContain('trusted root');
        expect(validation).toContain('two independent networks or external probes');
        expect(validation).toContain('Do not use `curl -k`');
    });

    it('names the rollback target and orders reversal through recovery verification', () => {
        const rollback = normalize(section(runbook, 'Rollback'));

        expect(rollback).toContain('last known-good GitHub Pages deployment');
        expect(rollback).toContain('pauljsnider.github.io');
        expect(rollback).toMatch(/1\. Declare rollback[\s\S]*2\. Restore[\s\S]*3\. Verify authoritative DNS[\s\S]*4\. Verify at least two public recursive resolvers[\s\S]*5\. Validate TLS[\s\S]*6\. Run the public and authenticated smoke checks[\s\S]*7\. Confirm the temporary meta CSP bridge[\s\S]*8\. Close rollback/);
        expect(rollback).toContain('exact pre-cutover record set');
        expect(rollback).toContain('Rollback is complete only when DNS, TLS, public smoke, authenticated smoke');
    });

    it('requires retained evidence before removing the temporary meta CSP bridge', () => {
        const bridge = normalize(section(runbook, 'Meta CSP bridge removal gate'));

        expect(bridge).toContain('separate reviewed change');
        expect(bridge).toContain('one full recorded pre-cutover TTL');
        expect(bridge).toContain('minimum 24-hour observation window');
        expect(bridge).toContain('two consecutive');
        expect(bridge).toContain('Content-Security-Policy');
        expect(bridge).toContain('HTTP response header');
        expect(bridge).toContain('no material CSP violations');
        expect(bridge).toContain('timestamp');
        expect(bridge).toContain('tested origin');
        expect(bridge).toContain('commit and deployment identifiers');
        expect(bridge).toContain('explicit approval');
    });

    it('cross-references the cutover gate from the App Check rollout', () => {
        const normalizedRollout = normalize(appCheckRollout);
        expect(normalizedRollout).toContain('[hosting cutover runbook](hosting-cutover-runbook.md)');
        expect(normalizedRollout).toMatch(/candidate-host validation and DNS cutover observation/i);
        expect(normalizedRollout).toContain('every Firebase API remains **Unenforced**');
    });
});
