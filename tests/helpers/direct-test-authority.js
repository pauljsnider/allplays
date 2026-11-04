import { createOneActionApproval } from '../../services/chatgpt-mcp/src/directActionApproval.js';

// Synthetic identity only for direct in-memory composition tests. Network tests
// exercise the real broker/session authenticator instead.
export const createTestActionAuthority = () => createOneActionApproval({ getActor: async () => ({
    uid: 'owner', clientId: 'synthetic-client', grantKey: 'synthetic-grant', expiresAt: Date.now() + 120000
}) });
