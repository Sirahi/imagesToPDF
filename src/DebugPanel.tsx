import type { DebugEntry } from './useDebugLogger';

type DebugPanelProps = {
  debugEnabled: boolean;
  showDebug: boolean;
  onToggle: () => void;
  entries: DebugEntry[];
  onClear: () => void;
  importError: string | null;
};

const DebugPanel = ({
  debugEnabled,
  showDebug,
  onToggle,
  entries,
  onClear,
  importError
}: DebugPanelProps) => (
  <>
    {debugEnabled ? (
      <div className="debug-controls">
        <button type="button" onClick={onToggle}>
          {showDebug ? 'Hide debug' : 'Show debug'}
        </button>
      </div>
    ) : null}
    {importError ? <p className="import-error">{importError}</p> : null}
    {debugEnabled && showDebug ? (
      <section className="debug-panel">
        <div className="debug-header">
          <h2>Debug events</h2>
          <button type="button" onClick={onClear}>Clear</button>
        </div>
        <ul>
          {entries.length ? entries.map((entry) => (
            <li key={entry.id}>
              <code>{entry.timestamp}</code> {entry.message}
            </li>
          )) : <li>No events recorded yet.</li>}
        </ul>
      </section>
    ) : null}
  </>
);

export default DebugPanel;
