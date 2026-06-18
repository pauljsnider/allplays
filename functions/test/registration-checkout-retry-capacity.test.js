import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Module, { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const repoIndexPath = require.resolve('../index.js');
const originalModuleLoad = Module._load;

let adminStub = null;
let functionsStub = null;
let StripeStub = null;

function patchedModuleLoad(request, parent, isMain) {
  if (request === 'firebase-admin' && adminStub) {
    return adminStub;
  }
  if (request === 'firebase-functions' && functionsStub) {
    return functionsStub;
  }
  if (request === 'stripe' && StripeStub) {
    return StripeStub;
  }
  return originalModuleLoad(request, parent, isMain);
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function setNested(target, path, value) {
  const parts = String(path || '').split('.').filter(Boolean);
  let cursor = target;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i];
    if (!cursor[key] || typeof cursor[key] !== 'object' || Array.isArray(cursor[key])) {
      cursor[key] = {};
    }
    cursor = cursor[key];
  }
  cursor[parts[parts.length - 1]] = value;
}

function deleteNested(target, path) {
  const parts = String(path || '').split('.').filter(Boolean);
  let cursor = target;
  for (let i = 0; i < parts.length - 1; i++) {
    cursor = cursor?.[parts[i]];
    if (!cursor || typeof cursor !== 'object') return;
  }
  if (cursor && typeof cursor === 'object') {
    delete cursor[parts[parts.length - 1]];
  }
}

function makeFirestore(seed = {}) {
  const state = new Map(Object.entries(clone(seed)));

  const fieldValue = {
    serverTimestamp: () => ({ __op: 'serverTimestamp' }),
    delete: () => ({ __op: 'delete' }),
    increment: (amount) => ({ __op: 'increment', amount }),
    arrayUnion: (...items) => ({ __op: 'arrayUnion', items })
  };

  const isOp = (value, kind) => value && typeof value === 'object' && value.__op === kind;

  function applyPatch(baseValue, patchValue, merge) {
    const target = merge ? clone(baseValue || {}) : {};
    Object.entries(patchValue || {}).forEach(([key, value]) => {
      if (isOp(value, 'delete')) {
        deleteNested(target, key);
      } else if (isOp(value, 'serverTimestamp')) {
        setNested(target, key, 'SERVER_TIMESTAMP');
      } else if (isOp(value, 'increment')) {
        const current = Number(key.split('.').reduce((acc, part) => (acc == null ? acc : acc[part]), target) || 0);
        setNested(target, key, current + value.amount);
      } else if (isOp(value, 'arrayUnion')) {
        const current = key.split('.').reduce((acc, part) => (acc == null ? acc : acc[part]), target);
        const array = Array.isArray(current) ? [...current] : [];
        value.items.forEach((item) => array.push(clone(item)));
        setNested(target, key, array);
      } else {
        setNested(target, key, clone(value));
      }
    });
    return target;
  }

  function write(path, value, options = {}) {
    const current = state.get(path);
    const next = applyPatch(current, value, options.merge === true);
    state.set(path, next);
  }

  function doc(path) {
    return {
      path,
      id: String(path).split('/').pop(),
      async get() {
        const data = state.get(path);
        return {
          exists: data !== undefined,
          id: String(path).split('/').pop(),
          ref: this,
          data: () => clone(data)
        };
      },
      async set(value, options) {
        write(path, value, options || {});
      },
      async update(value) {
        const current = state.get(path);
        if (current === undefined) {
          throw new Error(`Missing document for update: ${path}`);
        }
        write(path, value, { merge: true });
      },
      collection(name) {
        return collection(`${path}/${name}`);
      }
    };
  }

  function collection(path) {
    return {
      path,
      doc(id) {
        return doc(`${path}/${id}`);
      }
    };
  }

  return {
    _state: state,
    doc,
    collection,
    async runTransaction(handler) {
      const transaction = {
        get: (ref) => ref.get(),
        set: (ref, value, options) => ref.set(value, options),
        update: (ref, value) => ref.update(value)
      };
      return handler(transaction);
    },
    snapshot(path) {
      return clone(state.get(path));
    },
    FieldValue: fieldValue
  };
}

function makeFunctionsStub() {
  class HttpsError extends Error {
    constructor(code, message) {
      super(message);
      this.code = code;
    }
  }

  const triggerChain = {
    onCall: (fn) => fn,
    onRequest: (fn) => fn,
    onCreate: (fn) => fn,
    onUpdate: (fn) => fn,
    onWrite: (fn) => fn,
    onRun: (fn) => fn,
    document() {
      return this;
    },
    schedule() {
      return this;
    },
    timeZone() {
      return this;
    }
  };
  triggerChain.https = triggerChain;
  triggerChain.firestore = triggerChain;
  triggerChain.pubsub = triggerChain;

  return {
    config: () => ({ stripe: { secret_key: 'sk_test_123', app_url: 'https://allplays.test' } }),
    https: {
      HttpsError,
      onCall: (fn) => fn,
      onRequest: (fn) => fn
    },
    firestore: {
      document: () => triggerChain
    },
    pubsub: {
      schedule: () => triggerChain
    },
    runWith: () => triggerChain,
    logger: {
      error: () => {},
      warn: () => {},
      info: () => {}
    }
  };
}

