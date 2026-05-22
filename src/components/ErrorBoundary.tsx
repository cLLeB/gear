import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = {
  children: ReactNode;
  /** Compact fallback for panels/sidebars; full-screen otherwise. */
  compact?: boolean;
  label?: string;
};

type State = {
  error: Error | null;
};

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`[Gear] Uncaught error in ${this.props.label ?? "component"}:`, error, info);
  }

  render(): ReactNode {
    const { error } = this.state;
    const { children, compact, label } = this.props;

    if (!error) return children;

    if (compact) {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center">
          <p className="text-[12px] font-medium text-muted-foreground">
            {label ?? "This panel"} encountered an error.
          </p>
          <button
            type="button"
            className="text-[11px] text-muted-foreground underline-offset-2 hover:underline"
            onClick={() => this.setState({ error: null })}
          >
            Try again
          </button>
        </div>
      );
    }

    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
        <p className="text-[14px] font-semibold">Something went wrong</p>
        <p className="max-w-sm text-[12px] text-muted-foreground">
          {error.message || "An unexpected error occurred."}
        </p>
        <button
          type="button"
          className="mt-1 rounded-md border border-border/60 px-3 py-1.5 text-[12px] hover:bg-muted/40 transition-colors"
          onClick={() => this.setState({ error: null })}
        >
          Try again
        </button>
      </div>
    );
  }
}
