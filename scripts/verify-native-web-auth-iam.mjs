import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const serviceAccountTokenCreatorRole = 'roles/iam.serviceAccountTokenCreator';

function normalizeServiceAccountEmail(value) {
    const email = typeof value === 'string' ? value.trim().toLowerCase() : '';
    return /^[^\s@]+@[^\s@]+\.gserviceaccount\.com$/.test(email) ? email : '';
}

export function hasSelfTokenCreatorBinding(policy, serviceAccountEmail) {
    const email = normalizeServiceAccountEmail(serviceAccountEmail);
    if (!email || !policy || typeof policy !== 'object' || !Array.isArray(policy.bindings)) {
        return false;
    }
    const member = `serviceaccount:${email}`;
    return policy.bindings.some((binding) => (
        binding?.role === serviceAccountTokenCreatorRole
        && Array.isArray(binding.members)
        && binding.members.some((candidate) => String(candidate).trim().toLowerCase() === member)
    ));
}

function readArgument(name) {
    const index = process.argv.indexOf(name);
    return index >= 0 ? process.argv[index + 1] : '';
}

function run() {
    const policyPath = readArgument('--policy');
    const serviceAccountEmail = readArgument('--service-account');
    if (!policyPath || !serviceAccountEmail) {
        throw new Error('Usage: node scripts/verify-native-web-auth-iam.mjs --policy <path> --service-account <email>');
    }

    const policy = JSON.parse(readFileSync(policyPath, 'utf8'));
    if (!hasSelfTokenCreatorBinding(policy, serviceAccountEmail)) {
        console.error(
            `The Functions runtime service account ${serviceAccountEmail} must grant itself ${serviceAccountTokenCreatorRole} before native WebView authentication can deploy.`
        );
        process.exitCode = 1;
        return;
    }
    console.log('Native WebView custom-token IAM binding is present.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    run();
}
