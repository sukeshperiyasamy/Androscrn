import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw, RotateCcw } from 'lucide-react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    };
  }

  static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      error,
      errorInfo: null,
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error('Unhandled React Render Error in AndroScrn Workbench:', error, errorInfo);
    this.setState({
      error,
      errorInfo,
    });
  }

  handleReset = (): void => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
    });
  };

  handleReload = (): void => {
    window.location.reload();
  };

  render(): ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="min-h-screen bg-[#F3F6F8] text-[#202936] flex items-center justify-center p-6 font-sans select-none">
          <div className="max-w-xl w-full bg-white border border-[#D9DEE5] rounded-2xl p-6 shadow-xl space-y-5">
            <div className="flex items-center space-x-3 text-[#B91C1C]">
              <div className="p-2.5 bg-[#FEE2E2] border border-[#B91C1C]/20 rounded-xl">
                <AlertTriangle className="w-6 h-6 text-[#B91C1C]" />
              </div>
              <div>
                <h2 className="text-lg font-bold tracking-tight text-[#202936]">Workbench Interface Error</h2>
                <p className="text-xs text-[#667085]">An unexpected error occurred while rendering the UI.</p>
              </div>
            </div>

            <div className="bg-[#FEE2E2]/40 border border-[#B91C1C]/20 rounded-xl p-4 font-mono text-xs text-[#B91C1C] overflow-x-auto max-h-48">
              <p className="font-semibold text-[#B91C1C] mb-1">
                {this.state.error?.name || 'Error'}: {this.state.error?.message || 'Unknown runtime error'}
              </p>
              {this.state.error?.stack && (
                <pre className="text-[11px] text-[#84909E] mt-2 whitespace-pre-wrap leading-relaxed">
                  {this.state.error.stack}
                </pre>
              )}
            </div>

            {this.state.errorInfo?.componentStack && (
              <details className="text-xs text-[#667085] cursor-pointer">
                <summary className="hover:text-[#202936] transition-colors py-1">View Component Stack</summary>
                <pre className="mt-2 bg-[#F3F6F8] p-3 rounded-lg border border-[#D9DEE5] text-[10px] text-[#667085] overflow-x-auto whitespace-pre-wrap">
                  {this.state.errorInfo.componentStack}
                </pre>
              </details>
            )}

            <div className="flex items-center justify-end space-x-3 pt-2 border-t border-[#D9DEE5]">
              <button
                onClick={this.handleReset}
                className="glass-button text-xs py-2 px-4"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Try Again</span>
              </button>
              <button
                onClick={this.handleReload}
                className="glass-button glass-button-primary text-xs py-2 px-4"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Reload Workbench</span>
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
