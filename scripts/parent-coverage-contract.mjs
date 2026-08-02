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
    P03: { mode: 'lifecycle', routes: ['/verify-pending', '/auth'], actions: ['click', 'openLatestMailboxLink'] },
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
    P29: { mode: 'readOnly', routes: ['/parent-tools/calendar'], actions: ['click'] },
    P30: { mode: 'readOnly', routes: ['/parent-tools/fees'], actions: ['clickAndExpectStripeCheckout'] },
    P31: { mode: 'readOnly', routes: ['/parent-tools/registrations', '/parent-tools/registrations/{TEAM_ID}/{REGISTRATION_FORM_ID}'], actions: ['clickAndExpectStripeCheckout'] },
    P32: { mode: 'readOnly', routes: ['/parent-tools/certificates', '/teams/{TEAM_ID}/certificates'], actions: ['click'] },
    P33: { mode: 'reversible', routes: ['/teams/{TEAM_ID}/media'], actions: ['fill', 'click', 'uploadSyntheticImage'] },
    P34: { mode: 'reversible', routes: ['/home', '/people/*'], actions: ['fill', 'click', 'uploadSyntheticImage'] },
    P35: { mode: 'reversible', routes: ['/ai'], actions: ['fill', 'click'] },
    P36: { mode: 'reversible', routes: ['/ai'], actions: ['fill', 'click', 'uploadSyntheticImage'] },
    P37: { mode: 'lifecycle', routes: ['/profile/settings'], actions: ['fill', 'fillActorPassword', 'click'] }
}));
const forbiddenText = /(?:https?:\/\/|javascript:|data:text|[\r\n]|\$\{|<script|authorization|cookie)/i;
const stepKeysByAction = new Map([
    ['login', ['action', 'actor']],
    ['goto', ['action', 'actor', 'route']],
    ['reload', ['action', 'actor']],
    ['click', ['action', 'actor', 'target']],
    ['clickAndExpectStripeCheckout', ['action', 'actor', 'target']],
    ['fill', ['action', 'actor', 'target', 'value']],
    ['fillActorEmail', ['action', 'actor', 'target']],
    ['fillActorPassword', ['action', 'actor', 'target']],
    ['check', ['action', 'actor', 'target']],
    ['uncheck', ['action', 'actor', 'target']],
    ['select', ['action', 'actor', 'target', 'option']],
    ['rememberControl', ['action', 'actor', 'target', 'option']],
    ['restoreControl', ['action', 'actor', 'target', 'option']],
    ['openLatestMailboxLink', ['action', 'actor', 'option']],
    ['uploadSyntheticImage', ['action', 'actor', 'target']],
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

function validateStep(step, index, declaredActors, workflowId, phase = 'execution') {
    const label = `step ${index + 1}`;
    assertPlainObject(step, label);
    if (!actions.has(step.action)) throw new Error(`${label} has unsupported action`);
    const capability = workflowCapabilities.get(workflowId);
    if (!capability) throw new Error(`${label} has no trusted workflow capability`);
    const allowedActions = new Set([...baseWorkflowActions, ...capability.actions]);
    if (!allowedActions.has(step.action)) {
        throw new Error(`${label} action ${step.action} is not allowed for ${workflowId}`);
    }
    if (
        phase === 'cleanup' &&
        ['fillActorEmail', 'fillActorPassword', 'openLatestMailboxLink', 'uploadSyntheticImage', 'clickAndExpectStripeCheckout'].includes(step.action)
    ) {
        throw new Error(`${label} action ${step.action} is not allowed during cleanup`);
    }
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

    if (['click', 'clickAndExpectStripeCheckout', 'fill', 'fillActorEmail', 'fillActorPassword', 'check', 'uncheck', 'select', 'rememberControl', 'restoreControl', 'uploadSyntheticImage', 'expectVisible', 'expectHidden', 'expectText', 'expectNoText'].includes(step.action)) {
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
    const rememberedKeys = contract.steps
        .filter((step) => step.action === 'rememberControl')
        .map((step) => `${step.actor || contract.actors[0]}:${step.option}`);
    const restoredKeys = cleanupSteps
        .filter((step) => step.action === 'restoreControl')
        .map((step) => `${step.actor || contract.actors[0]}:${step.option}`);
    if (
        new Set(rememberedKeys).size !== rememberedKeys.length ||
        new Set(restoredKeys).size !== restoredKeys.length ||
        rememberedKeys.length !== restoredKeys.length ||
        rememberedKeys.some((key) => !restoredKeys.includes(key))
    ) {
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
