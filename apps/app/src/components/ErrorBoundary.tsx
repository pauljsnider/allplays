import { Component, type ErrorInfo, type ReactNode } from 'react';

type ErrorBoundaryVariant = 'screen' | 'panel';

export interface ReactErrorBoundaryReport {
  boundaryName: string;
  error: Error;
  errorInfo: ErrorInfo;
  location: string;
}

interface ErrorBoundaryProps {
  children: ReactNode;
  name: string;
  variant?: ErrorBoundaryVariant;
  resetKey?: string;
  onError?: (report: ReactErrorBoundaryReport) => void;
  onGoHome?: () => void;
}

interface ErrorBoundaryState {
  error: Error | null;
}

declare global {
  interface Window {
    __ALLPLAYS_REPORT_REACT_ERROR__?: (report: ReactErrorBoundaryReport) => void;
  }
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    const report = {
      boundaryName: this.props.name,
      error,
      errorInfo,
      location: getCurrentLocation()
    };

    this.props.onError?.(report);
    reportReactErrorBoundary(report);
  }

  componentDidUpdate(previousProps: ErrorBoundaryProps, previousState: ErrorBoundaryState) {
    if (this.state.error && previousState.error && previousProps.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  private reset = () => {
    this.setState({ error: null });
  };

  private reload = () => {
    window.location.reload();
  };

  private goHome = () => {
    if (this.props.onGoHome) {
      this.props.onGoHome();
      return;
    }

    if (typeof window !== 'undefined') {
      window.location.hash = '#/home';
    }

    this.reset();
  };

  render() {
    if (!this.state.error) {
      return this.props.children;
    }

    const variant = this.props.variant || 'panel';
    const content = (
      <section
        className={`${variant === 'screen' ? 'app-card w-full max-w-md p-5 text-center' : 'app-card p-5'} space-y-4`}
        role="alert"
        aria-label="Screen error"
      >
        <div>
          <div className="app-label">Unexpected error</div>
          <h1 className={`${variant === 'screen' ? 'text-xl' : 'text-lg'} font-black text-gray-950`}>
            This screen ran into a problem.
          </h1>
          <p className="mt-2 text-sm font-semibold leading-6 text-gray-600">
            You can retry this screen, go home, or reload ALL PLAYS.
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <button type="button" className="primary-button flex-1" onClick={this.reset}>
            Retry
          </button>
          <button type="button" className="secondary-button flex-1" onClick={this.goHome}>
            Go home
          </button>
          <button type="button" className="ghost-button flex-1" onClick={this.reload}>
            Reload
          </button>
        </div>
      </section>
    );

    if (variant === 'screen') {
      return (
        <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4 py-8">
          {content}
        </div>
      );
    }

    return content;
  }
}

export function reportReactErrorBoundary(report: ReactErrorBoundaryReport) {
  const reporter = typeof window !== 'undefined' ? window.__ALLPLAYS_REPORT_REACT_ERROR__ : undefined;

  if (reporter) {
    try {
      reporter(report);
    } catch (reportError) {
      console.error('[error-boundary] report hook failed:', reportError);
    }
  }

  console.error('[error-boundary] React render error:', {
    boundaryName: report.boundaryName,
    location: report.location,
    error: report.error,
    componentStack: report.errorInfo.componentStack
  });
}

function getCurrentLocation() {
  if (typeof window === 'undefined') {
    return '';
  }

  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}
