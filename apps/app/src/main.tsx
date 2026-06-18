import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import { installReactErrorTelemetry, startAppStartupTimer } from './lib/telemetry';
import './styles/index.css';

installReactErrorTelemetry();
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
  });
} catch (error) {
  startupTimer.end({ phase: 'initial-render', error });
  throw error;
}
