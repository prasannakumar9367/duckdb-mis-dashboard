import { useState, useRef } from "react";
import Editor from "@monaco-editor/react";
import ResultGrid from "../ResultGrid/ResultGrid";
import "./SqlCell.css";

export default function SqlCell({
  cell,
  index,
  onDelete,
  onDuplicate,
  onQueryChange,
  onRun,
  onError,
  onRecordHistory,
  dbReady,
}) {
  const [query, setQuery] = useState(cell.query ?? "");
  const [data, setData] = useState([]);
  const [columns, setColumns] = useState([]);
  const [running, setRunning] = useState(false);
  const [ran, setRan] = useState(false);
  const [error, setError] = useState(null);
  const [elapsed, setElapsed] = useState(null);
  const [copyLabel, setCopyLabel] = useState(null);
  const [expanded, setExpanded] = useState(true);
  const editorRef = useRef(null);

  const cellNum = typeof index === "number" ? index + 1 : "?";

  const queryPreview = query.trim().split("\n").find((l) => l.trim()) ?? "";

  const handleQueryChange = (v) => {
    const val = v ?? "";
    setQuery(val);
    onQueryChange && onQueryChange(val);
  };

  const executeQuery = async (e) => {
    e?.stopPropagation();
    if (!dbReady || !query.trim()) return;
    setRunning(true);
    setError(null);
    setData([]);
    setColumns([]);
    const t0 = performance.now();
    try {
      const rows = await onRun(cell.id, query);
      const el = ((performance.now() - t0) / 1000).toFixed(2);
      setElapsed(el);
      if (rows.length > 0) {
        setColumns(Object.keys(rows[0]));
        setData(rows);
      }
      setRan(true);
      setExpanded(true);
      try {
        onRecordHistory &&
          onRecordHistory({ sql: query, rowCount: rows.length, elapsed: el, error: null });
      } catch {
      }
    } catch (e) {
      setError(e.message || String(e));
      setRan(true);
      setExpanded(true);
      const el = ((performance.now() - t0) / 1000).toFixed(2);
      try {
        onError && onError(e.message || String(e), el);
      } catch {
      }
      try {
        onRecordHistory &&
          onRecordHistory({ sql: query, rowCount: 0, elapsed: el, error: e.message || String(e) });
      } catch {
      }
    } finally {
      setRunning(false);
    }
  };

  const handleKeyDown = (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      executeQuery();
    }
  };

  const handleCopy = async (e) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(query);
    } catch {
    }
    setCopyLabel("Copied!");
    setTimeout(() => setCopyLabel(null), 1500);
  };

  const handleDuplicate = (e) => {
    e.stopPropagation();
    onDuplicate && onDuplicate();
  };

  const handleDelete = (e) => {
    e.stopPropagation();
    onDelete && onDelete();
  };

  function inferFileName(query = "") {
    const clean = query.trim();
    if (!clean) return "results";
    const fromMatch = clean.match(/\bFROM\s+(?:ONLY\s+)?["`]?([\w.]+)"?/i);
    if (fromMatch) {
      const tableName = fromMatch[1].toLowerCase();
      if (
        (tableName === "current_month" || tableName === "previous_month") &&
        clean.toUpperCase().includes("JOIN")
      ) {
        const joinMatch = clean.match(/\bJOIN\s+["`]?([\w.]+)"?/i);
        if (joinMatch) return joinMatch[1];
      }
      return fromMatch[1];
    }
    const dmlMatch = clean.match(/\b(?:INTO|UPDATE|TABLE|TRUNCATE)\s+["`]?([\w.]+)"?/i);
    if (dmlMatch) return dmlMatch[1];
    const cleanWords = clean
      .toUpperCase()
      .replace(/[^A-Z0-9\s]/g, "")
      .split(/\s+/)
      .filter(
        (word) =>
          !["SELECT", "WITH", "AS", "SHOW", "DESCRIBE", "PRAGMA", "ALL", "DISTINCT",
            "CURRENT_MONTH", "PREVIOUS_MONTH"].includes(word)
      )
      .slice(0, 3);
    return cleanWords.join("_").toLowerCase() || "query_results";
  }

  const hasResults = !error && data.length > 0;

  return (
    <div className={`sql-cell${expanded ? " sql-cell--expanded" : ""}`} onKeyDown={handleKeyDown}>

      <div className="cell-header" onClick={() => setExpanded((v) => !v)} role="button" tabIndex={0}
        onKeyDown={(e) => e.key === "Enter" && setExpanded((v) => !v)}>

        <div className="cell-label">
          <svg
            className={`cell-chevron${expanded ? " cell-chevron--open" : ""}`}
            width="12" height="12" viewBox="0 0 12 12" fill="none"
            stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"
          >
            <path d="M3 4.5l3 3 3-3" />
          </svg>

          <span className="cell-type-badge">SQL</span>
          <span className="cell-name">cell-{cellNum}</span>

          {!expanded && queryPreview && (
            <span className="cell-preview">{queryPreview}</span>
          )}

          {!expanded && ran && !error && (
            <span className="cell-ran-badge">{data.length.toLocaleString()} rows</span>
          )}
          {!expanded && ran && error && (
            <span className="cell-ran-badge cell-ran-badge--error">Error</span>
          )}
        </div>

        <div className="cell-actions">
          {copyLabel && <span className="copy-toast">{copyLabel}</span>}

          <button className="icon-btn" title="Copy query" onClick={handleCopy}>
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
              <rect x="5" y="5" width="8" height="8" rx="1.5" />
              <path d="M3 11V3h8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>

          <button className="icon-btn" title="Duplicate cell" onClick={handleDuplicate}>
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
              <rect x="2" y="5" width="8" height="8" rx="1.5" />
              <path d="M6 5V3.5A1.5 1.5 0 017.5 2H12a1.5 1.5 0 011.5 1.5v5A1.5 1.5 0 0112 10H10" strokeLinecap="round" />
            </svg>
          </button>

          <button className="icon-btn icon-btn-danger" title="Delete cell" onClick={handleDelete}>
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M3 4h10M6 4V3h4v1M5 4l.5 9h5l.5-9" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>

          <button
            className={`run-btn${running ? " running" : ""}`}
            onClick={executeQuery}
            disabled={running || !dbReady}
            title="Run (Ctrl+Enter)"
          >
            {running ? (
              <><span className="run-spinner" />Running</>
            ) : (
              <>
                <svg viewBox="0 0 10 10" fill="currentColor"><path d="M2 1.5l7 3.5-7 3.5V1.5z" /></svg>
                Run
              </>
            )}
          </button>
        </div>
      </div>

      {expanded && (
        <>
          <div className="cell-editor">
            <Editor
              height="150px"
              language="sql"
              value={query}
              onChange={handleQueryChange}
              onMount={(editor) => { editorRef.current = editor; }}
              options={{
                minimap: { enabled: false },
                fontSize: 12.5,
                lineHeight: 20,
                padding: { top: 8, bottom: 8 },
                scrollBeyondLastLine: false,
                renderLineHighlight: "line",
                overviewRulerBorder: false,
                hideCursorInOverviewRuler: true,
                lineNumbers: "on",
                lineNumbersMinChars: 3,
                glyphMargin: false,
                folding: false,
                fontFamily: "'Fira Code', 'Cascadia Code', 'Consolas', monospace",
                fontLigatures: true,
                scrollbar: { vertical: "hidden", horizontal: "auto" },
                wordWrap: "off",
                tabSize: 2,
                suggestOnTriggerCharacters: true,
              }}
            />
          </div>

          {ran && (
            <div className={`cell-footer${error ? " has-error" : ""}`}>
              {error ? (
                <div className="cell-error">
                  <svg width="12" height="12" viewBox="0 0 16 16" fill="none"
                    stroke="currentColor" strokeWidth="1.5">
                    <circle cx="8" cy="8" r="6" />
                    <path d="M8 5v4M8 11v.5" strokeLinecap="round" />
                  </svg>
                  {error}
                </div>
              ) : (
                <div className="cell-status">
                  <div className="status-dot" />
                  <span>{data.length.toLocaleString()} rows</span>
                  {elapsed && <span className="elapsed">· {elapsed}s</span>}
                </div>
              )}
            </div>
          )}

          {hasResults && (
            <div className="result-section">
              <ResultGrid
                data={data}
                columns={columns}
                fileName={inferFileName(query)}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}