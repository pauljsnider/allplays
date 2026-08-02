import { expect } from '@playwright/test';
import {
    interpolateTemplate,
    interpolateTextTemplate,
    redactParentCoverageValue
} from '../../../scripts/parent-coverage-contract.mjs';
import { findLatestParentMailboxActionLink } from '../../../scripts/parent-coverage-mailbox.mjs';
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

function locatorFor(page, descriptor, variables) {
    const name = interpolateTextTemplate(descriptor.name, variables);
    const options = descriptor.exact === undefined ? undefined : { exact: descriptor.exact };
    switch (descriptor.kind) {
    case 'role':
        return page.getByRole(descriptor.role, { name, ...(options || {}) });
    case 'label':
        return page.getByLabel(name, options);
    case 'text':
        return page.getByText(name, options);
    case 'testId':
        return page.getByTestId(name);
    default:
        throw new Error(`unsupported locator kind ${descriptor.kind}`);
    }
}

async function assertAllowedPage(page, appBaseUrl) {
    const current = new URL(page.url());
    const allowed = new URL(appBaseUrl);
    if (current.origin !== allowed.origin || !current.pathname.startsWith(allowed.pathname)) {
        throw new Error('contract attempted to leave the protected AllPlays app origin');
    }
}

async function makeSyntheticImage() {
    return {
        name: 'allplays-parent-census.png',
        mimeType: 'image/png',
        buffer: Buffer.from(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nMcAAAAASUVORK5CYII=',
            'base64'
        )
    };
}

export async function createParentCoverageRuntime(browser, contract, appBaseUrl) {
    const actors = new Map();
    const rememberedControls = new Map();
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

    async function executeStep(step) {
        const actor = step.actor || contract.actors[0];
        const runtime = await actorRuntime(actor);
        const { page } = runtime;
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
            await assertAllowedPage(page, appBaseUrl);
            return;
        }
        if (step.action === 'reload') {
            await page.reload({ waitUntil: 'domcontentloaded' });
            await assertAllowedPage(page, appBaseUrl);
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
            const current = new URL(page.url());
            if (!allowedMailboxActionHost(current.hostname)) {
                throw new Error('mailbox action left the allowlisted AllPlays authentication hosts');
            }
            return;
        }
        if (step.action === 'logout') {
            await page.getByRole('button', { name: 'Sign out' }).first().click();
            await expect.poll(() => new URL(page.url()).hash, { timeout: 20_000 }).toMatch(/^#\/(?:auth|home)(?:\?|$)/);
            runtime.signedIn = false;
            return;
        }

        const target = locatorFor(page, step.target, variables).first();
        switch (step.action) {
        case 'click':
            await target.click();
            await assertAllowedPage(page, appBaseUrl);
            break;
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
            await assertAllowedPage(page, appBaseUrl);
            break;
        }
        case 'fill':
            await target.fill(interpolateTextTemplate(step.value, variables));
            break;
        case 'fillActorEmail':
            await target.fill(actorCredentials(actor).email);
            break;
        case 'fillActorPassword':
            await target.fill(actorCredentials(actor).password);
            break;
        case 'check':
            await target.check();
            break;
        case 'uncheck':
            await target.uncheck();
            break;
        case 'select':
            await target.selectOption({ label: interpolateTextTemplate(step.option, variables) });
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
            break;
        }
        case 'uploadSyntheticImage':
            await target.setInputFiles(await makeSyntheticImage());
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

function allowedMailboxActionHost(hostname) {
    return [
        'allplays.ai',
        'www.allplays.ai',
        'game-flow-c6311.firebaseapp.com',
        'game-flow-c6311.web.app'
    ].includes(hostname);
}
