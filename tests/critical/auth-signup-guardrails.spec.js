const { test, expect } = require('@playwright/test');

const authModuleSource = String.raw`
const getState = () => globalThis.__authMockState || {};
const getCalls = () => {
  if (!globalThis.__authMockCalls) {
    globalThis.__authMockCalls = {
      checkAuth: 0,
      login: [],
      signup: [],
      loginWithGoogle: [],
      resetPassword: []
    };
  }
  return globalThis.__authMockCalls;
};

const stash = (key, payload) => {
  try {
    sessionStorage.setItem(key, JSON.stringify(payload));
  } catch (_) {
    // Ignore storage errors in test shims.
  }
};

export async function login(email, password) {
  const state = getState();
  getCalls().login.push({ email, password });
  stash('__mockLastLogin', { email, password });

  if (state.loginError) {
    throw new Error(state.loginError);
  }

  return {
    user: {
      uid: state.loginUid || 'uid-login',
      email
    }
  };
}

export async function signup(email, password, activationCode) {
  const state = getState();
  getCalls().signup.push({ email, password, activationCode });
  stash('__mockLastSignup', { email, password, activationCode });

  if (state.signupError) {
    throw new Error(state.signupError);
  }

  return {
    user: {
      uid: state.signupUid || 'uid-signup',
      email
    }
  };
}

export function checkAuth(callback) {
  getCalls().checkAuth += 1;
  const state = getState();
  setTimeout(() => callback(state.checkAuthUser || null), 0);
  return () => {};
}

export async function loginWithGoogle(activationCode = null) {
  const state = getState();
  getCalls().loginWithGoogle.push({ activationCode });
  stash('__mockLastGoogle', { activationCode });

  if (state.googleError) {
    throw new Error(state.googleError);
  }

  if (state.googleReturnsNull) {
    return null;
  }

  return {
    user: {
      uid: state.googleUid || 'uid-google',
      email: state.googleEmail || 'google@example.com',
      metadata: {
        creationTime: '2026-02-21T00:00:00.000Z',
        lastSignInTime: '2026-02-22T00:00:00.000Z'
      }
    }
  };
}

export async function handleGoogleRedirectResult() {
  const state = getState();
  if (!state.googleRedirectUser) {
    return null;
  }

  return { user: state.googleRedirectUser };
}

export async function resetPassword(email) {
  const state = getState();
  getCalls().resetPassword.push({ email });
  if (state.resetPasswordError) {
    throw Object.assign(new Error(state.resetPasswordError), { code: state.resetPasswordErrorCode });
  }
}

export function getRedirectUrl(user) {
  if (user && (user.isAdmin || (Array.isArray(user.coachOf) && user.coachOf.length > 0))) {
    return 'dashboard.html';
  }

  if (user && Array.isArray(user.parentOf) && user.parentOf.length > 0) {
    return 'parent-dashboard.html';
  }

  return 'dashboard.html';
}
`;

const dbModuleSource = String.raw`
const getState = () => globalThis.__authMockState || {};

export async function getUserProfile(uid) {
  const state = getState();
  if (state.profilesByUid && state.profilesByUid[uid]) {
    return state.profilesByUid[uid];
  }
  return {};
}
`;

const utilsModuleSource = String.raw`
export function renderHeader(container) {
  if (container) {
    container.setAttribute('data-rendered', 'header');
  }
}

export function renderFooter(container) {
  if (container) {
    container.setAttribute('data-rendered', 'footer');
  }
}
`;

async function installLoginPageModuleMocks(page, state = {}) {
  await page.addInitScript((initState) => {
    window.__authMockState = initState;
    window.__authMockCalls = {
      checkAuth: 0,
      login: [],
      signup: [],
      loginWithGoogle: [],
      resetPassword: []
    };
    sessionStorage.removeItem('__mockLastLogin');
    sessionStorage.removeItem('__mockLastSignup');
    sessionStorage.removeItem('__mockLastGoogle');
  }, state);

  await page.route(/\/js\/auth\.js(?:\?.*)?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: authModuleSource
    });
  });

  await page.route(/\/js\/db\.js(?:\?.*)?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: dbModuleSource
    });
  });

  await page.route(/\/js\/utils\.js(?:\?.*)?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: utilsModuleSource
    });
  });

  await page.route('https://www.googletagmanager.com/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: ''
    });
  });
}

async function gotoLogin(page, { query = '', state = {} } = {}) {
  await installLoginPageModuleMocks(page, state);
  await page.goto(`/login.html${query}`);
}

