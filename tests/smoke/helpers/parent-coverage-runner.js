import { expect } from '@playwright/test';
import {
    assertParentCoverageStepCapability,
    interpolateTemplate,
    interpolateTextTemplate,
    redactParentCoverageValue,
    workflowRouteAllowed
} from '../../../scripts/parent-coverage-contract.mjs';
import {
    findLatestParentMailboxActionLink,
    validateParentMailboxActionUrl
} from '../../../scripts/parent-coverage-mailbox.mjs';
import {
    buildAppSmokeUrl,
    collectAppRuntimeIssues,
    signInToApp
} from './app-auth.js';
import {
    createFirebaseRestSession,
    findFirestoreDocumentsByStringField,
    getFirestoreStringField
} from './firebase-rest.js';

const actorEnvironment = {
    primary: ['PARENT_CENSUS_PRIMARY_EMAIL', 'PARENT_CENSUS_PRIMARY_PASSWORD'],
    peer: ['PARENT_CENSUS_PEER_EMAIL', 'PARENT_CENSUS_PEER_PASSWORD'],
    lifecycle: ['PARENT_CENSUS_LIFECYCLE_EMAIL', 'PARENT_CENSUS_LIFECYCLE_PASSWORD']
};

export function getParentCoverageVariables() {
    return {
        TEAM_ID: process.env.PARENT_CENSUS_TEAM_ID || '',
        PLAYER_ID: process.env.PARENT_CENSUS_PLAYER_ID || '',
        GAME_ID: process.env.PARENT_CENSUS_GAME_ID || '',
        EVENT_ID: process.env.PARENT_CENSUS_EVENT_ID || '',
        REGISTRATION_FORM_ID: process.env.PARENT_CENSUS_REGISTRATION_FORM_ID || '',
        CONVERSATION_ID: process.env.PARENT_CENSUS_CONVERSATION_ID || '',
        RUN_MARKER: process.env.PARENT_CENSUS_RUN_MARKER || '',
        LIFECYCLE_EMAIL: process.env.PARENT_CENSUS_LIFECYCLE_EMAIL || '',
        LIFECYCLE_INVITE_CODE: process.env.PARENT_CENSUS_LIFECYCLE_INVITE_CODE || ''
    };
}

export function getParentCoverageSecrets() {
    return [
        process.env.PARENT_CENSUS_PRIMARY_EMAIL,
        process.env.PARENT_CENSUS_PRIMARY_PASSWORD,
        process.env.PARENT_CENSUS_PEER_EMAIL,
        process.env.PARENT_CENSUS_PEER_PASSWORD,
        process.env.PARENT_CENSUS_LIFECYCLE_EMAIL,
        process.env.PARENT_CENSUS_LIFECYCLE_PASSWORD,
        process.env.PARENT_CENSUS_LIFECYCLE_INVITE_CODE,
        process.env.PARENT_CENSUS_MAILBOX_CLIENT_ID,
        process.env.PARENT_CENSUS_MAILBOX_CLIENT_SECRET,
        process.env.PARENT_CENSUS_MAILBOX_REFRESH_TOKEN
    ].filter(Boolean);
}

function actorCredentials(actor) {
    const names = actorEnvironment[actor];
    if (!names) throw new Error(`actor ${actor} cannot sign in`);
    const email = String(process.env[names[0]] || '');
    const password = String(process.env[names[1]] || '');
    if (!email || !password) throw new Error(`protected ${actor} credentials are unavailable`);
    return { email, password };
}

function baseLocator(root, descriptor, variables) {
    const name = interpolateTextTemplate(descriptor.name, variables);
    const options = descriptor.exact === undefined ? undefined : { exact: descriptor.exact };
    switch (descriptor.kind) {
    case 'role':
        return root.getByRole(descriptor.role, { name, ...(options || {}) });
    case 'label':
        return root.getByLabel(name, options);
    case 'text':
        return root.getByText(name, options);
    case 'testId':
        return root.getByTestId(name);
    default:
        throw new Error(`unsupported locator kind ${descriptor.kind}`);
    }
}

