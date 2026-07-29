import '@testing-library/jest-dom/vitest';

const testWindow = window as typeof window & {
  __ALLPLAYS_CONFIG__?: Record<string, unknown>;
};
const existingConfig = testWindow.__ALLPLAYS_CONFIG__ || {};

testWindow.__ALLPLAYS_CONFIG__ = {
  ...existingConfig,
  firebase: existingConfig.firebase || {
    apiKey: 'test-api-key',
    authDomain: 'test-allplays.firebaseapp.com',
    projectId: 'test-allplays',
    messagingSenderId: '123456789',
    appId: 'test-app-id'
  }
};
