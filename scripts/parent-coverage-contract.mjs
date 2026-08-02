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
    'uploadSyntheticImage',
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
    P07: { mode: 'readOnly', routes: ['/auth'], actions: [] },
    P08: { mode: 'lifecycle', routes: ['/accept-invite', '/parent-tools/access'], actions: ['fill', 'click'] },
    P09: { mode: 'reversible', routes: ['/parent-tools/access'], actions: ['fill', 'select', 'click'] },
    P10: { mode: 'readOnly', routes: ['/home', '/parent-tools/*'], actions: [] },
    P11: { mode: 'readOnly', routes: ['/teams/{TEAM_ID}', '/players/{TEAM_ID}/{PLAYER_ID}'], actions: [] },
    P12: { mode: 'reversible', routes: ['/profile/settings'], actions: ['rememberControl', 'fill', 'click', 'restoreControl'] },
    P13: { mode: 'reversible', routes: ['/profile/settings'], actions: ['click', 'uploadSyntheticImage'] },
    P14: { mode: 'reversible', routes: ['/players/{TEAM_ID}/{PLAYER_ID}'], actions: ['rememberControl', 'fill', 'click', 'restoreControl', 'uploadSyntheticImage'] },
    P15: { mode: 'readOnly', routes: ['/players/{TEAM_ID}/{PLAYER_ID}'], actions: [] },
    P16: { mode: 'reversible', routes: ['/schedule', '/schedule/{TEAM_ID}/{EVENT_ID}'], actions: ['rememberControl', 'select', 'click', 'restoreControl'] },
    P17: { mode: 'reversible', routes: ['/schedule/{TEAM_ID}/{EVENT_ID}'], actions: ['rememberControl', 'fill', 'click', 'restoreControl'] },
    P18: { mode: 'readOnly', routes: ['/schedule/{TEAM_ID}/{EVENT_ID}'], actions: [] },
    P19: { mode: 'reversible', routes: ['/schedule/{TEAM_ID}/{EVENT_ID}'], actions: ['rememberControl', 'check', 'uncheck', 'click', 'restoreControl'] },
    P20: { mode: 'reversible', routes: ['/schedule/{TEAM_ID}/{EVENT_ID}'], actions: ['fill', 'click'] },
    P21: { mode: 'reversible', routes: ['/schedule/{TEAM_ID}/{EVENT_ID}'], actions: ['fill', 'select', 'click'] },
    P22: { mode: 'reversible', routes: ['/schedule/{TEAM_ID}/{EVENT_ID}'], actions: ['fill', 'click'] },
    P23: { mode: 'reversible', routes: ['/messages', '/messages/{TEAM_ID}'], actions: ['fill', 'check', 'uncheck', 'click'] },
    P24: { mode: 'reversible', routes: ['/messages/{TEAM_ID}'], actions: ['fill', 'click', 'uploadSyntheticImage'] },
    P25: { mode: 'reversible', routes: ['/home', '/profile/settings'], actions: ['rememberControl', 'check', 'uncheck', 'click', 'restoreControl'] },
    P26: { mode: 'reversible', routes: ['/home', '/people/*', '/messages/*'], actions: ['fill', 'click'] },
    P27: { mode: 'lifecycle', routes: ['/parent-tools/household', '/accept-invite'], actions: ['fill', 'click', 'openLatestMailboxLink'] },
    P28: { mode: 'reversible', routes: ['/parent-tools/share', '/family/*'], actions: ['fill', 'click'] },
    P29: { mode: 'readOnly', routes: ['/parent-tools/calendar'], actions: ['clickAndExpectDownload'] },
    P30: { mode: 'readOnly', routes: ['/parent-tools/fees'], actions: ['clickAndExpectStripeCheckout'] },
    P31: { mode: 'readOnly', routes: ['/parent-tools/registrations', '/parent-tools/registrations/{TEAM_ID}/{REGISTRATION_FORM_ID}'], actions: ['clickAndExpectStripeCheckout'] },
    P32: { mode: 'readOnly', routes: ['/parent-tools/certificates', '/teams/{TEAM_ID}/certificates'], actions: ['clickAndExpectDownload'] },
    P33: { mode: 'reversible', routes: ['/teams/{TEAM_ID}/media'], actions: ['fill', 'click', 'uploadSyntheticImage'] },
    P34: { mode: 'reversible', routes: ['/home', '/people/*'], actions: ['fill', 'click', 'uploadSyntheticImage'] },
    P35: { mode: 'reversible', routes: ['/ai'], actions: ['fill', 'click'] },
    P36: { mode: 'reversible', routes: ['/ai'], actions: ['fill', 'click', 'uploadSyntheticImage'] },
    P37: { mode: 'lifecycle', routes: ['/profile/settings'], actions: ['fill', 'fillActorPassword', 'click'] }
}));
const stateChangingActions = new Set([
    'click', 'fill', 'fillActorEmail', 'fillActorPassword', 'check', 'uncheck',
    'select', 'restoreControl', 'uploadSyntheticImage'
]);
const reversibleMutationActions = new Set([
    'click', 'fill', 'check', 'uncheck', 'select', 'restoreControl', 'uploadSyntheticImage'
]);
const forbiddenMutationTarget = /(?:delete|deactivate|remove)\s+(?:my\s+)?(?:account|profile)|(?:grant|make|promote).*(?:admin|coach|manager|staff)|(?:admin|coach|manager|staff).*(?:access|permission|role)/i;
const mutationTargetCapabilities = new Map(Object.entries({
    P02: { lifecycle: /^(?:email|password|confirm password|join code|create account|sign up|continue)$/i },
    P03: { lifecycle: /^(?:resend verification email|verify email|i've verified, continue|need another option\?|continue to dashboard|continue without verifying|sign out)$/i },
    P04: { lifecycle: /^(?:email|password|sign in|log in|continue|get started)$/i },
    P05: { lifecycle: /^(?:email|password|password reset email|forgot password\?|new password|confirm password|send reset email|reset password|continue to login)$/i },
    P08: { lifecycle: /^(?:join code|invite code|access code|redeem|join|apply code|continue with code|sign in to accept|create account with code|accept invite|continue)$/i },
    P09: { primary: /^(?:player search|search|team|player|relationship|request access|send request)$/i },
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
        primary: /^(?:message|chat|mute|unmute|send|mark read)$/i,
        peer: /^(?:message|chat|mute|unmute|send|mark read)$/i
    },
    P24: {
        primary: /^(?:message|chat|attachment|image|photo|upload|send|remove attachment)$/i,
        peer: /^(?:message|chat|attachment|image|photo|upload|send|remove attachment)$/i
    },
    P25: {
        primary: /^(?:notification|notifications|preference|preferences|mute|email|push|sms|save|mark read)$/i,
        peer: /^(?:notification|notifications|preference|preferences|mute|email|push|sms|save|mark read)$/i
    },
    P26: {
        primary: /^(?:friend|search|add friend|accept|remove friend|message|chat|send)$/i,
        peer: /^(?:friend|search|add friend|accept|remove friend|message|chat|send)$/i
    },
    P27: {
        primary: /^(?:household|invite|email|relation|send invite|revoke (?:invite|access) for \{LIFECYCLE_EMAIL\})$/i,
        lifecycle: /^(?:invite code|accept invite|continue)$/i
    },
    P28: { primary: /^(?:share|family|privacy|email|create share|revoke share)$/i },
    P33: { primary: /^(?:media|photo|image|upload|title|caption|share|remove media|delete media)$/i },
    P34: {
        primary: /^(?:social|post|image|photo|upload|reaction|like|comment|moderate|hide post|delete post|delete comment|remove image|send|publish)$/i,
        peer: /^(?:social|post|image|photo|upload|reaction|like|comment|moderate|hide post|delete post|delete comment|remove image|send|publish)$/i
    },
    P35: { primary: /^(?:ai|chat|prompt|send|clear chat|new conversation)$/i },
    P36: { primary: /^(?:ai|chat|prompt|attachment|image|document|upload|send|remove attachment|clear chat|new conversation)$/i },
    P37: { lifecycle: /^(?:password|type delete to confirm|account password \(email sign-in only\)|cancel account deletion|delete account|confirm deletion|confirm|cancel)$/i }
}));
const readOnlyInteractionTargetCapabilities = new Map(Object.entries({
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
    ['click', ['action', 'actor', 'target', 'mutationId']],
    ['clickAndExpectDownload', ['action', 'actor', 'target']],
    ['clickAndExpectStripeCheckout', ['action', 'actor', 'target']],
    ['fill', ['action', 'actor', 'target', 'value', 'mutationId']],
    ['fillActorEmail', ['action', 'actor', 'target']],
    ['fillActorPassword', ['action', 'actor', 'target']],
    ['check', ['action', 'actor', 'target', 'mutationId']],
    ['uncheck', ['action', 'actor', 'target', 'mutationId']],
    ['select', ['action', 'actor', 'target', 'option', 'mutationId']],
    ['rememberControl', ['action', 'actor', 'target', 'option']],
    ['restoreControl', ['action', 'actor', 'target', 'option', 'mutationId']],
    ['openLatestMailboxLink', ['action', 'actor', 'option']],
    ['uploadSyntheticImage', ['action', 'actor', 'target', 'mutationId']],
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
        ['fillActorEmail', 'fillActorPassword', 'openLatestMailboxLink', 'uploadSyntheticImage', 'clickAndExpectStripeCheckout'].includes(step.action)
    ) {
        throw new Error(`${phase} action ${step.action} is not allowed for workflow ${workflowId}`);
    }
    if (['goto', 'expectRoute'].includes(step.action) && !workflowRouteAllowed(workflowId, step.route)) {
        throw new Error(`${phase} route is outside the trusted ${workflowId} capability`);
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
        if (['fill', 'fillActorEmail', 'fillActorPassword', 'check', 'uncheck', 'select', 'uploadSyntheticImage'].includes(step.action) && (
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
    if (capability.mode === 'readOnly' && ['clickAndExpectDownload', 'clickAndExpectStripeCheckout'].includes(step.action)) {
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
    if (step.action === 'clickAndExpectDownload' && !['P29', 'P32'].includes(workflowId)) {
        throw new Error(`${label} download assertions are restricted to P29 and P32`);
    }
    if (step.action === 'clickAndExpectStripeCheckout' && !['P30', 'P31'].includes(workflowId)) {
        throw new Error(`${label} Stripe checkout assertions are restricted to P30 and P31`);
    }

    if (step.action === 'goto' || step.action === 'expectRoute') {
        assertSafeText(step.route, `${label} route`, 300);
        validateTemplates(step.route, `${label} route`);
        if (!step.route.startsWith('/') || step.route.startsWith('//')) {
            throw new Error(`${label} route must be an app-relative route`);
        }
        if (!workflowRouteAllowed(workflowId, step.route)) {
            throw new Error(`${label} route is outside the trusted ${workflowId} capability`);
        }
    }

    if (['click', 'clickAndExpectDownload', 'clickAndExpectStripeCheckout', 'fill', 'fillActorEmail', 'fillActorPassword', 'check', 'uncheck', 'select', 'rememberControl', 'restoreControl', 'uploadSyntheticImage', 'expectVisible', 'expectHidden', 'expectText', 'expectNoText'].includes(step.action)) {
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
        .filter((step) => reversibleMutationActions.has(step.action))
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
            if (executionGroup.some((step) => ['fill', 'check', 'uncheck', 'select'].includes(step.action))) {
                const hasRestore = cleanupGroup.some((step) => step.action === 'restoreControl');
                const hasBoundedInverse = cleanupGroup.some((step) => step.action === 'click');
                if (!hasRestore && !hasBoundedInverse) {
                    throw new Error(`reversible mutation ${mutationId} has no state restoration or bounded inverse action`);
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