async function locatorFor(page, descriptor, variables, scope = '') {
    if (!scope) return baseLocator(page, descriptor, variables);
    const scopeText = interpolateTextTemplate(scope, variables);
    const anchors = page.getByText(scopeText, { exact: true });
    await expect(anchors).toHaveCount(1, { timeout: 20_000 });
    const anchor = anchors;
    await expect(anchor).toBeVisible({ timeout: 20_000 });
    const container = anchor.locator(
        'xpath=ancestor-or-self::*[self::article or self::li or self::tr or @role="row" or @role="listitem" or @data-testid][1]'
    );
    if (await container.count() !== 1) {
        throw new Error('run-scoped mutation container is unavailable');
    }
    return baseLocator(container, descriptor, variables);
}

async function assertAllowedPage(page, appBaseUrl, workflowId = '') {
    const current = new URL(page.url());
    const allowed = new URL(appBaseUrl);
    if (current.origin !== allowed.origin || !current.pathname.startsWith(allowed.pathname)) {
        throw new Error('contract attempted to leave the protected AllPlays app origin');
    }
    if (workflowId) {
        const route = current.hash.startsWith('#') ? current.hash.slice(1) : '/';
        if (!workflowRouteAllowed(workflowId, route || '/', true)) {
            throw new Error(`contract navigation left the trusted ${workflowId} route capability`);
        }
    }
}

async function assertClickNavigationAllowed(target, page, appBaseUrl, workflowId) {
    const href = await target.getAttribute('href');
    if (!href) return;
    const destination = new URL(href, page.url());
    const allowed = new URL(appBaseUrl);
    if (destination.origin !== allowed.origin || !destination.pathname.startsWith(allowed.pathname)) {
        throw new Error('contract click target leaves the protected AllPlays app origin');
    }
    const route = destination.hash.startsWith('#') ? destination.hash.slice(1) : '/';
    if (!workflowRouteAllowed(workflowId, route || '/', true)) {
        throw new Error(`contract click target leaves the trusted ${workflowId} route capability`);
    }
}

async function makeSyntheticImage(runMarker) {
    return {
        name: `${runMarker}.png`,
        mimeType: 'image/png',
        buffer: Buffer.from(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nMcAAAAASUVORK5CYII=',
            'base64'
        )
    };
}

async function makeSyntheticDocument(runMarker) {
    return {
        name: `${runMarker}.pdf`,
        mimeType: 'application/pdf',
        buffer: Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n')
    };
}

export async function executeParentCoverageCleanup(runtime, cleanupSteps) {
    const failures = [];
    for (const step of cleanupSteps) {
        if (step.mutationId && !runtime.shouldExecuteCleanup(step)) continue;
        try {
            await runtime.executeStep(step, 'cleanup');
        } catch (error) {
            failures.push({ action: step.action, error });
        }
    }
    return failures;
}

export function createParentCoverageMutationTracker() {
    const completedMutationIds = new Set();
    return {
        record(step, phase = 'execution') {
            if (phase === 'execution' && step.mutationId && step.commitMutation === true) {
                completedMutationIds.add(step.mutationId);
            }
        },
        shouldExecute(step) {
            return !step.mutationId || completedMutationIds.has(step.mutationId);
        }
    };
}

