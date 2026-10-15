import { Component } from 'react';
import type { ReactNode } from 'react';
import { Dialog } from './components';
export class WorkspaceBoundary extends Component<{ children: ReactNode; onClose: () => void }, { error: string }> {
  state = { error: '' };
  static getDerivedStateFromError(error: unknown) { return { error: String(error instanceof Error ? error.message : error) }; }
  render() {
    return this.state.error ? <Dialog title="Workspace could not open" onClose={this.props.onClose}><div className="suite-body"><p className="notice">{this.state.error}</p><p className="muted small">Your saved library and loadouts remain available. Reload the app to retry loading this workspace.</p><button className="button" onClick={() => window.location.reload()}>Reload app</button></div></Dialog> : this.props.children;
  }
}
