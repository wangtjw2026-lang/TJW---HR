import React from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

interface State {
  hasError: boolean;
  errorMessage: string;
  errorDetails: string | null;
}

export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, errorMessage: '', errorDetails: null };
  }

  static getDerivedStateFromError(error: Error): State {
    let message = error.message || 'An unexpected application error occurred.';
    let details: string | null = null;
    try {
      const parsed = JSON.parse(error.message);
      if (parsed && parsed.error && parsed.operationType) {
        message = `Firestore ${String(parsed.operationType).toUpperCase()} blocked on ${parsed.path || 'database'}: ${parsed.error}`;
        details = JSON.stringify(parsed, null, 2);
      }
    } catch {
      // non-JSON standard error
    }
    return { hasError: true, errorMessage: message, errorDetails: details };
  }

  componentDidCatch(error: Error) {
    console.error('ErrorBoundary caught error:', error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
          <div className="max-w-xl w-full bg-white border border-slate-200 rounded-lg p-6 space-y-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-red-700 shrink-0 mt-0.5" />
              <div>
                <h2 className="text-base font-semibold text-slate-900">
                  Unable to complete database operation
                </h2>
                <p className="text-sm text-slate-600 mt-1">{this.state.errorMessage}</p>
              </div>
            </div>
            {this.state.errorDetails && (
              <pre className="text-xs font-mono bg-slate-950 text-slate-100 p-3 rounded overflow-x-auto max-h-60">
                {this.state.errorDetails}
              </pre>
            )}
            <div className="pt-2">
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-teal-700 hover:bg-teal-800 rounded-md transition-colors"
              >
                <RotateCcw className="w-4 h-4" />
                Reload Workspace
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
