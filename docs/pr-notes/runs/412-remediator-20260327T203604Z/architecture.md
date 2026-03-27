Thinking level: low
Role: Architecture
Change shape: extend mockLoginPageModules with one additional route interceptor for /js/login-page.js?v=1.
Reasoning: login.html resolves module imports before attaching DOM handlers, so the page bootstrap fails unless every imported module is intercepted in the smoke environment.
Blast radius: isolated to a single smoke spec; no runtime, HTML, or shared module changes.
Rollback: remove the added route handler if the page stops importing login-page.js in the future.
