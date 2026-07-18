import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import {
  captureAppStartupFailure,
  initializeAppErrorTracking,
  installReactErrorTelemetry
} from './lib/telemetry';
import { startAppStartupTimer } from './lib/uxTiming';
import { hideNativeSplashScreen, initializeNativeAppearance } from './lib/nativeAppearance';
import { initializeWebVitalsMonitoring } from './lib/webVitals';
import { initializeAppDataCachePersistence } from './lib/appDataCache';
import './styles/index.css';

void initializeAppErrorTracking();
installReactErrorTelemetry();
void initializeWebVitalsMonitoring();
void initializeNativeAppearance();
const startupTimer = startAppStartupTimer();

async function renderApp() {
  await initializeAppDataCachePersistence();
  try {
    ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
      <React.StrictMode>
        <ErrorBoundary name="app-root" variant="screen">
          <HashRouter>
            <App />
          </HashRouter>
        </ErrorBoundary>
      </React.StrictMode>
    );
    const scheduleRenderTiming = typeof window.requestAnimationFrame === 'function'
      ? window.requestAnimationFrame.bind(window)
      : (callback: FrameRequestCallback) => window.setTimeout(() => callback(performance.now()), 0);
    scheduleRenderTiming(() => {
      startupTimer.end({ phase: 'initial-render' });
      void hideNativeSplashScreen();
    });
  } catch (error) {
    captureAppStartupFailure(error, { phase: 'initial-render' });
    startupTimer.end({ phase: 'initial-render', error });
    throw error;
  }
}

export const appStartupPromise = renderApp();
// Startup failures are captured inside renderApp. Attach a handler here so a
// failed render does not become an unhandled rejection in the native WebView;
// tests and diagnostics can still await the original rejected promise.
void appStartupPromise.catch(() => undefined);
