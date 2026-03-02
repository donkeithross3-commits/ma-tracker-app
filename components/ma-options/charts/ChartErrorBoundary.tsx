"use client";

import React from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";

interface Props {
  children: React.ReactNode;
  widgetId?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/**
 * Error boundary for individual chart widgets.
 *
 * Prevents a crash in one widget (e.g. bad IB data, lightweight-charts error)
 * from taking down the entire charts page. Shows a recoverable error state
 * with a retry button.
 */
export class ChartErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error(
      `[ChartErrorBoundary] Widget ${this.props.widgetId ?? "unknown"} crashed:`,
      error,
      errorInfo.componentStack
    );
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="bg-gray-900 border border-gray-700 rounded-md h-full flex flex-col items-center justify-center gap-3 p-4">
          <AlertTriangle className="h-6 w-6 text-red-400" />
          <div className="text-center">
            <p className="text-sm text-red-400 font-medium">Widget crashed</p>
            <p className="text-xs text-gray-500 mt-1 max-w-xs truncate">
              {this.state.error?.message || "Unknown error"}
            </p>
          </div>
          <button
            onClick={this.handleRetry}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-300 bg-gray-800 border border-gray-600 rounded hover:bg-gray-700 transition-colors"
          >
            <RotateCcw className="h-3 w-3" />
            Retry
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
