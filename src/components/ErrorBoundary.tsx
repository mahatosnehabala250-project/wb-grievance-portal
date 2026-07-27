'use client';

import React, { Component, ReactNode } from 'react';
import { AlertTriangle, RefreshCw, Home } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  onReset?: () => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: string | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, errorInfo: null };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    // Log to console in dev, would go to Sentry in production
    console.error('[ErrorBoundary] Caught error:', error, errorInfo);
    this.setState({ errorInfo: errorInfo.componentStack || null });
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
    this.props.onReset?.();
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;

      return (
        <div className="flex-1 flex items-center justify-center p-8">
          <div className="max-w-md w-full text-center space-y-4">
            <div className="w-14 h-14 rounded-full bg-red-100 dark:bg-red-950/30 flex items-center justify-center mx-auto">
              <AlertTriangle className="w-7 h-7 text-red-500" />
            </div>
            <div>
              <h2 className="text-lg font-semibold mb-1">Something went wrong</h2>
              <p className="text-sm text-muted-foreground">
                Yeh page load nahi ho saka. Refresh karo ya admin se contact karo.
              </p>
            </div>
            {process.env.NODE_ENV === 'development' && this.state.error && (
              <details className="text-left text-xs bg-muted/40 rounded-lg p-3 border">
                <summary className="font-mono cursor-pointer text-red-500 mb-1">
                  {this.state.error.message}
                </summary>
                <pre className="whitespace-pre-wrap text-muted-foreground overflow-auto max-h-40">
                  {this.state.errorInfo}
                </pre>
              </details>
            )}
            <div className="flex gap-2 justify-center">
              <Button variant="outline" size="sm" onClick={this.handleReset}>
                <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
                Try Again
              </Button>
              <Button variant="outline" size="sm" onClick={() => window.location.href = '/'}>
                <Home className="w-3.5 h-3.5 mr-1.5" />
                Home
              </Button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

// HOC for functional components
export function withErrorBoundary<T extends object>(
  Component: React.ComponentType<T>,
  fallback?: ReactNode
) {
  return function WrappedComponent(props: T) {
    return (
      <ErrorBoundary fallback={fallback}>
        <Component {...props} />
      </ErrorBoundary>
    );
  };
}