function loadCheckoutHandler({ seed, stripeCreateImpl }) {
  delete require.cache[repoIndexPath];

  const firestore = makeFirestore(seed);
  adminStub = {
    apps: [true],
    initializeApp: () => {},
    firestore: Object.assign(() => firestore, { FieldValue: firestore.FieldValue }),
    auth: () => ({ verifyIdToken: async () => null }),
    messaging: () => ({})
  };
  functionsStub = makeFunctionsStub();
  StripeStub = class StripeMock {
    constructor() {
      return {
        checkout: {
          sessions: {
            create: stripeCreateImpl
          }
        },
        webhooks: {
          constructEvent: () => {
            throw new Error('Not implemented in test.');
          }
        }
      };
    }
  };

  const mod = require('../index.js');
  return {
    firestore,
    createStripeRegistrationCheckout: mod.createStripeRegistrationCheckout
  };
}

function buildSeedState() {
  return {
    'teams/team-1/registrationForms/form-1': {
      published: true,
      paymentSettings: { onlineCheckoutEnabled: true },
      feeAmountCents: 5000,
      currency: 'USD',
      registrationOptionCounts: {
        u10: {
          enrolled: 0,
          waitlisted: 0
        }
      }
    },
    'teams/team-1/registrationForms/form-1/registrations/reg-1': {
      teamId: 'team-1',
      formId: 'form-1',
      status: 'pending',
      registrationCapacityReleased: true,
      checkoutAttemptToken: 'attempttoken12345',
      selectedOption: {
        id: 'u10',
        countKey: 'u10',
        capacityLimit: 5
      },
      guardian: {
        email: 'parent@example.com'
      }
    }
  };
}

const checkoutInput = {
  teamId: 'team-1',
  formId: 'form-1',
  registrationId: 'reg-1',
  checkoutAttemptToken: 'attempttoken12345',
  retryPayment: true
};

describe('createStripeRegistrationCheckout retry capacity handling', () => {
  beforeEach(() => {
    delete require.cache[repoIndexPath];
    Module._load = patchedModuleLoad;
    adminStub = null;
    functionsStub = null;
    StripeStub = null;
  });

  afterEach(() => {
    delete require.cache[repoIndexPath];
    Module._load = originalModuleLoad;
    adminStub = null;
    functionsStub = null;
    StripeStub = null;
  });

  it('rolls back reserved capacity when Stripe checkout creation fails', async () => {
    const { firestore, createStripeRegistrationCheckout } = loadCheckoutHandler({
      seed: buildSeedState(),
      stripeCreateImpl: async () => {
        throw new Error('Stripe checkout creation failed.');
      }
    });

    await expect(createStripeRegistrationCheckout(checkoutInput)).rejects.toThrow('Stripe checkout creation failed.');

    const form = firestore.snapshot('teams/team-1/registrationForms/form-1');
    const registration = firestore.snapshot('teams/team-1/registrationForms/form-1/registrations/reg-1');

    expect(form.registrationOptionCounts.u10.enrolled).toBe(0);
    expect(registration.registrationCapacityReleased).toBe(true);
    expect(registration.capacityReleasedAt).toBe('SERVER_TIMESTAMP');
    expect(Object.prototype.hasOwnProperty.call(registration, 'checkoutStatus')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(registration, 'paymentStatus')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(registration, 'checkoutUrl')).toBe(false);
  });

  it('reserves capacity exactly once after a failed retry is retried successfully', async () => {
    const stripeCreateImpl = async () => ({
      id: 'cs_test_123',
      url: 'https://checkout.stripe.com/c/session_123',
      payment_status: 'unpaid'
    });
    const { firestore, createStripeRegistrationCheckout } = loadCheckoutHandler({
      seed: buildSeedState(),
      stripeCreateImpl: async () => {
        throw new Error('Stripe checkout creation failed.');
      }
    });

    await expect(createStripeRegistrationCheckout(checkoutInput)).rejects.toThrow('Stripe checkout creation failed.');

    delete require.cache[repoIndexPath];
    adminStub = {
      apps: [true],
      initializeApp: () => {},
      firestore: Object.assign(() => firestore, { FieldValue: firestore.FieldValue }),
      auth: () => ({ verifyIdToken: async () => null }),
      messaging: () => ({})
    };
    functionsStub = makeFunctionsStub();
    StripeStub = class StripeMock {
      constructor() {
        return {
          checkout: {
            sessions: {
              create: stripeCreateImpl
            }
          },
          webhooks: {
            constructEvent: () => {
              throw new Error('Not implemented in test.');
            }
          }
        };
      }
    };

    const mod = require('../index.js');
    const result = await mod.createStripeRegistrationCheckout(checkoutInput);

    const form = firestore.snapshot('teams/team-1/registrationForms/form-1');
    const registration = firestore.snapshot('teams/team-1/registrationForms/form-1/registrations/reg-1');

    expect(result).toEqual({
      checkoutUrl: 'https://checkout.stripe.com/c/session_123',
      sessionId: 'cs_test_123'
    });
    expect(form.registrationOptionCounts.u10.enrolled).toBe(1);
    expect(registration.registrationCapacityReleased).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(registration, 'capacityReleasedAt')).toBe(false);
    expect(registration.checkoutStatus).toBe('open');
    expect(registration.paymentStatus).toBe('checkout_open');
    expect(registration.stripeCheckoutSessionId).toBe('cs_test_123');
    expect(registration.checkoutAmountCents).toBe(5000);
  });
});
