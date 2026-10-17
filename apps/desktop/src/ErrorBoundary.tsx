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
        <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-6 font-sans select-none">
          <div className="max-w-xl w-full bg-slate-900 border border-red-500/30 rounded-2xl p-6 shadow-2xl space-y-5">
            <div className="flex items-center space-x-3 text-red-400">
              <div className="p-2.5 bg-red-950/60 border border-red-500/20 rounded-xl">
                <AlertTriangle className="w-6 h-6" />
              </div>
              <div>
                <h2 className="text-lg font-bold tracking-tight text-white">Workbench Interface Error</h2>
                <p className="text-xs text-slate-400">An unexpected error occurred while rendering the UI.</p>
              </div>
            </div>

            <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-4 font-mono text-xs text-red-300 overflow-x-auto max-h-48">
              <p className="font-semibold text-red-200 mb-1">
                {this.state.error?.name || 'Error'}: {this.state.error?.message || 'Unknown runtime error'}
              </p>
              {this.state.error?.stack && (
                <pre className="text-[11px] text-slate-400 mt-2 whitespace-pre-wrap leading-relaxed">
                  {this.state.error.stack}
                </pre>
              )}
            </div>

            {this.state.errorInfo?.componentStack && (
              <details className="text-xs text-slate-400 cursor-pointer">
                <summary className="hover:text-slate-200 transition-colors py-1">View Component Stack</summary>
                <pre className="mt-2 bg-slate-950/60 p-3 rounded-lg border border-slate-800/80 text-[10px] text-slate-400 overflow-x-auto whitespace-pre-wrap">
                  {this.state.errorInfo.componentStack}
                </pre>
              </details>
            )}

            <div className="flex items-center justify-end space-x-3 pt-2 border-t border-slate-800">
              <button
                onClick={this.handleReset}
                className="inline-flex items-center space-x-1.5 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium rounded-lg transition-colors border border-slate-700/60"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Try Again</span>
              </button>
              <button
                onClick={this.handleReload}
                className="inline-flex items-center space-x-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium rounded-lg transition-colors shadow-sm shadow-emerald-950"
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
