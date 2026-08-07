#!/usr/bin/env node
import { auditParentCoverageMailboxAccess } from './parent-coverage-mailbox.mjs';

await auditParentCoverageMailboxAccess({
    clientId: process.env.PARENT_CENSUS_MAILBOX_CLIENT_ID || '',
    clientSecret: process.env.PARENT_CENSUS_MAILBOX_CLIENT_SECRET || '',
    refreshToken: process.env.PARENT_CENSUS_MAILBOX_REFRESH_TOKEN || ''
});
console.log('Parent coverage mailbox authorization passed.');
