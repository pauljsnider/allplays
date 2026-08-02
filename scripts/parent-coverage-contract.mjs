import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

export const CATALOG_SCHEMA_VERSION = 'parent-coverage-catalog-v1';
export const CONTRACT_SCHEMA_VERSION = 'parent-coverage-contract-v1';
export const REPORT_SCHEMA_VERSION = 'parent-coverage-report-v1';

const actorNames = new Set(['anonymous', 'primary', 'peer', 'lifecycle']);
const viewportNames = new Set(['mobile', 'desktop']);
const actions = new Set([
    'login',
    'goto',
    'reload',
    'click',
    'clickAndExpectGoogleAuth',
    'clickAndExpectRoute',
    'clickAndExpectDownload',
    'clickAndExpectStripeCheckout',
    'fill',
    'fillActorEmail',
    'fillActorPassword',
    'check',
    'uncheck',
    'select',
    'rememberControl',
    'restoreControl',
    'openLatestMailboxLink',
    'openRunScopedShareLink',
    'uploadSyntheticImage',
    'uploadSyntheticDocument',
    'expectVisible',
    'expectHidden',
    'expectText',
    'expectNoText',
    'expectRoute',
    'logout'
]);
const locatorKinds = new Set(['role', 'label', 'text', 'testId']);
const allowedRoles = new Set([
    'button', 'checkbox', 'combobox', 'dialog', 'form', 'heading', 'link',
    'list', 'listitem', 'menuitem', 'option', 'radio', 'status', 'tab',
    'textbox'
]);
const allowedTemplateNames = new Set([
    'TEAM_ID', 'PLAYER_ID', 'GAME_ID', 'EVENT_ID', 'REGISTRATION_FORM_ID',
    'CONVERSATION_ID', 'RUN_MARKER', 'LIFECYCLE_EMAIL', 'LIFECYCLE_INVITE_CODE'
]);
const lifecycleTransitionWorkflowIds = new Set(['P02', 'P03', 'P04', 'P05', 'P08', 'P27', 'P37']);
const baseWorkflowActions = [
    'login', 'goto', 'reload', 'expectVisible', 'expectHidden', 'expectText',
    'expectNoText', 'expectRoute', 'logout'
];
const workflowCapabilities = new Map(Object.entries({
    P01: { mode: 'readOnly', routes: ['/accept-invite'], actions: [] },
    P02: { mode: 'lifecycle', routes: ['/auth', '/verify-pending'], actions: ['fill', 'fillActorEmail', 'fillActorPassword', 'click'] },
    P03: { mode: 'lifecycle', routes: ['/verify-pending', '/reset-password', '/auth'], actions: ['click', 'openLatestMailboxLink'] },
    P04: { mode: 'lifecycle', routes: ['/auth', '/home'], actions: ['click'] },
    P05: { mode: 'lifecycle', routes: ['/auth', '/reset-password'], actions: ['fill', 'fillActorEmail', 'fillActorPassword', 'click', 'openLatestMailboxLink'] },
    P06: { mode: 'readOnly', routes: ['/auth', '/home'], actions: [] },
    P07: { mode: 'readOnly', routes: ['/auth'], actions: ['clickAndExpectGoogleAuth'] },
    P08: { mode: 'lifecycle', routes: ['/accept-invite', '/parent-tools/access'], actions: ['fill', 'click'] },
    P09: { mode: 'reversible', routes: ['/parent-tools/access'], actions: ['fill', 'select', 'click'] },
    P10: { mode: 'readOnly', routes: ['/home', '/parent-tools/*'], actions: ['clickAndExpectRoute'] },
    P11: { mode: 'readOnly', routes: ['/teams/{TEAM_ID}', '/players/{TEAM_ID}/{PLAYER_ID}'], actions: [] },
    P12: { mode: 'reversible', routes: ['/profile/settings'], actions: ['rememberControl', 'fill', 'click', 'restoreControl'] },
    P13: { mode: 'reversible', routes: ['/profile/settings'], actions: ['click', 'uploadSyntheticImage'] },
    P14: { mode: 'reversible', routes: ['/players/{TEAM_ID}/{PLAYER_ID}'], actions: ['rememberControl', 'fill', 'click', 'restoreControl', 'uploadSyntheticImage'] },
    P15: { mode: 'readOnly', routes: ['/players/{TEAM_ID}/{PLAYER_ID}'], actions: [] },
    P16: { mode: 'readOnly', routes: ['/schedule', '/schedule/{TEAM_ID}/{EVENT_ID}'], actions: ['select'] },
    P17: { mode: 'reversible', routes: ['/schedule/{TEAM_ID}/{EVENT_ID}'], actions: ['rememberControl', 'fill', 'click', 'restoreControl'] },
    P18: { mode: 'readOnly', routes: ['/schedule/{TEAM_ID}/{EVENT_ID}'], actions: [] },
    P19: { mode: 'reversible', routes: ['/schedule/{TEAM_ID}/{EVENT_ID}'], actions: ['rememberControl', 'check', 'uncheck', 'click', 'restoreControl'] },
    P20: { mode: 'reversible', routes: ['/schedule/{TEAM_ID}/{EVENT_ID}'], actions: ['fill', 'click'] },
    P21: { mode: 'reversible', routes: ['/schedule/{TEAM_ID}/{EVENT_ID}'], actions: ['fill', 'select', 'click'] },
    P22: { mode: 'reversible', routes: ['/schedule/{TEAM_ID}/{EVENT_ID}'], actions: ['fill', 'click'] },
    P23: { mode: 'reversible', routes: ['/messages', '/messages/{TEAM_ID}'], actions: ['fill', 'check', 'uncheck', 'click'] },
    P24: { mode: 'reversible', routes: ['/messages/{TEAM_ID}'], actions: ['fill', 'click', 'uploadSyntheticImage'] },
    P25: { mode: 'reversible', routes: ['/home', '/messages/*', '/schedule/*', '/players/*', '/teams/*', '/profile/settings'], actions: ['rememberControl', 'check', 'uncheck', 'click', 'clickAndExpectRoute', 'restoreControl'] },
    P26: { mode: 'reversible', routes: ['/home', '/people/*', '/messages/*'], actions: ['fill', 'click'] },
    P27: { mode: 'lifecycle', routes: ['/parent-tools/household', '/accept-invite'], actions: ['fill', 'click', 'openLatestMailboxLink'] },
    P28: { mode: 'reversible', routes: ['/parent-tools/share', '/family/*'], actions: ['fill', 'click', 'openRunScopedShareLink'] },
    P29: { mode: 'readOnly', routes: ['/parent-tools/calendar'], actions: ['clickAndExpectDownload'] },
    P30: { mode: 'readOnly', routes: ['/parent-tools/fees'], actions: ['clickAndExpectStripeCheckout'] },
    P31: { mode: 'readOnly', routes: ['/parent-tools/registrations', '/parent-tools/registrations/{TEAM_ID}/{REGISTRATION_FORM_ID}'], actions: ['clickAndExpectStripeCheckout'] },
    P32: { mode: 'readOnly', routes: ['/parent-tools/certificates', '/teams/{TEAM_ID}/certificates'], actions: ['clickAndExpectDownload'] },
    P33: { mode: 'reversible', routes: ['/teams/{TEAM_ID}/media'], actions: ['fill', 'click', 'uploadSyntheticImage'] },
    P34: { mode: 'reversible', routes: ['/home', '/people/*'], actions: ['fill', 'click', 'uploadSyntheticImage'] },
    P35: { mode: 'reversible', routes: ['/ai'], actions: ['fill', 'click'] },
    P36: { mode: 'reversible', routes: ['/ai'], actions: ['fill', 'click', 'uploadSyntheticImage', 'uploadSyntheticDocument'] },
    P37: { mode: 'lifecycle', routes: ['/profile/settings'], actions: ['fill', 'fillActorPassword', 'click'] }
}));
const stateChangingActions = new Set([
    'click', 'fill', 'fillActorEmail', 'fillActorPassword', 'check', 'uncheck',
    'select', 'restoreControl', 'uploadSyntheticImage', 'uploadSyntheticDocument'
]);
const reversibleMutationActions = new Set([
    'click', 'fill', 'check', 'uncheck', 'select', 'restoreControl', 'uploadSyntheticImage', 'uploadSyntheticDocument'
]);
const controlMutationActions = new Set(['fill', 'check', 'uncheck', 'select']);
const workflowCoverageRequirements = new Map(Object.entries({
    P01: [
        { action: 'goto', actor: 'anonymous', route: /^\/accept-invite/ },
        { actions: ['expectVisible', 'expectText'], actor: 'anonymous', target: /invite|code|sign in/i }
    ],
    P02: [
        { action: 'fillActorEmail', actor: 'lifecycle', target: /email/i },
        { action: 'fillActorPassword', actor: 'lifecycle', target: /password/i },
        { action: 'click', actor: 'lifecycle', target: /create account|sign up/i },
        { actions: ['expectVisible', 'expectText', 'expectRoute'], actor: 'lifecycle', target: /verify|email/i, route: /verify-pending/ }
    ],
    P03: [
        { action: 'click', actor: 'lifecycle', target: /resend verification/i },
        { action: 'openLatestMailboxLink', actor: 'lifecycle', option: 'verifyEmail' },
        { actions: ['expectVisible', 'expectText', 'expectRoute'], actor: 'lifecycle', target: /verified|continue/i, route: /verify-pending|auth/ }
    ],
    P04: [
        { action: 'login', actor: 'lifecycle' },
        { action: 'click', actor: 'lifecycle', target: /continue|get started|finish/i },
        { actions: ['expectVisible', 'expectText', 'expectRoute'], actor: 'lifecycle', target: /home|welcome|action/i, route: /home/ }
    ],
    P05: [
        { action: 'click', actor: 'lifecycle', target: /forgot password/i },
        { action: 'fillActorEmail', actor: 'lifecycle', target: /email/i },
        { action: 'click', actor: 'lifecycle', target: /send reset/i },
        { action: 'openLatestMailboxLink', actor: 'lifecycle', option: 'resetPassword' },
        { action: 'fillActorPassword', actor: 'lifecycle', target: /new password|password/i },
        { action: 'click', actor: 'lifecycle', target: /reset password/i },
        { actions: ['expectVisible', 'expectText', 'expectRoute'], actor: 'lifecycle', target: /sign in|login|password.*reset/i, route: /auth|reset-password/ }
    ],
    P06: [
        { action: 'login', actor: 'primary' },
        { action: 'reload', actor: 'primary' },
        { actions: ['expectVisible', 'expectText', 'expectRoute'], actor: 'primary', target: /home|account|profile/i, route: /home/ },
        { action: 'logout', actor: 'primary' }
    ],
    P07: [
        { action: 'goto', actor: 'anonymous', route: /^\/auth/ },
        { action: 'clickAndExpectGoogleAuth', actor: 'anonymous', target: /google/i },
        { action: 'expectRoute', actor: 'anonymous', route: /^\/auth/ }
    ],
    P08: [
        { action: 'fill', actor: 'lifecycle', target: /join code|invite code|access code/i, value: /\{LIFECYCLE_INVITE_CODE\}/ },
        { action: 'click', actor: 'lifecycle', target: /redeem|join|apply code|accept invite/i },
        { actions: ['expectVisible', 'expectText', 'expectRoute'], actor: 'lifecycle', target: /team|access|joined/i, route: /parent-tools\/access|accept-invite/ }
    ],
    P09: [
        { action: 'fill', actor: 'primary', target: /player search|search/i, value: /\{RUN_MARKER\}/ },
        { action: 'click', actor: 'primary', target: /request access|send request/i },
        { actions: ['expectVisible', 'expectText'], actor: 'primary', target: /pending|request.*sent|cancel request/i }
    ],
    P10: [
        { action: 'goto', actor: 'primary', route: /^\/home/ },
        { actions: ['expectVisible', 'expectText'], actor: 'primary', target: /action|upcoming|task|schedule/i },
        { action: 'clickAndExpectRoute', actor: 'primary', target: /schedule|task|ride|notification/i, route: /parent-tools|schedule|messages|profile/ }
    ],
    P11: [
        { action: 'goto', actor: 'primary', route: /^\/teams\/\{TEAM_ID\}/ },
        { actions: ['expectHidden', 'expectNoText'], actor: 'primary', target: /admin|manager|coach|roster edit/i },
        { action: 'goto', actor: 'primary', route: /^\/players\/\{TEAM_ID\}\/\{PLAYER_ID\}/ },
        { actions: ['expectVisible', 'expectText'], actor: 'primary', target: /player|athlete|parent/i }
    ],
    P12: [
        { action: 'rememberControl', actor: 'primary', target: /name/i },
        { action: 'rememberControl', actor: 'primary', target: /phone/i },
        { action: 'fill', actor: 'primary', target: /name/i, value: /\{RUN_MARKER\}/ },
        { action: 'fill', actor: 'primary', target: /phone/i },
        { action: 'click', actor: 'primary', target: /save|update profile/i },
        { actions: ['expectVisible', 'expectText'], actor: 'primary', target: /saved|updated|\{RUN_MARKER\}/i },
        { action: 'restoreControl', phase: 'cleanup', actor: 'primary', target: /name/i },
        { action: 'restoreControl', phase: 'cleanup', actor: 'primary', target: /phone/i },
        { action: 'click', phase: 'cleanup', actor: 'primary', target: /save|update profile/i }
    ],
    P13: [
        { actions: ['expectHidden', 'expectNoText'], actor: 'primary', target: /remove image|remove photo/i },
        { action: 'uploadSyntheticImage', actor: 'primary', target: /profile image|profile photo|image|photo/i },
        { action: 'click', actor: 'primary', target: /save|upload/i },
        { actions: ['expectVisible', 'expectText'], actor: 'primary', target: /remove image|remove photo|uploaded/i },
        { action: 'click', phase: 'cleanup', actor: 'primary', target: /remove image|remove photo/i }
    ],
    P14: [
        { action: 'rememberControl', actor: 'primary', target: /name|details/i },
        { action: 'fill', actor: 'primary', target: /name|details/i, value: /\{RUN_MARKER\}/ },
        { action: 'uploadSyntheticImage', actor: 'primary', target: /image|photo/i },
        { action: 'click', actor: 'primary', target: /save|save changes/i },
        { actions: ['expectVisible', 'expectText'], actor: 'primary', target: /saved|updated|\{RUN_MARKER\}/i },
        { action: 'restoreControl', phase: 'cleanup', actor: 'primary', target: /name|details/i },
        { action: 'click', phase: 'cleanup', actor: 'primary', target: /save|save changes/i }
    ],
    P15: [
        { action: 'goto', actor: 'primary', route: /^\/players\/\{TEAM_ID\}\/\{PLAYER_ID\}/ },
        { actions: ['expectVisible', 'expectText'], actor: 'primary', target: /incentive|award|achievement/i },
        { actions: ['expectHidden', 'expectNoText'], actor: 'primary', target: /edit roster|remove player|manager/i }
    ],
    P16: [
        { action: 'goto', actor: 'primary', route: /^\/schedule/ },
        { action: 'select', actor: 'primary', target: /team|filter|calendar|date/i },
        { actions: ['expectVisible', 'expectText'], actor: 'primary', target: /event|game|practice|schedule/i },
        { action: 'goto', actor: 'primary', route: /^\/schedule\/\{TEAM_ID\}\/\{EVENT_ID\}/ },
        { actions: ['expectVisible', 'expectText'], actor: 'primary', target: /event|game|practice/i }
    ],
    P17: [
        { action: 'rememberControl', actor: 'primary', target: /rsvp|going|not going|maybe/i },
        { action: 'rememberControl', actor: 'primary', target: /note/i },
        { action: 'rememberControl', actor: 'primary', target: /sibling/i },
        { action: 'select', actor: 'primary', target: /rsvp|going|not going|maybe/i },
        { action: 'fill', actor: 'primary', target: /note/i, value: /\{RUN_MARKER\}/ },
        { action: 'fill', actor: 'primary', target: /sibling/i, value: /\{RUN_MARKER\}/ },
        { action: 'click', actor: 'primary', target: /save|update rsvp/i },
        { actions: ['expectVisible', 'expectText'], actor: 'primary', target: /saved|updated|\{RUN_MARKER\}/i },
        { action: 'restoreControl', phase: 'cleanup', actor: 'primary', target: /rsvp|going|not going|maybe/i },
        { action: 'restoreControl', phase: 'cleanup', actor: 'primary', target: /note/i },
        { action: 'restoreControl', phase: 'cleanup', actor: 'primary', target: /sibling/i },
        { action: 'click', phase: 'cleanup', actor: 'primary', target: /save|update rsvp/i }
    ],
    P18: [
        { action: 'goto', actor: 'primary', route: /^\/schedule\/\{TEAM_ID\}\/\{EVENT_ID\}/ },
        { actions: ['expectVisible', 'expectText'], actor: 'primary', target: /attendance|present|absent|practice/i },
        { actions: ['expectHidden', 'expectNoText'], actor: 'primary', target: /edit attendance|take attendance|manager/i }
    ],
    P19: [
        { action: 'rememberControl', actor: 'primary', target: /packet|form|complete|checklist/i },
        { actions: ['check', 'uncheck'], actor: 'primary', target: /packet|form|complete|checklist/i },
        { action: 'click', actor: 'primary', target: /save|submit/i },
        { actions: ['expectVisible', 'expectText'], actor: 'primary', target: /saved|complete|submitted/i },
        { action: 'restoreControl', phase: 'cleanup', actor: 'primary', target: /packet|form|complete|checklist/i },
        { action: 'click', phase: 'cleanup', actor: 'primary', target: /save|submit/i }
    ],
    P20: [
        { action: 'click', actor: 'primary', target: /claim/i },
        { actions: ['expectVisible', 'expectText'], actor: 'primary', target: /claimed|release|you/i },
        { actions: ['expectVisible', 'expectText'], actor: 'peer', target: /claimed|unavailable|primary/i },
        { action: 'click', phase: 'cleanup', actor: 'primary', target: /release/i }
    ],
    P21: [
        { action: 'fill', actor: 'primary', target: /ride|seat|address|note/i, value: /\{RUN_MARKER\}/ },
        { action: 'click', actor: 'primary', target: /offer ride|create offer/i },
        { action: 'click', actor: 'primary', target: /close offer/i },
        { action: 'click', actor: 'primary', target: /reopen offer/i },
        { actions: ['expectVisible', 'expectText'], actor: 'primary', target: /open|available|\{RUN_MARKER\}/i },
        { action: 'click', phase: 'cleanup', actor: 'primary', target: /close offer|cancel/i }
    ],
    P22: [
        { action: 'click', actor: 'peer', target: /request ride/i },
        { actions: ['expectVisible', 'expectText'], actor: 'primary', target: /ride request|pending|peer/i },
        { action: 'click', actor: 'primary', target: /approve|accept|deny|decline/i },
        { actions: ['expectVisible', 'expectText'], actor: 'peer', target: /approved|accepted|denied|declined/i },
        { action: 'click', phase: 'cleanup', actor: 'peer', target: /cancel/i }
    ],
    P23: [
        { action: 'fill', actor: 'primary', target: /message|chat/i, value: /\{RUN_MARKER\}/ },
        { action: 'click', actor: 'primary', target: /send/i },
        { actions: ['expectVisible', 'expectText'], actor: 'peer', target: /\{RUN_MARKER\}|message/i, value: /\{RUN_MARKER\}/ },
        { actions: ['expectVisible', 'expectText'], actor: 'primary', target: /read|seen/i },
        { action: 'click', actor: 'peer', target: /mute/i },
        { actions: ['expectVisible', 'expectText'], actor: 'peer', target: /muted|unmute/i },
        { action: 'click', phase: 'cleanup', actor: 'primary', target: /delete message/i },
        { action: 'click', phase: 'cleanup', actor: 'peer', target: /unmute/i }
    ],
    P24: [
        { action: 'uploadSyntheticImage', actor: 'primary', target: /attachment|image|photo|upload/i },
        { action: 'click', actor: 'primary', target: /send/i },
        { actions: ['expectVisible', 'expectText'], actor: 'peer', target: /allplays-parent-census|attachment|image/i },
        { action: 'click', phase: 'cleanup', actor: 'primary', target: /delete message|remove attachment/i }
    ],
    P25: [
        { actions: ['expectVisible', 'expectText'], actor: 'peer', target: /notification|new|unread/i },
        { action: 'clickAndExpectRoute', actor: 'peer', target: /notification|open notification/i, route: /messages|schedule|players|teams/ },
        { actions: ['expectVisible', 'expectText', 'expectNoText'], actor: 'peer', target: /read|seen|no new notifications|unread/i },
        { action: 'rememberControl', actor: 'primary', target: /email|push|sms|mute/i },
        { actions: ['check', 'uncheck'], actor: 'primary', target: /email|push|sms|mute/i },
        { action: 'click', actor: 'primary', target: /save/i },
        { action: 'restoreControl', phase: 'cleanup', actor: 'primary', target: /email|push|sms|mute/i },
        { action: 'click', phase: 'cleanup', actor: 'primary', target: /save/i }
    ],
    P26: [
        { action: 'click', actor: 'primary', target: /add friend/i },
        { action: 'click', actor: 'peer', target: /accept/i },
        { action: 'fill', actor: 'primary', target: /message|chat/i, value: /\{RUN_MARKER\}/ },
        { action: 'click', actor: 'primary', target: /send/i },
        { actions: ['expectVisible', 'expectText'], actor: 'peer', target: /\{RUN_MARKER\}|message/i, value: /\{RUN_MARKER\}/ },
        { action: 'click', phase: 'cleanup', actor: 'primary', target: /remove friend|delete message/i }
    ],
    P27: [
        { action: 'fill', actor: 'primary', target: /email/i, value: /\{LIFECYCLE_EMAIL\}/ },
        { action: 'click', actor: 'primary', target: /send invite/i },
        { action: 'openLatestMailboxLink', actor: 'lifecycle', option: 'invite' },
        { action: 'click', actor: 'lifecycle', target: /accept invite/i },
        { actions: ['expectVisible', 'expectText'], actor: 'primary', target: /\{LIFECYCLE_EMAIL\}|household/i },
        { action: 'click', actor: 'primary', target: /revoke.*\{LIFECYCLE_EMAIL\}/i }
    ],
    P28: [
        { action: 'fill', actor: 'primary', target: /share|family|email/i, value: /\{RUN_MARKER\}/ },
        { action: 'click', actor: 'primary', target: /create share/i },
        { action: 'openRunScopedShareLink', actor: 'anonymous', option: 'primary' },
        { actions: ['expectVisible', 'expectText'], actor: 'anonymous', target: /family|shared|privacy/i },
        { actions: ['expectHidden', 'expectNoText'], actor: 'anonymous', target: /private|email|phone|edit/i },
        { action: 'click', phase: 'cleanup', actor: 'primary', target: /revoke share/i }
    ],
    P29: [
        { action: 'clickAndExpectDownload', actor: 'primary', target: /calendar|ics|export/i },
        { actions: ['expectVisible', 'expectText'], actor: 'primary', target: /calendar|feed|download/i }
    ],
    P30: [
        { actions: ['expectVisible', 'expectText'], actor: 'primary', target: /fee|balance|payment/i },
        { action: 'clickAndExpectStripeCheckout', actor: 'primary', target: /pay|checkout/i }
    ],
    P31: [
        { actions: ['expectVisible', 'expectText'], actor: 'primary', target: /registration|form|browse/i },
        { action: 'clickAndExpectStripeCheckout', actor: 'primary', target: /register|checkout|pay/i }
    ],
    P32: [
        { actions: ['expectVisible', 'expectText'], actor: 'primary', target: /award|certificate/i },
        { action: 'clickAndExpectDownload', actor: 'primary', target: /download|certificate|award/i }
    ],
    P33: [
        { actions: ['expectVisible', 'expectText'], actor: 'primary', target: /media|member|album/i },
        { actions: ['expectHidden', 'expectNoText'], actor: 'primary', target: /manage upload permissions|bulk delete|moderate all media/i },
        { action: 'uploadSyntheticImage', actor: 'primary', target: /photo|image|upload/i },
        { actions: ['expectVisible', 'expectText'], actor: 'primary', target: /allplays-parent-census|uploaded|media/i },
        { action: 'click', phase: 'cleanup', actor: 'primary', target: /remove media|delete media/i }
    ],
    P34: [
        { action: 'fill', actor: 'primary', target: /post|social|caption/i, value: /\{RUN_MARKER\}/ },
        { action: 'uploadSyntheticImage', actor: 'primary', target: /image|photo|upload/i },
        { action: 'click', actor: 'primary', target: /publish/i },
        { actions: ['expectVisible', 'expectText'], actor: 'peer', target: /\{RUN_MARKER\}|post/i, value: /\{RUN_MARKER\}/ },
        { action: 'click', actor: 'peer', target: /like|reaction/i },
        { action: 'fill', actor: 'peer', target: /comment/i, value: /\{RUN_MARKER\}/ },
        { action: 'click', actor: 'peer', target: /send|publish/i },
        { action: 'click', actor: 'primary', target: /moderate|hide post/i },
        { action: 'click', phase: 'cleanup', actor: 'primary', target: /delete post/i }
    ],
    P35: [
        { action: 'fill', actor: 'primary', target: /prompt|chat/i, value: /\{RUN_MARKER\}/ },
        { action: 'click', actor: 'primary', target: /send/i },
        { actions: ['expectVisible', 'expectText'], actor: 'primary', target: /parent|schedule|task|\{RUN_MARKER\}/i },
        { actions: ['expectHidden', 'expectNoText'], actor: 'primary', target: /manager|admin|coach tool/i },
        { action: 'click', phase: 'cleanup', actor: 'primary', target: /delete message/i }
    ],
    P36: [
        { action: 'uploadSyntheticImage', actor: 'primary', target: /attachment|image|upload/i },
        { actions: ['expectVisible', 'expectText'], actor: 'primary', target: /allplays-parent-census|image|attachment/i },
        { action: 'uploadSyntheticDocument', actor: 'primary', target: /attachment|document|upload/i },
        { actions: ['expectVisible', 'expectText'], actor: 'primary', target: /allplays-parent-census|document|pdf/i },
        { action: 'fill', actor: 'primary', target: /prompt|chat/i, value: /\{RUN_MARKER\}/ },
        { action: 'click', actor: 'primary', target: /send/i },
        { actions: ['expectVisible', 'expectText'], actor: 'primary', target: /response|assistant|\{RUN_MARKER\}/i },
        { action: 'click', phase: 'cleanup', actor: 'primary', target: /delete message/i }
    ],
    P37: [
        { action: 'fillActorPassword', actor: 'lifecycle', target: /password/i },
        { action: 'fill', actor: 'lifecycle', target: /type delete to confirm/i, value: /^DELETE$/ },
        { action: 'click', actor: 'lifecycle', target: /delete account|confirm deletion/i },
        { actions: ['expectVisible', 'expectText', 'expectRoute'], actor: 'lifecycle', target: /deleted|sign in|goodbye/i, route: /auth/ }
    ]
}));
const reversibleClickInversePairs = new Map(Object.entries({
    P09: [['request access', 'cancel request'], ['send request', 'cancel request']],
    P13: [['upload', 'remove image'], ['upload image', 'remove image'], ['upload photo', 'remove photo']],
    P14: [['upload', 'remove image'], ['upload image', 'remove image'], ['upload photo', 'remove photo']],
    P20: [['claim', 'release']], P21: [
        ['offer ride', 'cancel'], ['create offer', 'cancel'],
        ['close offer', 'reopen offer'], ['reopen offer', 'close offer']
    ],
    P22: [['request ride', 'cancel'], ['approve', 'cancel'], ['accept', 'cancel']],
    P23: [['send', 'delete message'], ['mute', 'unmute']],
    P24: [['send', 'delete message'], ['upload', 'remove attachment']],
    P26: [['add friend', 'remove friend'], ['accept', 'remove friend'], ['send', 'delete message']],
    P28: [['create share', 'revoke share']],
    P33: [['upload', 'remove media']], P34: [
        ['upload', 'remove image'], ['publish', 'delete post'], ['send', 'delete comment'], ['like', 'unlike'],
        ['reaction', 'unlike'], ['moderate', 'unhide post'], ['hide post', 'unhide post']
    ],
    P35: [['send', 'delete message']], P36: [['send', 'delete message'], ['upload', 'remove attachment']]
}));
const forbiddenMutationTarget = /(?:delete|deactivate|remove)\s+(?:my\s+)?(?:account|profile)|(?:grant|make|promote).*(?:admin|coach|manager|staff)|(?:admin|coach|manager|staff).*(?:access|permission|role)/i;
const mutationTargetCapabilities = new Map(Object.entries({
    P02: { lifecycle: /^(?:email|password|confirm password|join code|create account|sign up|continue)$/i },
    P03: { lifecycle: /^(?:resend verification email|verify email|i've verified, continue|need another option\?|continue to dashboard|continue without verifying|sign out)$/i },
    P04: { lifecycle: /^(?:email|password|sign in|log in|continue|get started)$/i },
    P05: { lifecycle: /^(?:email|password|password reset email|forgot password\?|new password|confirm password|send reset email|reset password|continue to login)$/i },
    P08: { lifecycle: /^(?:join code|invite code|access code|redeem|join|apply code|continue with code|sign in to accept|create account with code|accept invite|continue)$/i },
    P09: { primary: /^(?:player search|search|team|player|relationship|request access|send request|cancel request)$/i },
    P12: { primary: /^(?:name|phone|save|save changes|update profile)$/i },
    P13: { primary: /^(?:profile image|profile photo|image|photo|upload|upload image|remove image|remove photo|save|cancel)$/i },
    P14: { primary: /^(?:child|athlete|player|name|details|image|photo|upload|upload image|remove image|remove photo|save|save changes)$/i },
    P16: { primary: /^(?:team|filter|calendar|date|schedule|event|apply|reset filters)$/i },
    P17: { primary: /^(?:rsvp|going|not going|maybe|note|sibling|save|update rsvp)$/i },
    P19: { primary: /^(?:packet|form|complete|incomplete|checklist|save|submit)$/i },
    P20: {
        primary: /^(?:task|assignment|claim|release|volunteer|save|cancel)$/i,
        peer: /^(?:task|assignment|claim|release|volunteer|save|cancel)$/i
    },
    P21: { primary: /^(?:ride|rideshare|seat|address|note|offer ride|create offer|close offer|reopen offer|save|cancel)$/i },
    P22: {
        primary: /^(?:ride|request ride|approve|deny|accept|decline|cancel)$/i,
        peer: /^(?:ride|request ride|approve|deny|accept|decline|cancel)$/i
    },
    P23: {
        primary: /^(?:message|chat|mute|unmute|send|delete message|mark read)$/i,
        peer: /^(?:message|chat|mute|unmute|send|delete message|mark read)$/i
    },
    P24: {
        primary: /^(?:message|chat|attachment|image|photo|upload|send|delete message|remove attachment)$/i,
        peer: /^(?:message|chat|attachment|image|photo|upload|send|delete message|remove attachment)$/i
    },
    P25: {
        primary: /^(?:notification|notifications|preference|preferences|mute|email|push|sms|save|mark read)$/i,
        peer: /^(?:notification|notifications|preference|preferences|mute|email|push|sms|save|mark read)$/i
    },
    P26: {
        primary: /^(?:friend|search|add friend|accept|remove friend|message|chat|send|delete message)$/i,
        peer: /^(?:friend|search|add friend|accept|remove friend|message|chat|send|delete message)$/i
    },
    P27: {
        primary: /^(?:household|invite|email|relation|send invite|revoke (?:invite|access) for \{LIFECYCLE_EMAIL\})$/i,
        lifecycle: /^(?:invite code|accept invite|continue)$/i
    },
    P28: { primary: /^(?:share|family|privacy|email|create share|revoke share)$/i },
    P33: { primary: /^(?:media|photo|image|upload|title|caption|share|remove media|delete media)$/i },
    P34: {
        primary: /^(?:social|post|image|photo|upload|reaction|like|unlike|comment|moderate|hide post|unhide post|delete post|delete comment|remove image|send|publish)$/i,
        peer: /^(?:social|post|image|photo|upload|reaction|like|unlike|comment|moderate|hide post|unhide post|delete post|delete comment|remove image|send|publish)$/i
    },
    P35: { primary: /^(?:ai|chat|prompt|send|delete message|clear chat|new conversation)$/i },
    P36: { primary: /^(?:ai|chat|prompt|attachment|image|document|upload|send|delete message|remove attachment|clear chat|new conversation)$/i },
    P37: { lifecycle: /^(?:password|type delete to confirm|account password \(email sign-in only\)|cancel account deletion|delete account|confirm deletion|confirm|cancel)$/i }
}));
const readOnlyInteractionTargetCapabilities = new Map(Object.entries({
    P07: { clickAndExpectGoogleAuth: /^(?:continue with google|sign in with google|google)$/i },
    P10: { clickAndExpectRoute: /^(?:schedule|tasks?|rideshare|notifications?|profile|view all)$/i },
    P25: { clickAndExpectRoute: /^(?:notification|open notification)$/i },
    P29: { clickAndExpectDownload: /^(?:download calendar|download ics|calendar feed|export calendar)$/i },
    P30: { clickAndExpectStripeCheckout: /^(?:pay|pay fee|checkout|continue to checkout)$/i },
    P31: { clickAndExpectStripeCheckout: /^(?:register|start registration|checkout|continue to checkout|pay registration fee)$/i },
    P32: { clickAndExpectDownload: /^(?:download|download certificate|download award)$/i }
}));
const forbiddenText = /(?:https?:\/\/|javascript:|data:text|[\r\n]|\$\{|<script|authorization|cookie)/i;
const stepKeysByAction = new Map([
    ['login', ['action', 'actor']],
    ['goto', ['action', 'actor', 'route']],
    ['reload', ['action', 'actor']],
    ['click', ['action', 'actor', 'target', 'mutationId', 'scope', 'commitMutation']],
    ['clickAndExpectGoogleAuth', ['action', 'actor', 'target']],
    ['clickAndExpectRoute', ['action', 'actor', 'target', 'route']],
    ['clickAndExpectDownload', ['action', 'actor', 'target']],
    ['clickAndExpectStripeCheckout', ['action', 'actor', 'target']],
    ['fill', ['action', 'actor', 'target', 'value', 'mutationId', 'scope', 'commitMutation']],
    ['fillActorEmail', ['action', 'actor', 'target']],
    ['fillActorPassword', ['action', 'actor', 'target']],
    ['check', ['action', 'actor', 'target', 'mutationId', 'scope', 'commitMutation']],
    ['uncheck', ['action', 'actor', 'target', 'mutationId', 'scope', 'commitMutation']],
    ['select', ['action', 'actor', 'target', 'option', 'mutationId', 'scope', 'commitMutation']],
    ['rememberControl', ['action', 'actor', 'target', 'option']],
    ['restoreControl', ['action', 'actor', 'target', 'option', 'mutationId', 'scope']],
    ['openLatestMailboxLink', ['action', 'actor', 'option']],
    ['openRunScopedShareLink', ['action', 'actor', 'option']],
    ['uploadSyntheticImage', ['action', 'actor', 'target', 'mutationId', 'scope', 'commitMutation']],
    ['uploadSyntheticDocument', ['action', 'actor', 'target', 'mutationId', 'scope', 'commitMutation']],
    ['expectVisible', ['action', 'actor', 'target']],
    ['expectHidden', ['action', 'actor', 'target']],
    ['expectText', ['action', 'actor', 'target', 'value']],
    ['expectNoText', ['action', 'actor', 'target', 'value']],
    ['expectRoute', ['action', 'actor', 'route']],
    ['logout', ['action', 'actor']]
]);

function assertPlainObject(value, label) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error(`${label} must be an object`);
    }
}

function assertSafeText(value, label, maxLength = 240) {
    if (typeof value !== 'string' || !value.trim() || value.length > maxLength || forbiddenText.test(value)) {
        throw new Error(`${label} must be non-empty safe text no longer than ${maxLength} characters`);
    }
}

function assertKnownKeys(value, allowed, label) {
    for (const key of Object.keys(value)) {
        if (!allowed.has(key)) throw new Error(`${label} contains unsupported key ${key}`);
    }
}

function validateTemplates(value, label) {
    for (const match of String(value).matchAll(/\{([A-Z0-9_]+)\}/g)) {
        if (!allowedTemplateNames.has(match[1])) {
            throw new Error(`${label} contains unsupported template ${match[1]}`);
        }
    }
}

export function validateCatalog(catalog) {
    assertPlainObject(catalog, 'catalog');
    if (catalog.schemaVersion !== CATALOG_SCHEMA_VERSION) {
        throw new Error(`catalog schemaVersion must be ${CATALOG_SCHEMA_VERSION}`);
    }
    if (!Array.isArray(catalog.workflows) || catalog.workflows.length === 0) {
        throw new Error('catalog workflows must be a non-empty array');
    }
    const ids = new Set();
    for (const [index, workflow] of catalog.workflows.entries()) {
        assertPlainObject(workflow, `catalog workflow ${index}`);
        assertKnownKeys(workflow, new Set(['id', 'title', 'group', 'actors']), `catalog workflow ${index}`);
        if (!/^P\d{2}$/.test(workflow.id) || ids.has(workflow.id)) {
            throw new Error(`catalog workflow ${index} has an invalid or duplicate id`);
        }
        ids.add(workflow.id);
        assertSafeText(workflow.title, `catalog workflow ${workflow.id} title`);
        assertSafeText(workflow.group, `catalog workflow ${workflow.id} group`, 40);
        if (!Array.isArray(workflow.actors) || workflow.actors.length === 0) {
            throw new Error(`catalog workflow ${workflow.id} actors must be a non-empty array`);
        }
        for (const actor of workflow.actors) {
            if (!actorNames.has(actor)) throw new Error(`catalog workflow ${workflow.id} has unsupported actor ${actor}`);
        }
    }
    if (ids.size !== workflowCapabilities.size) {
        throw new Error('trusted workflow capability count must match the locked catalog');
    }
    if (workflowCoverageRequirements.size !== ids.size || [...ids].some((id) => !workflowCoverageRequirements.has(id))) {
        throw new Error('trusted workflow coverage requirements must match the locked catalog');
    }
    for (const [workflowId, capability] of workflowCapabilities) {
        if (!ids.has(workflowId)) throw new Error(`trusted workflow capability ${workflowId} is not in the catalog`);
        if (!['readOnly', 'reversible', 'lifecycle'].includes(capability.mode)) {
            throw new Error(`trusted workflow capability ${workflowId} has an invalid mode`);
        }
        if (!Array.isArray(capability.routes) || capability.routes.length === 0) {
            throw new Error(`trusted workflow capability ${workflowId} has no routes`);
        }
        if (!Array.isArray(capability.actions) || capability.actions.some((action) => !actions.has(action))) {
            throw new Error(`trusted workflow capability ${workflowId} has invalid actions`);
        }
        if (capability.mode !== 'readOnly' && !mutationTargetCapabilities.has(workflowId)) {
            throw new Error(`trusted workflow capability ${workflowId} has no mutation target boundary`);
        }
        for (const action of capability.actions.filter((candidate) => candidate.startsWith('clickAndExpect'))) {
            if (!readOnlyInteractionTargetCapabilities.get(workflowId)?.[action]) {
                throw new Error(`trusted workflow capability ${workflowId} has no ${action} target boundary`);
            }
        }
    }
    return catalog;
}

function validateLocator(locator, label) {
    assertPlainObject(locator, label);
    assertKnownKeys(locator, new Set(['kind', 'role', 'name', 'exact']), label);
    if (!locatorKinds.has(locator.kind)) throw new Error(`${label} has unsupported kind`);
    assertSafeText(locator.name, `${label} name`, 160);
    validateTemplates(locator.name, `${label} name`);
    if (locator.kind === 'role' && !allowedRoles.has(locator.role)) {
        throw new Error(`${label} has unsupported role`);
    }
    if (locator.kind !== 'role' && locator.role !== undefined) {
        throw new Error(`${label} role is valid only for role locators`);
    }
    if (locator.exact !== undefined && typeof locator.exact !== 'boolean') {
        throw new Error(`${label} exact must be boolean`);
    }
}

function routeMatchesCapability(route, capabilityRoute, resolved = false) {
    const routePath = String(route).split('?')[0];
    if (resolved) {
        const source = capabilityRoute
            .split(/(\{[A-Z0-9_]+\}|\*)/g)
            .filter(Boolean)
            .map((part) => {
                if (/^\{[A-Z0-9_]+\}$/.test(part)) return '[^/?#]+';
                if (part === '*') return '.*';
                return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            })
            .join('');
        return new RegExp(`^${source}$`).test(routePath);
    }
    if (capabilityRoute.endsWith('/*')) {
        return routePath.startsWith(capabilityRoute.slice(0, -1));
    }
    return routePath === capabilityRoute;
}

function sameTarget(left, right) {
    return JSON.stringify(left?.target) === JSON.stringify(right?.target);
}

function isTrustedClickInverse(workflowId, executionStep, cleanupStep) {
    if (!['click', 'uploadSyntheticImage', 'uploadSyntheticDocument'].includes(executionStep.action) || cleanupStep.action !== 'click') return false;
    const executionName = executionStep.action.startsWith('uploadSynthetic')
        ? 'upload'
        : String(executionStep.target?.name || '').trim().toLowerCase();
    const cleanupName = String(cleanupStep.target?.name || '').trim().toLowerCase();
    return (reversibleClickInversePairs.get(workflowId) || []).some(
        ([forward, inverse]) => executionName === forward && cleanupName === inverse
    );
}

function trustedInverseScopeMatches(workflowId, executionStep, cleanupStep) {
    if (workflowId !== 'P36' || !executionStep.action.startsWith('uploadSynthetic')) return true;
    const suffix = executionStep.action === 'uploadSyntheticImage' ? '.png' : '.pdf';
    return cleanupStep.scope === `{RUN_MARKER}${suffix}`;
}

function isNonProductionReversibleInteraction(workflowId, step) {
    return workflowId === 'P16' && step.action === 'select' &&
        /^(?:team|filter|calendar|date)$/i.test(String(step.target?.name || ''));
}

export function workflowRouteAllowed(workflowId, route, resolved = false) {
    const capability = workflowCapabilities.get(workflowId);
    return Boolean(capability?.routes.some((allowedRoute) => routeMatchesCapability(route, allowedRoute, resolved)));
}

export function assertParentCoverageStepCapability(workflowId, step, phase = 'execution', defaultActor = '') {
    const capability = workflowCapabilities.get(workflowId);
    if (!capability) throw new Error(`${phase} has no trusted workflow capability for ${workflowId}`);
    const allowedActions = new Set([...baseWorkflowActions, ...capability.actions]);
    if (!allowedActions.has(step.action)) {
        throw new Error(`${phase} action ${step.action} is not allowed for ${workflowId}`);
    }
    if (
        phase === 'cleanup' &&
        ['fillActorEmail', 'fillActorPassword', 'openLatestMailboxLink', 'uploadSyntheticImage', 'uploadSyntheticDocument', 'clickAndExpectStripeCheckout'].includes(step.action)
    ) {
        throw new Error(`${phase} action ${step.action} is not allowed for workflow ${workflowId}`);
    }
    if (['goto', 'expectRoute'].includes(step.action) && !workflowRouteAllowed(workflowId, step.route)) {
        throw new Error(`${phase} route is outside the trusted ${workflowId} capability`);
    }
    if (step.action === 'clickAndExpectRoute' && !workflowRouteAllowed(workflowId, step.route)) {
        throw new Error(`${phase} route is outside the trusted ${workflowId} capability`);
    }
    if (phase === 'execution' && step.action === 'restoreControl') {
        throw new Error('restoreControl is restricted to cleanup');
    }
    if (phase === 'cleanup' && step.action === 'rememberControl') {
        throw new Error('rememberControl is restricted to execution');
    }
    if (['rememberControl', 'restoreControl'].includes(step.action) && (
        !['label', 'testId'].includes(step.target?.kind) || step.target?.exact !== true
    )) {
        throw new Error(`${phase} remembered controls must use exact label or testId targets`);
    }
    if (capability.mode !== 'readOnly' && stateChangingActions.has(step.action)) {
        const actor = step.actor || defaultActor;
        const targetName = String(step.target?.name || '');
        const actorTargetCapability = mutationTargetCapabilities.get(workflowId)?.[actor];
        if (
            !actorTargetCapability ||
            (forbiddenMutationTarget.test(targetName) && workflowId !== 'P37') ||
            !actorTargetCapability.test(targetName)
        ) {
            throw new Error(`${phase} target is outside the trusted ${workflowId}/${actor} mutation capability`);
        }
        if (['click'].includes(step.action) && (
            step.target?.kind !== 'role' ||
            !['button', 'link'].includes(step.target?.role) ||
            step.target?.exact !== true
        )) {
            throw new Error(`${phase} click targets must be exact semantic buttons or links`);
        }
        if (['fill', 'fillActorEmail', 'fillActorPassword', 'check', 'uncheck', 'select', 'uploadSyntheticImage', 'uploadSyntheticDocument'].includes(step.action) && (
            !['label', 'testId'].includes(step.target?.kind) || step.target?.exact !== true
        )) {
            throw new Error(`${phase} control mutations must use exact label or testId targets`);
        }
        const normalizedTarget = targetName.toLowerCase();
        const isCredentialInput = ['fill', 'fillActorEmail', 'fillActorPassword'].includes(step.action);
        const lifecycleEmailInput = step.action === 'fill' && step.value === '{LIFECYCLE_EMAIL}' ||
            step.action === 'fillActorEmail' && actor === 'lifecycle';
        if (capability.mode === 'lifecycle' && isCredentialInput && /email/.test(normalizedTarget) && !lifecycleEmailInput) {
            throw new Error(`${phase} lifecycle email inputs must bind to the protected lifecycle actor`);
        }
        if (
            capability.mode === 'lifecycle' &&
            isCredentialInput &&
            !/email/.test(normalizedTarget) &&
            /password/.test(normalizedTarget) &&
            step.action !== 'fillActorPassword'
        ) {
            throw new Error(`${phase} lifecycle password inputs must bind to the protected lifecycle actor`);
        }
        if (
            capability.mode === 'lifecycle' &&
            /(?:join|invite|access) code/.test(normalizedTarget) &&
            (step.action !== 'fill' || step.value !== '{LIFECYCLE_INVITE_CODE}')
        ) {
            throw new Error(`${phase} lifecycle invite inputs must bind to the protected lifecycle invite`);
        }
        if (
            workflowId === 'P37' &&
            /type delete to confirm/.test(normalizedTarget) &&
            (step.action !== 'fill' || step.value !== 'DELETE')
        ) {
            throw new Error(`${phase} lifecycle deletion confirmation must use the fixed disposable-fixture value`);
        }
    }
    if (capability.mode === 'readOnly' && stateChangingActions.has(step.action)) {
        if (!isNonProductionReversibleInteraction(workflowId, step)) {
            throw new Error(`${phase} action ${step.action} is not a trusted non-production interaction for ${workflowId}`);
        }
        const actor = step.actor || defaultActor;
        const targetName = String(step.target?.name || '');
        if (
            !mutationTargetCapabilities.get(workflowId)?.[actor]?.test(targetName) ||
            !['label', 'testId'].includes(step.target?.kind) ||
            step.target?.exact !== true
        ) {
            throw new Error(`${phase} transient interaction is outside the trusted ${workflowId}/${actor} capability`);
        }
    }
    if (['clickAndExpectGoogleAuth', 'clickAndExpectRoute', 'clickAndExpectDownload', 'clickAndExpectStripeCheckout'].includes(step.action)) {
        const targetCapability = readOnlyInteractionTargetCapabilities.get(workflowId)?.[step.action];
        if (!targetCapability?.test(String(step.target?.name || ''))) {
            throw new Error(`${phase} target is outside the trusted ${workflowId}/${step.action} capability`);
        }
        if (step.target?.kind !== 'role' || !['button', 'link'].includes(step.target?.role) || step.target?.exact !== true) {
            throw new Error(`${phase} read-only interactions must use exact semantic buttons or links`);
        }
    }
}

function validateStep(step, index, declaredActors, workflowId, phase = 'execution') {
    const label = `step ${index + 1}`;
    assertPlainObject(step, label);
    if (!actions.has(step.action)) throw new Error(`${label} has unsupported action`);
    assertKnownKeys(step, new Set(stepKeysByAction.get(step.action)), label);
    const actor = step.actor || declaredActors[0];
    if (!declaredActors.includes(actor)) throw new Error(`${label} uses undeclared actor ${actor}`);
    if (['login', 'logout', 'fillActorEmail', 'fillActorPassword'].includes(step.action) && actor === 'anonymous') {
        throw new Error(`${label} action ${step.action} requires an authenticated fixture actor`);
    }
    if (step.action === 'openLatestMailboxLink') {
        if (actor !== 'lifecycle') throw new Error(`${label} mailbox actions require the lifecycle actor`);
        if (!['verifyEmail', 'resetPassword', 'invite'].includes(step.option)) {
            throw new Error(`${label} has unsupported mailbox action`);
        }
    }
    if (step.action === 'openRunScopedShareLink' && (
        workflowId !== 'P28' || actor !== 'anonymous' || step.option !== 'primary'
    )) {
        throw new Error(`${label} run-scoped share handoff is restricted to P28 anonymous from primary`);
    }
    if (step.action === 'clickAndExpectGoogleAuth' && workflowId !== 'P07') {
        throw new Error(`${label} Google handoff assertions are restricted to P07`);
    }
    if (step.action === 'clickAndExpectRoute' && !['P10', 'P25'].includes(workflowId)) {
        throw new Error(`${label} route click assertions are restricted to P10 and P25`);
    }
    if (step.action === 'clickAndExpectDownload' && !['P29', 'P32'].includes(workflowId)) {
        throw new Error(`${label} download assertions are restricted to P29 and P32`);
    }
    if (step.action === 'clickAndExpectStripeCheckout' && !['P30', 'P31'].includes(workflowId)) {
        throw new Error(`${label} Stripe checkout assertions are restricted to P30 and P31`);
    }

    if (step.action === 'goto' || step.action === 'expectRoute' || step.action === 'clickAndExpectRoute') {
        assertSafeText(step.route, `${label} route`, 300);
        validateTemplates(step.route, `${label} route`);
        if (!step.route.startsWith('/') || step.route.startsWith('//')) {
            throw new Error(`${label} route must be an app-relative route`);
        }
        if (!workflowRouteAllowed(workflowId, step.route)) {
            throw new Error(`${label} route is outside the trusted ${workflowId} capability`);
        }
    }

    if (['click', 'clickAndExpectGoogleAuth', 'clickAndExpectRoute', 'clickAndExpectDownload', 'clickAndExpectStripeCheckout', 'fill', 'fillActorEmail', 'fillActorPassword', 'check', 'uncheck', 'select', 'rememberControl', 'restoreControl', 'uploadSyntheticImage', 'uploadSyntheticDocument', 'expectVisible', 'expectHidden', 'expectText', 'expectNoText'].includes(step.action)) {
        validateLocator(step.target, `${label} target`);
    }

    if (['fill', 'expectText', 'expectNoText'].includes(step.action)) {
        assertSafeText(step.value, `${label} value`, 400);
        validateTemplates(step.value, `${label} value`);
    }
    if (step.action === 'select') {
        assertSafeText(step.option, `${label} option`, 120);
        validateTemplates(step.option, `${label} option`);
    }
    if (['rememberControl', 'restoreControl'].includes(step.action)) {
        assertSafeText(step.option, `${label} option`, 80);
        if (!/^[a-z][a-z0-9-]*$/.test(step.option)) {
            throw new Error(`${label} option must be a stable lowercase state key`);
        }
    }
    if (step.mutationId !== undefined) {
        assertSafeText(step.mutationId, `${label} mutationId`, 80);
        if (!/^[a-z][a-z0-9-]*$/.test(step.mutationId)) {
            throw new Error(`${label} mutationId must be a stable lowercase mutation key`);
        }
    }
    if (step.scope !== undefined) {
        assertSafeText(step.scope, `${label} scope`, 160);
        validateTemplates(step.scope, `${label} scope`);
    }
    if (step.commitMutation !== undefined && step.commitMutation !== true) {
        throw new Error(`${label} commitMutation may only be true`);
    }
    if (step.scope !== undefined && !step.mutationId) {
        throw new Error(`${label} scope is valid only for a reversible mutation`);
    }
    if (step.commitMutation !== undefined && (!step.mutationId || phase !== 'execution')) {
        throw new Error(`${label} commitMutation is valid only for an execution mutation`);
    }
    if (isNonProductionReversibleInteraction(workflowId, step) && (step.mutationId || step.commitMutation)) {
        throw new Error(`${label} transient filter interaction cannot declare a production mutation`);
    }
    assertParentCoverageStepCapability(workflowId, step, phase, declaredActors[0]);
}

export function validateContract(contract, catalog, expectedWorkflowId = '') {
    validateCatalog(catalog);
    assertPlainObject(contract, 'contract');
    assertKnownKeys(contract, new Set([
        'schemaVersion', 'workflowId', 'title', 'actors', 'viewport',
        'mutatesProduction', 'cleanupRequired', 'lifecycleTransition', 'steps', 'cleanupSteps'
    ]), 'contract');
    if (contract.schemaVersion !== CONTRACT_SCHEMA_VERSION) {
        throw new Error(`contract schemaVersion must be ${CONTRACT_SCHEMA_VERSION}`);
    }
    const workflow = catalog.workflows.find((candidate) => candidate.id === contract.workflowId);
    if (!workflow) throw new Error('contract workflowId is not in the locked catalog');
    if (expectedWorkflowId && contract.workflowId !== expectedWorkflowId) {
        throw new Error('contract workflowId does not match the requested workflow');
    }
    if (contract.title !== workflow.title) throw new Error('contract title must match the catalog');
    const capability = workflowCapabilities.get(contract.workflowId);
    if (!capability) throw new Error('contract workflow has no trusted execution capability');
    if (!Array.isArray(contract.actors) || contract.actors.length === 0 || contract.actors.length > 3) {
        throw new Error('contract actors must contain one to three actors');
    }
    for (const actor of contract.actors) {
        if (!actorNames.has(actor) || !workflow.actors.includes(actor)) {
            throw new Error(`contract actor ${actor} is not allowed for ${workflow.id}`);
        }
    }
    const requiredCoverageActors = new Set((workflowCoverageRequirements.get(contract.workflowId) || [])
        .map(({ actor }) => actor)
        .filter(Boolean));
    for (const requiredActor of requiredCoverageActors) {
        if (!contract.actors.includes(requiredActor)) {
            throw new Error(`contract must include the trusted ${contract.workflowId} ${requiredActor} coverage actor`);
        }
    }
    if (!viewportNames.has(contract.viewport)) throw new Error('contract viewport must be mobile or desktop');
    if (
        typeof contract.mutatesProduction !== 'boolean' ||
        typeof contract.cleanupRequired !== 'boolean' ||
        typeof contract.lifecycleTransition !== 'boolean'
    ) {
        throw new Error('contract mutation flags must be boolean');
    }
    const expectedFlags = capability.mode === 'lifecycle'
        ? { mutatesProduction: true, cleanupRequired: false, lifecycleTransition: true }
        : capability.mode === 'reversible'
            ? { mutatesProduction: true, cleanupRequired: true, lifecycleTransition: false }
            : { mutatesProduction: false, cleanupRequired: false, lifecycleTransition: false };
    if (
        contract.mutatesProduction !== expectedFlags.mutatesProduction ||
        contract.cleanupRequired !== expectedFlags.cleanupRequired ||
        contract.lifecycleTransition !== expectedFlags.lifecycleTransition
    ) {
        throw new Error(`contract mutation flags do not match the trusted ${contract.workflowId} capability`);
    }
    if (capability.mode === 'lifecycle' && (
        !contract.actors.includes('lifecycle') ||
        !lifecycleTransitionWorkflowIds.has(contract.workflowId)
    )) {
        throw new Error('lifecycle transitions are restricted to the locked lifecycle fixture sequence');
    }
    if (!Array.isArray(contract.steps) || contract.steps.length === 0 || contract.steps.length > 50) {
        throw new Error('contract steps must contain one to fifty steps');
    }
    contract.steps.forEach((step, index) => validateStep(step, index, contract.actors, contract.workflowId, 'execution'));
    const cleanupSteps = contract.cleanupSteps || [];
    if (!Array.isArray(cleanupSteps) || cleanupSteps.length > 30) {
        throw new Error('contract cleanupSteps must contain no more than thirty steps');
    }
    if (contract.mutatesProduction && !contract.lifecycleTransition && cleanupSteps.length === 0) {
        throw new Error('mutating production contracts must provide cleanupSteps');
    }
    if ((!contract.mutatesProduction || contract.lifecycleTransition) && cleanupSteps.length > 0) {
        throw new Error('read-only contracts cannot provide cleanupSteps');
    }
    cleanupSteps.forEach((step, index) => validateStep(step, index, contract.actors, contract.workflowId, 'cleanup'));
    const executionMutationIds = contract.steps
        .filter((step) => reversibleMutationActions.has(step.action) &&
            !isNonProductionReversibleInteraction(contract.workflowId, step))
        .map((step) => step.mutationId || '');
    const cleanupMutationIds = cleanupSteps
        .filter((step) => reversibleMutationActions.has(step.action))
        .map((step) => step.mutationId || '');
    if (capability.mode === 'reversible') {
        if (
            executionMutationIds.length === 0 ||
            executionMutationIds.some((id) => !id) ||
            cleanupMutationIds.some((id) => !id)
        ) {
            throw new Error('reversible mutations must declare stable mutationId values');
        }
        const executionIds = new Set(executionMutationIds);
        const cleanupIds = new Set(cleanupMutationIds);
        if (
            executionIds.size !== cleanupIds.size ||
            [...executionIds].some((id) => !cleanupIds.has(id)) ||
            [...cleanupIds].some((id) => !executionIds.has(id))
        ) {
            throw new Error('every reversible production mutation must have bounded cleanup with the same mutationId');
        }
        const committedMutationOrder = contract.steps
            .filter((step) => step.commitMutation === true)
            .map((step) => step.mutationId);
        const cleanupMutationOrder = cleanupSteps
            .map((step) => step.mutationId)
            .filter((mutationId, index, values) => mutationId && values.indexOf(mutationId) === index);
        const everyMutationHasOneCommit = [...executionIds].every((mutationId) =>
            contract.steps.filter((step) => step.mutationId === mutationId && step.commitMutation === true).length === 1
        );
        if (everyMutationHasOneCommit && cleanupMutationOrder.join('\0') !== [...committedMutationOrder].reverse().join('\0')) {
            throw new Error('reversible cleanup mutation groups must unwind completed operations in reverse order');
        }
        for (const mutationId of executionIds) {
            const executionGroup = contract.steps.filter((step) => step.mutationId === mutationId);
            const cleanupGroup = cleanupSteps.filter((step) => step.mutationId === mutationId);
            const actors = new Set([...executionGroup, ...cleanupGroup].map((step) => step.actor || contract.actors[0]));
            if (actors.size !== 1) {
                throw new Error(`reversible mutation ${mutationId} must keep execution and cleanup on one actor`);
            }
            if (cleanupGroup.some((step) => !['click', 'restoreControl'].includes(step.action))) {
                throw new Error(`reversible mutation ${mutationId} cleanup must restore remembered state or invoke a bounded inverse action`);
            }
            const commitSteps = executionGroup.filter((step) => step.commitMutation === true);
            if (commitSteps.length !== 1 || !['click', 'uploadSyntheticImage', 'uploadSyntheticDocument'].includes(commitSteps[0]?.action)) {
                throw new Error(`reversible mutation ${mutationId} must declare exactly one trusted completed forward operation`);
            }
            if (cleanupGroup.some((step) => step.commitMutation !== undefined)) {
                throw new Error(`reversible mutation ${mutationId} cleanup cannot declare a completed forward operation`);
            }
            const commitStep = commitSteps[0];
            if (executionGroup.some((step) => step.action === 'click' && step.commitMutation !== true)) {
                throw new Error(`reversible mutation ${mutationId} must put every production click in its own completed operation`);
            }
            const rememberedTargets = new Set(contract.steps
                .filter((step) => step.action === 'rememberControl')
                .map((step) => `${step.actor || contract.actors[0]}:${JSON.stringify(step.target)}`));
            const persistedControlSteps = executionGroup.filter((step) =>
                controlMutationActions.has(step.action) &&
                rememberedTargets.has(`${step.actor || contract.actors[0]}:${JSON.stringify(step.target)}`)
            );
            for (const executionStep of persistedControlSteps) {
                if (!cleanupGroup.some((step) => step.action === 'restoreControl' && sameTarget(step, executionStep))) {
                    throw new Error(`reversible mutation ${mutationId} must restore the exact mutated control`);
                }
            }
            const reservedInverseIndexes = new Set();
            for (const executionStep of executionGroup.filter((step) => ['click', 'uploadSyntheticImage', 'uploadSyntheticDocument'].includes(step.action))) {
                const directInverseIndex = cleanupGroup.findIndex((cleanupStep, index) =>
                    !reservedInverseIndexes.has(index) &&
                    isTrustedClickInverse(contract.workflowId, executionStep, cleanupStep) &&
                    trustedInverseScopeMatches(contract.workflowId, executionStep, cleanupStep)
                );
                const hasDirectInverse = directInverseIndex >= 0;
                if (hasDirectInverse) reservedInverseIndexes.add(directInverseIndex);
                const isStateCommit = executionStep.action === 'click' &&
                    /^(?:save|save changes|update profile|update rsvp|submit)$/i.test(String(executionStep.target?.name || '')) &&
                    executionGroup.some((step) =>
                        persistedControlSteps.includes(step) ||
                        ['uploadSyntheticImage', 'uploadSyntheticDocument'].includes(step.action)
                    ) &&
                    cleanupGroup.some((step) => step.action === 'click' && sameTarget(step, executionStep)) &&
                    persistedControlSteps.every((step) =>
                        cleanupGroup.some((cleanupStep) => cleanupStep.action === 'restoreControl' && sameTarget(cleanupStep, step))
                    );
                if (!hasDirectInverse && !isStateCommit) {
                    throw new Error(`reversible mutation ${mutationId} must use a trusted target-specific inverse`);
                }
            }
            const controlSteps = persistedControlSteps;
            if (controlSteps.length > 0) {
                const commitIndex = contract.steps.indexOf(commitStep);
                if (
                    commitStep.action !== 'click' ||
                    !/^(?:save|save changes|update profile|update rsvp|submit)$/i.test(String(commitStep.target?.name || '')) ||
                    controlSteps.some((step) => contract.steps.indexOf(step) > commitIndex)
                ) {
                    throw new Error(`reversible mutation ${mutationId} must persist changed controls with one final trusted commit`);
                }
                const cleanupCommitIndex = cleanupGroup.findIndex((step) => step.action === 'click' && sameTarget(step, commitStep));
                const restoreIndexes = cleanupGroup
                    .map((step, index) => step.action === 'restoreControl' ? index : -1)
                    .filter((index) => index >= 0);
                if (
                    cleanupCommitIndex < 0 ||
                    restoreIndexes.length !== controlSteps.length ||
                    restoreIndexes.some((index) => index > cleanupCommitIndex)
                ) {
                    throw new Error(`reversible mutation ${mutationId} must restore every control before the cleanup commit`);
                }
            }
            const uploadSteps = executionGroup.filter((step) =>
                ['uploadSyntheticImage', 'uploadSyntheticDocument'].includes(step.action)
            );
            if (uploadSteps.length > 0 && commitStep.action === 'click' && /^(?:save|save changes|update profile|submit)$/i.test(String(commitStep.target?.name || ''))) {
                const commitIndex = contract.steps.indexOf(commitStep);
                const cleanupCommitIndex = cleanupGroup.findIndex((step) => step.action === 'click' && sameTarget(step, commitStep));
                const inverseIndexes = cleanupGroup
                    .map((step, index) => step.action === 'click' && !sameTarget(step, commitStep) ? index : -1)
                    .filter((index) => index >= 0);
                if (
                    uploadSteps.some((step) => contract.steps.indexOf(step) > commitIndex) ||
                    cleanupCommitIndex < 0 ||
                    inverseIndexes.length < uploadSteps.length ||
                    inverseIndexes.some((index) => index > cleanupCommitIndex)
                ) {
                    throw new Error(`reversible mutation ${mutationId} must remove uploaded artifacts before the cleanup commit`);
                }
            }
            const inverseClicks = cleanupGroup.filter((step) => step.action === 'click' && !sameTarget(step, commitStep));
            for (const inverseStep of inverseClicks) {
                if (!inverseStep.scope) {
                    throw new Error(`reversible mutation ${mutationId} inverse cleanup must be bound to an exact entity scope`);
                }
                const createsRunEntity = executionGroup.some((step) =>
                    step.value === '{RUN_MARKER}' ||
                    ['uploadSyntheticImage', 'uploadSyntheticDocument'].includes(step.action)
                );
                if (createsRunEntity) {
                    const trustedRunScopes = contract.workflowId === 'P36' && /remove attachment/i.test(String(inverseStep.target?.name || ''))
                        ? new Set(['{RUN_MARKER}.png', '{RUN_MARKER}.pdf'])
                        : new Set(['{RUN_MARKER}']);
                    if (!trustedRunScopes.has(inverseStep.scope)) {
                        throw new Error(`reversible mutation ${mutationId} created-entity cleanup must be scoped to the run marker`);
                    }
                } else if (!commitStep.scope || commitStep.scope !== inverseStep.scope) {
                    throw new Error(`reversible mutation ${mutationId} forward and inverse operations must share one exact entity scope`);
                }
            }
        }
    } else if ([...executionMutationIds, ...cleanupMutationIds].some(Boolean)) {
        throw new Error('mutationId is valid only for reversible production workflows');
    }
    const remembered = new Map();
    for (const step of contract.steps.filter(({ action }) => action === 'rememberControl')) {
        const key = `${step.actor || contract.actors[0]}:${step.option}`;
        if (remembered.has(key)) throw new Error('every remembered control must use a unique state key');
        remembered.set(key, JSON.stringify(step.target));
    }
    const restored = new Set();
    for (const step of cleanupSteps.filter(({ action }) => action === 'restoreControl')) {
        const key = `${step.actor || contract.actors[0]}:${step.option}`;
        if (restored.has(key) || remembered.get(key) !== JSON.stringify(step.target)) {
            throw new Error('every restored control must exactly match one remembered control');
        }
        restored.add(key);
    }
    if (remembered.size !== restored.size || [...remembered.keys()].some((key) => !restored.has(key))) {
        throw new Error('every remembered control must be restored exactly once during cleanup');
    }
    const phasedSteps = [
        ...contract.steps.map((step) => ({ ...step, phase: 'execution' })),
        ...cleanupSteps.map((step) => ({ ...step, phase: 'cleanup' }))
    ];
    const matchesCoverageRequirement = (step, requirement) => {
        const acceptedActions = requirement.actions || [requirement.action];
        if (!acceptedActions.includes(step.action)) return false;
        if ((requirement.phase || 'execution') !== step.phase) return false;
        if (requirement.actor && (step.actor || contract.actors[0]) !== requirement.actor) return false;
        if (requirement.option && step.option !== requirement.option) return false;
        const checks = [];
        if (requirement.target && step.target?.name !== undefined) checks.push(requirement.target.test(String(step.target.name)));
        if (requirement.route && step.route !== undefined) checks.push(requirement.route.test(String(step.route)));
        if (requirement.value && step.value !== undefined) checks.push(requirement.value.test(String(step.value)));
        if ((requirement.target || requirement.route || requirement.value) && checks.length === 0) return false;
        return checks.every(Boolean);
    };
    let coverageCursor = 0;
    for (const requirement of workflowCoverageRequirements.get(contract.workflowId) || []) {
        const relativeIndex = phasedSteps.slice(coverageCursor).findIndex((step) => matchesCoverageRequirement(step, requirement));
        if (relativeIndex < 0) {
            const behavior = requirement.action || requirement.actions.join('|');
            throw new Error(`contract must exercise ordered trusted ${contract.workflowId} ${requirement.actor || ''} ${behavior} workflow behavior`);
        }
        coverageCursor += relativeIndex + 1;
    }
    const executionActions = new Set(contract.steps.map(({ action }) => action));
    if (!['expectVisible', 'expectHidden', 'expectText', 'expectNoText', 'expectRoute'].some((action) => executionActions.has(action))) {
        throw new Error(`contract must assert an observable trusted ${contract.workflowId} workflow outcome`);
    }
    return contract;
}

export function interpolateTemplate(value, variables) {
    return String(value).replace(/\{([A-Z0-9_]+)\}/g, (_match, name) => {
        if (!allowedTemplateNames.has(name)) throw new Error(`unsupported template ${name}`);
        const resolved = String(variables[name] || '');
        if (!resolved) throw new Error(`required template ${name} is unavailable`);
        return encodeURIComponent(resolved);
    });
}

export function interpolateTextTemplate(value, variables) {
    return String(value).replace(/\{([A-Z0-9_]+)\}/g, (_match, name) => {
        if (!allowedTemplateNames.has(name)) throw new Error(`unsupported template ${name}`);
        const resolved = String(variables[name] || '');
        if (!resolved) throw new Error(`required template ${name} is unavailable`);
        return resolved;
    });
}

export function buildSanitizedParentCoverageFailureError(report) {
    const workflowId = /^P\d{2}$/.test(String(report?.workflowId || ''))
        ? String(report.workflowId)
        : 'unknown';
    const signature = /^[a-f0-9]{64}$/.test(String(report?.signature || ''))
        ? String(report.signature)
        : 'unavailable';
    return new Error(`Parent coverage ${workflowId} failed; inspect sanitized report signature ${signature}.`);
}

export function buildParentCoverageOutcome({
    workflowId,
    setupSummary = '',
    productSummary = '',
    productAction = '',
    cleanupFailures = [],
    cleanupRequired = false
}) {
    const setupFailed = Boolean(setupSummary);
    const productFailed = Boolean(productSummary);
    const cleanupFailed = cleanupFailures.length > 0;
    const status = setupFailed || productFailed || cleanupFailed ? 'failed' : 'passed';
    const failureClass = setupFailed
        ? 'fixture-setup'
        : productFailed
            ? 'product-assertion'
            : cleanupFailed ? 'cleanup-failure' : 'none';
    const phase = setupFailed ? 'setup' : productFailed ? 'execution' : cleanupFailed ? 'cleanup' : 'complete';
    const failureAction = setupFailed
        ? 'setup'
        : productFailed
            ? productAction || 'unknown-action'
            : cleanupFailed
                ? cleanupFailures.map(({ action }) => action).join('+').slice(0, 180)
                : 'complete';
    const summaries = [];
    if (setupFailed) summaries.push(`Setup: ${setupSummary}`);
    if (productFailed) summaries.push(`Product: ${productSummary}`);
    if (cleanupFailed) {
        summaries.push(`Cleanup: ${cleanupFailures.map(({ action, summary }) => `${action}: ${summary}`).join('; ')}`);
    }
    return {
        status,
        phase,
        failureClass,
        sourceArea: `contract/${workflowId}/${failureAction}`,
        summary: status === 'passed' ? 'Contract completed successfully.' : summaries.join(' | ').slice(0, 1200),
        cleanup: setupFailed ? 'not-started' : cleanupRequired ? (cleanupFailed ? 'failed' : 'completed') : 'not-required'
    };
}

export function stableFailureSignature({ workflowId, failureClass, sourceArea }) {
    const normalized = [workflowId, failureClass, sourceArea]
        .map((value) => String(value || '').trim().toLowerCase().replace(/[^a-z0-9._/-]+/g, '-'))
        .join('|');
    return createHash('sha256').update(normalized).digest('hex');
}

export function redactParentCoverageValue(value, secrets = []) {
    let redacted = String(value || '');
    for (const secret of secrets.filter(Boolean)) redacted = redacted.replaceAll(String(secret), '[REDACTED]');
    redacted = redacted
        .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[REDACTED_EMAIL]')
        .replace(/([?&#](?:oobCode|code|token|apiKey|invite|share)\s*=\s*)[^&#\s]+/gi, '$1[REDACTED]')
        .replace(/\b(?:Bearer\s+)?[A-Za-z0-9_-]{28,}\b/g, '[REDACTED_TOKEN]');
    return redacted.slice(0, 1200);
}

export async function readValidatedCatalog(path) {
    return validateCatalog(JSON.parse(await readFile(path, 'utf8')));
}

export async function readValidatedContract(path, catalog, expectedWorkflowId = '') {
    return validateContract(JSON.parse(await readFile(path, 'utf8')), catalog, expectedWorkflowId);
}
