import { NativeDialog } from './NativeDialog'
import { reportError } from '../diagnostics'
import { Component, type ErrorInfo, type ReactNode } from 'react'
import { t } from '../preferences'

export class DialogErrorBoundary extends Component<{ children: ReactNode; onClose: () => void }, { error?: Error }> {
  state: { error?: Error } = {}
  static getDerivedStateFromError(error: Error) { return { error } }
  componentDidCatch(error: Error, info: ErrorInfo) { reportError('dialog.render-error', error, info.componentStack || '') }
  render() {
    if (!this.state.error) return this.props.children
    return <NativeDialog className="modal-backdrop" onClose={this.props.onClose}><section className="agent-modal dialog-error-panel" role="alertdialog" aria-label={t('Could not open dialog')}>
      <h2>{t('Could not open dialog')}</h2>
      <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{this.state.error.message}</pre>
      <footer className="edit-contact-footer">
        <button className="secondary-button" onClick={() => { void window.douchat?.openDiagnosticLogs?.().catch(() => {}) }}>{t('Open log folder')}</button>
        <button className="primary-button" onClick={this.props.onClose}>{t('Close')}</button>
      </footer>
    </section></NativeDialog>
  }
}
