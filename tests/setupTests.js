if (typeof window !== 'undefined') {
    window.__ALLPLAYS_CONFIG__ = {
        ...window.__ALLPLAYS_CONFIG__,
        firebase: window.__ALLPLAYS_CONFIG__?.firebase || {
            apiKey: 'test-api-key',
            authDomain: 'test-allplays.firebaseapp.com',
            projectId: 'test-allplays',
            messagingSenderId: '123456789',
            appId: 'test-app-id'
        }
    };
}
