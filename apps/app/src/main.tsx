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
import './styles/index.css';

void initializeAppErrorTracking();
installReactErrorTelemetry();
void initializeWebVitalsMonitoring();
void initializeNativeAppearance();
const startupTimer = startAppStartupTimer();

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
