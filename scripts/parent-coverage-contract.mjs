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
const readOnlyWorkflowIds = new Set(['P01', 'P06', 'P07', 'P10', 'P11', 'P15', 'P16', 'P18', 'P29', 'P30', 'P31', 'P32']);
const observationActions = new Set([
    'login', 'goto', 'reload', 'expectVisible', 'expectHidden', 'expectText',
    'expectNoText', 'expectRoute', 'logout'
]);
const reversibleMutationActions = new Set([
    ...observationActions, 'click', 'fill', 'check', 'uncheck', 'select',
    'rememberControl', 'uploadSyntheticImage'
]);
const lifecycleActions = new Set([
    ...reversibleMutationActions, 'fillActorEmail', 'fillActorPassword',
    'openLatestMailboxLink'
]);
const cleanupActions = new Set([
    ...observationActions, 'restoreControl'
]);
const routeScopesByWorkflow = new Map(Object.entries({
    P01: ['/auth', '/accept-invite'], P02: ['/auth', '/accept-invite'],
    P03: ['/verify-pending'], P04: ['/auth', '/home'],
    P05: ['/auth', '/reset-password'], P06: ['/auth', '/home'], P07: ['/auth'],
    P08: ['/accept-invite'], P09: ['/teams/browse', '/players'], P10: ['/home'],
    P11: ['/teams', '/players'], P12: ['/profile'], P13: ['/profile'],
    P14: ['/players'], P15: ['/players'], P16: ['/schedule'], P17: ['/schedule'],
    P18: ['/schedule'], P19: ['/schedule'], P20: ['/parent-tools'],
    P21: ['/parent-tools'], P22: ['/parent-tools'], P23: ['/messages'],
    P24: ['/messages'], P25: ['/notifications', '/profile/settings'],
    P26: ['/home', '/messages'], P27: ['/household'], P28: ['/family'],
    P29: ['/calendar', '/parent-tools'], P30: ['/fees', '/parent-tools'],
    P31: ['/registration', '/parent-tools'], P32: ['/awards', '/certificates'],
    P33: ['/media', '/teams'], P34: ['/home'], P35: ['/private-ai'],
    P36: ['/private-ai'], P37: ['/profile/settings']
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

function workflowCapability(workflowId) {
    if (lifecycleTransitionWorkflowIds.has(workflowId)) {
        return { mutationMode: 'lifecycle', steps: lifecycleActions, cleanup: new Set() };
    }
    if (readOnlyWorkflowIds.has(workflowId)) {
        const steps = new Set(observationActions);
        if (['P30', 'P31'].includes(workflowId)) steps.add('clickAndExpectStripeCheckout');
        return { mutationMode: 'read-only', steps, cleanup: new Set() };
    }
    return { mutationMode: 'reversible', steps: reversibleMutationActions, cleanup: cleanupActions };
}

function routeWithinWorkflowScope(route, workflowId) {
    const pathname = String(route).split('?', 1)[0];
    return (routeScopesByWorkflow.get(workflowId) || []).some(
        (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
    );
}

export function assertParentCoverageStepCapability(workflowId, step, phase = 'steps') {
    const capability = workflowCapability(workflowId);
    const allowedActions = phase === 'cleanup' ? capability.cleanup : capability.steps;
    if (!allowedActions.has(step.action)) {
        throw new Error(`${phase} action ${step.action} is not allowed for workflow ${workflowId}`);
    }
    if (['goto', 'expectRoute'].includes(step.action) && !routeWithinWorkflowScope(step.route, workflowId)) {
        throw new Error(`${phase} route is outside the trusted scope for workflow ${workflowId}`);
    }
}

function validateStep(step, index, declaredActors, workflowId, phase = 'steps') {
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
    if (step.action === 'clickAndExpectStripeCheckout' && !['P30', 'P31'].includes(workflowId)) {
        throw new Error(`${label} Stripe checkout assertions are restricted to P30 and P31`);
    }

    if (step.action === 'goto' || step.action === 'expectRoute') {
        assertSafeText(step.route, `${label} route`, 300);
        validateTemplates(step.route, `${label} route`);
        if (!step.route.startsWith('/') || step.route.startsWith('//')) {
            throw new Error(`${label} route must be an app-relative route`);
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
    assertParentCoverageStepCapability(workflowId, step, phase);
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
    if (!contract.lifecycleTransition && contract.mutatesProduction !== contract.cleanupRequired) {
        throw new Error('production mutations require cleanup and read-only contracts cannot declare cleanup');
    }
    if (contract.lifecycleTransition && (
        !contract.mutatesProduction ||
        contract.cleanupRequired ||
        !contract.actors.includes('lifecycle') ||
        !lifecycleTransitionWorkflowIds.has(contract.workflowId)
    )) {
        throw new Error('lifecycle transitions are restricted to the locked lifecycle fixture sequence');
    }
    const capability = workflowCapability(contract.workflowId);
    const declaredMode = contract.lifecycleTransition
        ? 'lifecycle'
        : contract.mutatesProduction ? 'reversible' : 'read-only';
    if (declaredMode !== capability.mutationMode) {
        throw new Error(`contract mutation flags do not match the trusted ${contract.workflowId} capability`);
    }
    if (!Array.isArray(contract.steps) || contract.steps.length === 0 || contract.steps.length > 50) {
        throw new Error('contract steps must contain one to fifty steps');
    }
    contract.steps.forEach((step, index) => validateStep(step, index, contract.actors, contract.workflowId, 'steps'));
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
    if (capability.mutationMode === 'reversible') {
        const remembered = new Map();
        for (const step of contract.steps.filter(({ action }) => action === 'rememberControl')) {
            remembered.set(`${step.actor || contract.actors[0]}:${step.option}`, JSON.stringify(step.target));
        }
        const restored = new Set();
        for (const step of cleanupSteps.filter(({ action }) => action === 'restoreControl')) {
            const key = `${step.actor || contract.actors[0]}:${step.option}`;
            if (remembered.get(key) !== JSON.stringify(step.target)) {
                throw new Error(`cleanup restoreControl ${step.option} must match a remembered control`);
            }
            restored.add(key);
        }
        if (remembered.size === 0 || [...remembered.keys()].some((key) => !restored.has(key))) {
            throw new Error('reversible workflows must restore every remembered control during cleanup');
        }
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

export function createSanitizedParentCoverageError(value, secrets = []) {
    return new Error(redactParentCoverageValue(value?.message || value, secrets));
}

export async function readValidatedCatalog(path) {
    return validateCatalog(JSON.parse(await readFile(path, 'utf8')));
}

export async function readValidatedContract(path, catalog, expectedWorkflowId = '') {
    return validateContract(JSON.parse(await readFile(path, 'utf8')), catalog, expectedWorkflowId);
}
