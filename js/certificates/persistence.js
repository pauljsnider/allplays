import { functions, httpsCallable } from '../firebase.js?v=25';

export async function commitCertificateDefaults(teamId, defaults = {}) {
    if (!teamId) throw new Error('Missing team for certificate defaults');
    const callable = httpsCallable(functions, 'commitCertificateDefaults');
    const response = await callable({ teamId, defaults });
    return response?.data?.defaults || defaults;
}
