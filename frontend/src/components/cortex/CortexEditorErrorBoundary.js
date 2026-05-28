import React from 'react';
import { Button } from '@/components/ui/button';
import { AlertTriangle, RefreshCw } from 'lucide-react';

// Last-resort guard around the YAML editor + quick-fields. The page can still
// connect to ephs and list/delete agents even if the editor blows up. We log
// the real error to the console and offer the user a "Reset editor" button
// that re-mounts the boundary.
export class CortexEditorErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { err: null };
  }
  static getDerivedStateFromError(err) {
    return { err };
  }
  componentDidCatch(err, info) {
    console.error('[CortexEditorErrorBoundary]', err, info);
  }
  reset = () => this.setState({ err: null });
  render() {
    if (!this.state.err) return this.props.children;
    return (
      <div
        className="flex flex-col items-center justify-center h-full p-6 gap-3 text-center"
        data-testid="cortex-editor-error-boundary"
      >
        <AlertTriangle className="w-8 h-8 text-amber-500" />
        <p className="text-sm font-semibold">Editor crashed</p>
        <p className="text-xs text-muted-foreground max-w-md">
          The agent editor hit a runtime error.
          The eph + agent list still work — pick another agent, or try resetting the editor.
        </p>
        <p className="text-[10px] font-mono text-muted-foreground max-w-md break-words">
          {String(this.state.err?.message || this.state.err || 'unknown')}
        </p>
        <Button size="sm" variant="outline" className="gap-1.5" onClick={this.reset} data-testid="cortex-editor-reset-btn">
          <RefreshCw className="w-3.5 h-3.5" />
          Reset editor
        </Button>
      </div>
    );
  }
}

export default CortexEditorErrorBoundary;