test.describe('Auth + signup guardrails @critical', () => {
  test('login form defaults to sign-in mode', async ({ page }) => {
    await gotoLogin(page);

    await expect(page.locator('#form-title')).toHaveText('Login');
    await expect(page.locator('#submit-btn')).toHaveText('Sign In');
    await expect(page.locator('#confirm-password-field')).toBeHidden();
    await expect(page.locator('#activation-code-field')).toBeHidden();
    await expect(page.locator('#forgot-password-link')).toBeVisible();
  });

  test('toggle switches to signup mode and shows signup-only fields', async ({ page }) => {
    await gotoLogin(page);

    await page.locator('#toggle-btn').click();

    await expect(page.locator('#form-title')).toHaveText('Sign Up');
    await expect(page.locator('#submit-btn')).toHaveText('Create Account');
    await expect(page.locator('#confirm-password-field')).toBeVisible();
    await expect(page.locator('#activation-code-field')).toBeVisible();
    await expect(page.locator('#forgot-password-link')).toBeHidden();
  });

  test('invite code in URL auto-enables signup and applies uppercase code', async ({ page }) => {
    await gotoLogin(page, { query: '?code=ab12cd34' });

    await expect(page.locator('#form-title')).toHaveText('Sign Up');
    await expect(page.locator('#submit-btn')).toHaveText('Create Account');
    await expect(page.locator('#activation-code-field')).toBeHidden();
    await expect(page.locator('#activation-code')).toHaveValue('AB12CD34');
    await expect(page.getByText("You've been invited to ALL PLAYS!")).toBeVisible();
  });

  test('signup blocks mismatched password confirmation', async ({ page }) => {
    await gotoLogin(page);

    await page.locator('#toggle-btn').click();
    await page.locator('#email').fill('newuser@example.com');
    await page.locator('#password').fill('password-123');
    await page.locator('#confirm-password').fill('password-999');
    await page.locator('#activation-code').fill('AB12CD34');
    await page.locator('#submit-btn').click();

    await expect(page.locator('#error-message')).toHaveText('Passwords do not match');
    const signupCalls = await page.evaluate(() => window.__authMockCalls.signup.length);
    expect(signupCalls).toBe(0);
  });

  test('signup requires activation code when toggled manually', async ({ page }) => {
    await gotoLogin(page);

    await page.locator('#toggle-btn').click();
    await page.locator('#email').fill('newuser@example.com');
    await page.locator('#password').fill('password-123');
    await page.locator('#confirm-password').fill('password-123');
    await page.locator('#submit-btn').click();

    await expect(page.locator('#error-message')).toHaveText('Activation code is required');
    const signupCalls = await page.evaluate(() => window.__authMockCalls.signup.length);
    expect(signupCalls).toBe(0);
  });

  test('signup normalizes activation code to uppercase and redirects to verify-pending', async ({ page }) => {
    await gotoLogin(page);

    await page.locator('#toggle-btn').click();
    await page.locator('#email').fill('newuser@example.com');
    await page.locator('#password').fill('password-123');
    await page.locator('#confirm-password').fill('password-123');
    await page.locator('#activation-code').fill('ab12cd34');

    await Promise.all([
      page.waitForURL(/\/verify-pending\.html$/),
      page.locator('#submit-btn').click()
    ]);

    const signupPayload = await page.evaluate(() => JSON.parse(sessionStorage.getItem('__mockLastSignup')));
    expect(signupPayload.activationCode).toBe('AB12CD34');
  });

  test('login success routes coaches/admins to dashboard', async ({ page }) => {
    await gotoLogin(page, {
      state: {
        profilesByUid: {
          'uid-login': { coachOf: ['team-1'] }
        }
      }
    });

    await page.locator('#email').fill('coach@example.com');
    await page.locator('#password').fill('password-123');

    await Promise.all([
      page.waitForURL(/\/dashboard\.html$/),
      page.locator('#submit-btn').click()
    ]);
  });

  test('login success routes parents to parent dashboard', async ({ page }) => {
    await gotoLogin(page, {
      state: {
        profilesByUid: {
          'uid-login': { parentOf: [{ teamId: 'team-1', playerId: 'player-1' }] }
        }
      }
    });

    await page.locator('#email').fill('parent@example.com');
    await page.locator('#password').fill('password-123');

    await Promise.all([
      page.waitForURL(/\/parent-dashboard\.html$/),
      page.locator('#submit-btn').click()
    ]);
  });

  test('login error stays on page and shows message', async ({ page }) => {
    await gotoLogin(page, {
      state: {
        loginError: 'Invalid email or password'
      }
    });

    await page.locator('#email').fill('coach@example.com');
    await page.locator('#password').fill('wrong-password');
    await page.locator('#submit-btn').click();

    await expect(page).toHaveURL(/\/login\.html$/);
    await expect(page.locator('#error-message')).toHaveText('Invalid email or password');
  });

  test('google sign-in from login mode starts without activation code', async ({ page }) => {
    await gotoLogin(page);

    await Promise.all([
      page.waitForURL(/\/dashboard\.html$/),
      page.locator('#google-btn').click()
    ]);

    const googlePayload = await page.evaluate(() => JSON.parse(sessionStorage.getItem('__mockLastGoogle')));
    expect(googlePayload.activationCode).toBeNull();
  });

  test('google signup mode requires activation code', async ({ page }) => {
    await gotoLogin(page);

    await page.locator('#toggle-btn').click();
    await page.locator('#google-btn').click();

    await expect(page.locator('#error-message')).toHaveText('Activation code is required for new accounts');
    const googleCalls = await page.evaluate(() => window.__authMockCalls.loginWithGoogle.length);
    expect(googleCalls).toBe(0);
  });

  test('google signup mode normalizes activation code and allows redirect', async ({ page }) => {
    await gotoLogin(page, {
      state: {
        profilesByUid: {
          'uid-google': { parentOf: [{ teamId: 'team-9', playerId: 'player-9' }] }
        }
      }
    });

    await page.locator('#toggle-btn').click();
    await page.locator('#activation-code').fill('xy98zt76');

    await Promise.all([
      page.waitForURL(/\/parent-dashboard\.html$/),
      page.locator('#google-btn').click()
    ]);

    const googlePayload = await page.evaluate(() => JSON.parse(sessionStorage.getItem('__mockLastGoogle')));
    expect(googlePayload.activationCode).toBe('XY98ZT76');
  });
});