export async function createParentCoverageRuntime(browser, contract, appBaseUrl) {
    const actors = new Map();
    const rememberedControls = new Map();
    const mutationTracker = createParentCoverageMutationTracker();
    const mailboxAfterEpoch = Math.floor(Date.now() / 1000) - 60;
    const variables = getParentCoverageVariables();
    const secrets = getParentCoverageSecrets();
    if (JSON.stringify(contract).includes('{LIFECYCLE_INVITE_CODE}')) {
        const primary = actorCredentials('primary');
        const session = await createFirebaseRestSession({ appBaseUrl, ...primary });
        const documents = await findFirestoreDocumentsByStringField(
            session,
            'accessCodes',
            'generatedBy',
            session.localId
        );
        const recipient = actorCredentials('lifecycle').email.toLowerCase();
        const invite = documents.find((document) => {
            const fields = document?.fields || {};
            return getFirestoreStringField(document, 'type') === 'friend_invite' &&
                getFirestoreStringField(document, 'email').toLowerCase() === recipient &&
                fields.used?.booleanValue !== true &&
                Date.parse(String(fields.expiresAt?.timestampValue || '')) > Date.now();
        });
        variables.LIFECYCLE_INVITE_CODE = getFirestoreStringField(invite, 'code');
        if (!variables.LIFECYCLE_INVITE_CODE) throw new Error('protected lifecycle invite is unavailable');
    }

    async function actorRuntime(actor) {
        if (actors.has(actor)) return actors.get(actor);
        const viewport = contract.viewport === 'mobile'
            ? { width: 390, height: 844 }
            : { width: 1280, height: 720 };
        const context = await browser.newContext({ serviceWorkers: 'block', viewport });
        const page = await context.newPage();
        const runtime = { context, page, issues: collectAppRuntimeIssues(page, secrets), signedIn: false };
        actors.set(actor, runtime);
        return runtime;
    }

    async function executeStep(step, phase = 'execution') {
        assertParentCoverageStepCapability(contract.workflowId, step, phase, contract.actors[0]);
        const actor = step.actor || contract.actors[0];
        const runtime = await actorRuntime(actor);
        const { page } = runtime;
        const markMutationCompleted = () => {
            mutationTracker.record(step, phase);
        };
        if (step.action === 'login') {
            const credentials = actorCredentials(actor);
            await signInToApp(page, { appBaseUrl, ...credentials, roleLabel: `parent-census-${actor}` });
            runtime.signedIn = true;
            await assertAllowedPage(page, appBaseUrl);
            return;
        }
        if (step.action === 'goto') {
            await page.goto(buildAppSmokeUrl(appBaseUrl, interpolateTemplate(step.route, variables)), {
                waitUntil: 'domcontentloaded',
                timeout: 45_000
            });
            await assertAllowedPage(page, appBaseUrl, contract.workflowId);
            return;
        }
        if (step.action === 'reload') {
            await page.reload({ waitUntil: 'domcontentloaded' });
            await assertAllowedPage(page, appBaseUrl, contract.workflowId);
            return;
        }
        if (step.action === 'expectRoute') {
            const expectedRoute = interpolateTemplate(step.route, variables);
            await expect.poll(() => new URL(page.url()).hash, { timeout: 20_000 }).toContain(`#${expectedRoute}`);
            return;
        }
        if (step.action === 'openLatestMailboxLink') {
            const credentials = actorCredentials(actor);
            const actionUrl = await findLatestParentMailboxActionLink({
                action: step.option,
                recipient: credentials.email,
                clientId: process.env.PARENT_CENSUS_MAILBOX_CLIENT_ID || '',
                clientSecret: process.env.PARENT_CENSUS_MAILBOX_CLIENT_SECRET || '',
                refreshToken: process.env.PARENT_CENSUS_MAILBOX_REFRESH_TOKEN || '',
                afterEpoch: mailboxAfterEpoch
            });
            await page.goto(actionUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 });
            validateParentMailboxActionUrl(page.url(), step.option, {
                allowConsumed: true,
                requireAppRoute: true
            });
            await assertAllowedPage(page, appBaseUrl, contract.workflowId);
            return;
        }
        if (step.action === 'openRunScopedShareLink') {
            const source = await actorRuntime(step.option);
            await assertAllowedPage(source.page, appBaseUrl, contract.workflowId);
            const marker = variables.RUN_MARKER;
            if (!marker) throw new Error('run-scoped share marker is unavailable');
            const link = source.page.locator('a[href*="#/family/"]')
                .filter({ hasText: marker })
                .first();
            await expect(link).toBeVisible({ timeout: 20_000 });
            const href = await link.getAttribute('href');
            if (!href) throw new Error('run-scoped family share link is unavailable');
            const destination = new URL(href, source.page.url());
            const allowed = new URL(appBaseUrl);
            const route = destination.hash.startsWith('#') ? destination.hash.slice(1) : '/';
            if (
                destination.origin !== allowed.origin ||
                !destination.pathname.startsWith(allowed.pathname) ||
                !workflowRouteAllowed(contract.workflowId, route || '/', true)
            ) {
                throw new Error('run-scoped family share link left the trusted workflow capability');
            }
            await page.goto(destination.toString(), { waitUntil: 'domcontentloaded', timeout: 45_000 });
            await assertAllowedPage(page, appBaseUrl, contract.workflowId);
            return;
        }
        if (step.action === 'logout') {
            await assertAllowedPage(page, appBaseUrl, contract.workflowId);
            await page.getByRole('button', { name: 'Sign out' }).first().click();
            await expect.poll(() => new URL(page.url()).hash, { timeout: 20_000 }).toMatch(/^#\/(?:auth|home)(?:\?|$)/);
            runtime.signedIn = false;
            return;
        }

        await assertAllowedPage(page, appBaseUrl, contract.workflowId);
        if (step.action === 'restoreFriendship') {
            const peerEmail = actorCredentials('peer').email;
            const anchors = page.getByText(peerEmail, { exact: true });
            await expect(anchors).toHaveCount(1, { timeout: 20_000 });
            const container = anchors.locator(
                'xpath=ancestor-or-self::*[self::article or self::li or self::tr or @role="row" or @role="listitem" or @data-testid][1]'
            );
            await expect(container).toHaveCount(1, { timeout: 20_000 });
            const candidates = [
                container.getByRole('button', { name: 'Cancel request', exact: true }),
                container.getByRole('button', { name: 'Remove friend', exact: true })
            ];
            const visible = [];
            for (const candidate of candidates) {
                if (await candidate.count() === 1 && await candidate.isVisible()) visible.push(candidate);
            }
            if (visible.length !== 1) {
                throw new Error('bounded friendship restoration target is unavailable or ambiguous');
            }
            await visible[0].click();
            await assertAllowedPage(page, appBaseUrl, contract.workflowId);
            return;
        }
        const target = await locatorFor(page, step.target, variables, step.scope);
        if ([
            'click', 'clickAndExpectGoogleAuth', 'clickAndExpectRoute',
            'clickAndExpectDownload', 'clickAndExpectStripeCheckout', 'fill',
            'fillActorEmail', 'fillActorPassword', 'check', 'uncheck', 'select',
            'rememberControl', 'restoreControl', 'uploadSyntheticImage',
            'uploadSyntheticDocument'
        ].includes(step.action)) {
            await expect(target).toHaveCount(1, { timeout: 20_000 });
        }
        switch (step.action) {
        case 'click':
            await assertClickNavigationAllowed(target, page, appBaseUrl, contract.workflowId);
            await target.click();
            markMutationCompleted();
            await assertAllowedPage(page, appBaseUrl, contract.workflowId);
            break;
        case 'clickAndExpectGoogleAuth': {
            const popupPromise = page.waitForEvent('popup', { timeout: 20_000 });
            const navigationPromise = page.waitForURL((value) => value.hostname === 'accounts.google.com', { timeout: 20_000 })
                .then(() => null);
            await target.click();
            const popup = await Promise.race([popupPromise, navigationPromise]);
            const authPage = popup || page;
            await authPage.waitForLoadState('domcontentloaded', { timeout: 45_000 });
            const destination = new URL(authPage.url());
            if (destination.protocol !== 'https:' || destination.hostname !== 'accounts.google.com' || destination.port) {
                throw new Error('Google sign-in did not reach the allowlisted account handoff');
            }
            if (popup) await popup.close();
            else await page.goBack({ waitUntil: 'domcontentloaded' });
            await assertAllowedPage(page, appBaseUrl, contract.workflowId);
            break;
        }
        case 'clickAndExpectRoute': {
            await assertClickNavigationAllowed(target, page, appBaseUrl, contract.workflowId);
            await target.click();
            const expectedRoute = interpolateTemplate(step.route, variables);
            await expect.poll(() => new URL(page.url()).hash, { timeout: 20_000 }).toContain(`#${expectedRoute}`);
            await assertAllowedPage(page, appBaseUrl, contract.workflowId);
            break;
        }
        case 'clickAndExpectDownload': {
            const downloadPromise = page.waitForEvent('download', { timeout: 20_000 });
            await target.click();
            const download = await downloadPromise;
            expect(download.suggestedFilename()).toMatch(/\.(?:ics|pdf)$/i);
            await download.cancel().catch(() => {});
            await assertAllowedPage(page, appBaseUrl, contract.workflowId);
            break;
        }
        case 'clickAndExpectStripeCheckout': {
            const popupPromise = page.waitForEvent('popup', { timeout: 20_000 });
            await target.click();
            const popup = await popupPromise;
            try {
                await popup.waitForLoadState('domcontentloaded', { timeout: 45_000 });
                const destination = new URL(popup.url());
                if (
                    destination.protocol !== 'https:' ||
                    destination.hostname !== 'checkout.stripe.com' ||
                    destination.port ||
                    destination.username ||
                    destination.password ||
                    !destination.pathname.startsWith('/c/pay/')
                ) {
                    throw new Error('checkout popup did not reach the allowlisted Stripe destination');
                }
                await expect(popup).not.toHaveTitle(/(?:page not found|something went wrong|error)/i, { timeout: 10_000 });
                await expect(popup.locator('body')).not.toContainText(
                    /(?:page not found|something went wrong|unable to load checkout)/i,
                    { timeout: 10_000 }
                );
            } finally {
                await popup.close().catch(() => {});
            }
            await assertAllowedPage(page, appBaseUrl, contract.workflowId);
            break;
        }
        case 'fill':
            await target.fill(interpolateTextTemplate(step.value, variables));
            markMutationCompleted();
            break;
        case 'fillActorEmail':
            await target.fill(actorCredentials(actor).email);
            break;
        case 'fillActorPassword':
            await target.fill(actorCredentials(actor).password);
            break;
        case 'check':
            await target.check();
            markMutationCompleted();
            break;
        case 'uncheck':
            await target.uncheck();
            markMutationCompleted();
            break;
        case 'select':
            await target.selectOption({ label: interpolateTextTemplate(step.option, variables) });
            markMutationCompleted();
            break;
        case 'rememberControl': {
            const state = await target.evaluate((element) => {
                const input = /** @type {HTMLInputElement} */ (element);
                if (input.type === 'checkbox') {
                    return { kind: 'checked', value: input.checked };
                }
                if (input.type === 'radio') throw new Error('radio controls cannot be restored safely');
                if (element.tagName === 'SELECT') return { kind: 'select', value: input.value };
                return { kind: 'value', value: input.value };
            });
            rememberedControls.set(`${actor}:${step.option}`, state);
            break;
        }
        case 'restoreControl': {
            const key = `${actor}:${step.option}`;
            const state = rememberedControls.get(key);
            if (!state) throw new Error(`remembered control ${step.option} is unavailable`);
            if (state.kind === 'checked') {
                if (state.value) await target.check();
                else await target.uncheck();
            } else if (state.kind === 'select') {
                await target.selectOption(state.value);
            } else {
                await target.fill(state.value);
            }
            markMutationCompleted();
            break;
        }
        case 'uploadSyntheticImage':
            await target.setInputFiles(await makeSyntheticImage(variables.RUN_MARKER));
            markMutationCompleted();
            break;
        case 'uploadSyntheticDocument':
            await target.setInputFiles(await makeSyntheticDocument(variables.RUN_MARKER));
            markMutationCompleted();
            break;
        case 'expectVisible':
            await expect(target).toBeVisible({ timeout: 20_000 });
            break;
        case 'expectHidden':
            await expect(target).toBeHidden({ timeout: 20_000 });
            break;
        case 'expectText':
            await expect(target).toContainText(interpolateTextTemplate(step.value, variables), { timeout: 20_000 });
            break;
        case 'expectNoText':
            await expect(target).not.toContainText(interpolateTextTemplate(step.value, variables), { timeout: 20_000 });
            break;
        default:
            throw new Error(`unsupported action ${step.action}`);
        }
    }

    return {
        actors,
        executeStep,
        shouldExecuteCleanup(step) {
            return mutationTracker.shouldExecute(step);
        },
        runtimeIssues() {
            return [...actors.values()].flatMap((runtime) => runtime.issues);
        },
        async close() {
            await Promise.all([...actors.values()].map(({ context }) => context.close().catch(() => {})));
        },
        redact(value) {
            return redactParentCoverageValue(value, secrets);
        }
    };
}
