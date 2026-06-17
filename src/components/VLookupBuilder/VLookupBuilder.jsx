import { useEffect, useMemo, useRef, useState } from "react";
import Editor from "@monaco-editor/react";
import "./VLookupBuilder.css";
import { buildWhereClause } from "../QueryBuilder/whereUtils";
import { useVLookupSql } from "./useVLookupSql";
import CommonModal from "../CommonModal/CommonModal";
import { AgGridReact } from "ag-grid-react";
import { ModuleRegistry, AllCommunityModule } from "ag-grid-community";
import "ag-grid-community/styles/ag-grid.css";
import "ag-grid-community/styles/ag-theme-alpine.css";
import { exportExcel } from "../../utils/exportExcel";
import { useDroppable } from "@dnd-kit/core";

ModuleRegistry.registerModules([AllCommunityModule]);

// ─── IndexedDB helpers ────────────────────────────────────────────────────────

const DB_NAME    = "VLookupWorkspaceDB";
const STORE_NAME = "cached_grids";

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 2);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
    };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror   = (e) => reject(e.target.error);
  });
}

async function setCachedGrid(key, data) {
  try {
    const db = await openDB();
    return new Promise((res, rej) => {
      const tx  = db.transaction(STORE_NAME, "readwrite");
      const req = tx.objectStore(STORE_NAME).put(data, key);
      req.onsuccess = () => res();
      req.onerror   = () => rej(req.error);
    });
  } catch (err) { console.error("IDB write failed:", err); }
}

async function getCachedGrid(key) {
  try {
    const db = await openDB();
    return new Promise((res, rej) => {
      const tx  = db.transaction(STORE_NAME, "readonly");
      const req = tx.objectStore(STORE_NAME).get(key);
      req.onsuccess = () => res(req.result);
      req.onerror   = () => rej(req.error);
    });
  } catch { return null; }
}

async function clearCachedGrid(key) {
  try {
    const db = await openDB();
    return new Promise((res, rej) => {
      const tx  = db.transaction(STORE_NAME, "readwrite");
      const req = tx.objectStore(STORE_NAME).delete(key);
      req.onsuccess = () => res();
      req.onerror   = () => rej(req.error);
    });
  } catch (err) { console.error("IDB clear failed:", err); }
}

function q(id) {
  return `"${String(id).replace(/"/g, '""')}"`;
}

// ─── Drop Zone (matches QueryBuilder style) ───────────────────────────────────

function BuilderDropZone({ id, label, placeholder, value, onRemove, accentColor, badge }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  const items = Array.isArray(value) ? value : [];

  return (
    <div
      ref={setNodeRef}
      className={`vlb-dropzone${isOver ? " vlb-dropzone--over" : ""}${items.length > 0 ? " vlb-dropzone--filled" : ""}`}
    >
      <div className="vlb-dropzone__label" style={{ color: accentColor }}>
        {label}
        {badge && <span className="vlb-dropzone__badge">{badge}</span>}
      </div>

      {items.length > 0 ? (
        <div className="vlb-dropzone__chips">
          {items.map((item, i) => (
            <div key={`${item.table}-${item.column}-${i}`} className="vlb-dropzone__chip">
              <span className="vlb-dropzone__chip-text">{item.table}.{item.column}</span>
              <button type="button" className="vlb-dropzone__chip-clear" onClick={() => onRemove(i)}>×</button>
            </div>
          ))}
        </div>
      ) : (
        <div className="vlb-dropzone__placeholder">{placeholder}</div>
      )}
    </div>
  );
}

// ─── Monaco wrapper ───────────────────────────────────────────────────────────

function SqlEditor({ value, onChange, height = "180px" }) {
  return (
    <Editor
      height={height}
      language="sql"
      value={value}
      onChange={onChange}
      theme="vs-light"
      options={{
        minimap: { enabled: false },
        fontSize: 12,
        lineNumbers: "on",
        scrollBeyondLastLine: false,
        automaticLayout: true,
        wordWrap: "on",
        padding: { top: 10, bottom: 10 },
        folding: false,
        renderValidationDecorations: "off",
        scrollbar: { vertical: "auto", horizontal: "auto" },
      }}
    />
  );
}

// ─── Export progress card ─────────────────────────────────────────────────────

function ExportProgress({ progress, status, fileName }) {
  return (
    <div className="vlb-export-progress">
      <div className="vlb-export-progress__icon">
        <span>CSV</span>
        <div className="vlb-export-progress__icon-bar" />
      </div>
      <div className="vlb-export-progress__meta">
        <div className="vlb-export-progress__name" title={fileName}>{fileName}</div>
        <div className="vlb-export-progress__status">{status}</div>
        <div className="vlb-export-progress__track">
          <div className="vlb-export-progress__fill" style={{ width: `${progress}%` }} />
        </div>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function VLookupBuilder({
  joinType,
  lookupField = [],
  matchField  = [],
  returnField = [],
  setLookupField,
  setMatchField,
  setReturnField,
  onResetFields,
  whereConditions = [],
  setWhereConditions,
  runQuery,
  runMutation,
  persistTableChanges,
  autoExecuteTrigger,
}) {
  const [whereOpen,   setWhereOpen]   = useState(false);
  const [vlookupOpen, setVlookupOpen] = useState(true);
  const [sqlText,     setSqlText]     = useState("");
  const [sqlEdited,   setSqlEdited]   = useState(false);
  const [copied,      setCopied]      = useState(false);
  const [runStatus,   setRunStatus]   = useState(null); // null | "running" | "success" | "error" | "exporting"

  const [hasActiveGrid,  setHasActiveGrid]  = useState(false);
  const [columnOrder,    setColumnOrder]    = useState([]);
  const [totalRowCount,  setTotalRowCount]  = useState(0);
  const [cachedTableName,setCachedTableName]= useState("");
  const [searchText,     setSearchText]     = useState("");
  const gridApiRef   = useRef(null);
  const gridParamsRef = useRef({});

  const [exportProgress,   setExportProgress]   = useState(0);
  const [exportStatusText, setExportStatusText] = useState("");
  const [exportFileName,   setExportFileName]   = useState("");

  const [modalConfig, setModalConfig] = useState({
    open: false, type: "success", title: "", message: "", onConfirm: () => {},
  });

  const safeLookups = Array.isArray(lookupField) ? lookupField : [];
  const safeMatches = Array.isArray(matchField)  ? matchField  : [];
  const safeReturns = Array.isArray(returnField) ? returnField : [];

  const sourceTable = safeLookups[0]?.table  || null;
  const targetTable = safeMatches[0]?.table  || null;
  const sourceKey   = safeLookups[0]?.column || null;
  const targetKey   = safeMatches[0]?.column || null;

  gridParamsRef.current = { searchText, columnOrder, totalRowCount, activeTable: targetTable || cachedTableName, runQuery };

  const OPERATORS = ["=","!=",">","<",">=","<=","LIKE","NOT LIKE","IN","NOT IN","IS NULL","IS NOT NULL"];

  const aliasMap = new Map();
  if (safeLookups[0]) aliasMap.set(safeLookups[0].table, "s");
  if (safeMatches[0]) aliasMap.set(safeMatches[0].table, "m");
  const whereSql = buildWhereClause(whereConditions || [], aliasMap);

  const generatedSql = useVLookupSql({
    mode: "update", joinType, lookupField, matchField, returnField,
    leftJoinField: null, rightJoinField: null, whereSql,
  });

  const displayedSql = sqlEdited ? sqlText : generatedSql;

  // Rehydrate cache
  useEffect(() => {
    async function rehydrate() {
      const cache = await getCachedGrid("last_active_update");
      if (cache?.tableName) {
        setHasActiveGrid(true);
        setCachedTableName(cache.tableName);
        setTotalRowCount(cache.totalRows || 0);
        setColumnOrder(cache.columnOrder || []);
      }
    }
    rehydrate();
  }, []);

  useEffect(() => {
    if (!sqlEdited) setSqlText(generatedSql);
  }, [generatedSql, sqlEdited]);

  const canRunUpdate = sourceTable && targetTable && sourceKey && targetKey && safeReturns.length > 0;

  const gridColumns = useMemo(() => {
    if (!columnOrder.length) return [];
    return columnOrder.map((col) => ({
      field: col, sortable: true, filter: false, resizable: true, flex: 1, minWidth: 110,
    }));
  }, [columnOrder]);

  // ── Export ────────────────────────────────────────────────────────────────
  const handleGridExport = async (type) => {
    const activeTable = targetTable || cachedTableName;
    if (!runQuery || !activeTable) return;
    const totalRows = totalRowCount || 0;
    if (!totalRows) { alert("No records to export."); return; }
    if (type === "excel" && totalRows > 150000) {
      alert(`${totalRows.toLocaleString()} rows — too large for Excel. Use CSV instead.`);
      return;
    }

    const fileBase    = String(activeTable).trim().replace(/[^a-zA-Z0-9_]/gi, "_");
    const currentName = `${fileBase}_full_dataset.${type === "csv" ? "csv" : "xlsx"}`;
    setExportFileName(currentName);
    setRunStatus("exporting");
    setExportProgress(0);
    setExportStatusText("Calculating stream footprint…");

    const CHUNK  = 50000;
    let csvParts = [];
    let xlRows   = [];
    let cols     = columnOrder.length > 0 ? [...columnOrder] : [];
    const esc    = (v) => {
      if (v == null) return "";
      const s = String(v);
      return s.includes('"') || s.includes(',') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const t0 = Date.now();

    try {
      for (let offset = 0; offset < totalRows; offset += CHUNK) {
        const chunk = await runQuery(`SELECT * FROM ${q(activeTable)} LIMIT ${CHUNK} OFFSET ${offset};`);
        if (!chunk.length) break;
        if (!cols.length) cols = Object.keys(chunk[0]);

        if (type === "csv") {
          if (offset === 0) csvParts.push(cols.map(esc).join(",") + "\n");
          let acc = "";
          for (const row of chunk) acc += cols.map((c) => esc(row[c])).join(",") + "\n";
          csvParts.push(acc);
        } else {
          for (const row of chunk) {
            const r = {};
            cols.forEach((c) => { r[c] = row[c] == null ? "" : String(row[c]); });
            xlRows.push(r);
          }
        }

        const done    = Math.min(offset + CHUNK, totalRows);
        const pct     = Math.min(100, Math.round((done / totalRows) * 100));
        const elapsed = (Date.now() - t0) / 1000;
        const bytes   = type === "csv" ? csvParts.reduce((s, p) => s + p.length, 0) : xlRows.length * cols.length * 12;
        const bps     = elapsed > 0 ? bytes / elapsed : 0;
        const mb      = (bytes / 1048576).toFixed(1);
        const totalMb = ((bytes / done) * totalRows / 1048576).toFixed(1);
        const mbs     = (bps / 1048576).toFixed(1);
        const eta     = bps > 0 ? Math.max(0, Math.round(((bytes / done) * totalRows - bytes) / bps)) : 0;
        setExportProgress(pct);
        setExportStatusText(pct < 100 ? `${mbs} MB/s — ${mb} MB of ${totalMb} MB, ${eta}s left` : "Finishing…");
        await new Promise((r) => setTimeout(r, 0));
      }

      await new Promise((r) => setTimeout(r, 150));
      const ts   = new Date().toISOString().slice(0, 10);
      const name = `${fileBase}_full_dataset_${ts}`;

      if (type === "csv") {
        const blob = new Blob(csvParts, { type: "text/csv;charset=utf-8;" });
        csvParts = [];
        const url  = URL.createObjectURL(blob);
        const a    = Object.assign(document.createElement("a"), { href: url, download: `${name}.csv` });
        a.style.visibility = "hidden";
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        URL.revokeObjectURL(url);
      } else {
        exportExcel(xlRows, `${name}.xlsx`);
        xlRows = [];
      }
      setRunStatus("success");
    } catch (err) {
      setRunStatus("error");
      alert(`Export failed: ${err.message || err}`);
    }
  };

  // ── Run update ────────────────────────────────────────────────────────────
  const handleRunUpdate = async (explicitSql) => {
    if (!runQuery || !runMutation || !canRunUpdate) return;
    setRunStatus("running");

    try {
      const sql = explicitSql || displayedSql;
      const queries = sql
        .split("\n").filter((l) => !l.trim().startsWith("--")).join("\n")
        .split(";").map((s) => s.trim()).filter(Boolean);

      for (const qry of queries) await runMutation(qry + ";");

      const sample    = await runQuery(`SELECT * FROM ${q(targetTable)} LIMIT 1;`);
      const nativeOrder = sample.length ? Object.keys(sample[0]) : [];
      const countRes  = await runQuery(`SELECT COUNT(*) as cnt FROM ${q(targetTable)};`);
      const totalRows = countRes?.[0]?.cnt ?? 0;

      setRunStatus("success");
      setColumnOrder(nativeOrder);
      setTotalRowCount(totalRows);
      setCachedTableName(targetTable);
      setHasActiveGrid(true);

      if (gridApiRef.current && datasetDatasource) {
        gridApiRef.current.setGridOption("datasource", datasetDatasource);
        gridApiRef.current.purgeInfiniteCache();
      }

      await setCachedGrid("last_active_update", { tableName: targetTable, columnOrder: nativeOrder, totalRows });
      if (persistTableChanges) await persistTableChanges(targetTable);

      setModalConfig({
        open: true, type: "success",
        title: "Update Successful",
        message: `"${targetTable}" updated. ${Number(totalRows).toLocaleString("en-IN")} rows active.`,
        confirmText: "OK", onConfirm: () => {},
      });
    } catch (err) {
      setRunStatus("error");
      setModalConfig({
        open: true, type: "error", title: "Execution Error",
        message: `Failed: ${err.message || err}`, confirmText: "OK", onConfirm: () => {},
      });
    }
  };

  // ── AG Grid datasource ────────────────────────────────────────────────────
  const datasetDatasource = useMemo(() => ({
    getRows: async (params) => {
      try {
        const { searchText, columnOrder, totalRowCount, activeTable, runQuery } = gridParamsRef.current;
        if (!activeTable || !runQuery) { params.successCallback([], -1); return; }

        const size = params.endRow - params.startRow;
        let where  = "";
        if (searchText.trim() && columnOrder.length) {
          const esc   = searchText.replace(/'/g, "''");
          const conds = columnOrder.map((c) => `CAST(${q(c)} AS VARCHAR) ILIKE '%${esc}%'`).join(" OR ");
          where = `WHERE ${conds}`;
        }

        const rows    = await runQuery(`SELECT * FROM ${q(activeTable)} ${where} LIMIT ${size} OFFSET ${params.startRow};`);
        const lastRow = rows.length < size ? params.startRow + rows.length
          : (!searchText.trim() && totalRowCount > 0 ? totalRowCount : -1);
        params.successCallback(rows, lastRow);
      } catch { params.failCallback(); }
    },
  }), []);

  useEffect(() => { if (gridApiRef.current) gridApiRef.current.refreshInfiniteCache(); }, [searchText]);

  useEffect(() => {
    if (gridApiRef.current && datasetDatasource && hasActiveGrid) {
      gridApiRef.current.setGridOption("datasource", datasetDatasource);
      gridApiRef.current.refreshInfiniteCache();
    }
  }, [datasetDatasource, hasActiveGrid]);

  useEffect(() => {
    if (autoExecuteTrigger > 0 && canRunUpdate) handleRunUpdate(generatedSql);
  }, [autoExecuteTrigger, canRunUpdate]);

  const removeAt = (setter) => (i) =>
    setter((prev) => (Array.isArray(prev) ? prev.filter((_, idx) => idx !== i) : []));

  const vlookupCount = [safeLookups, safeMatches, safeReturns].filter((a) => a.length > 0).length;

  const handleCopySql = async () => {
    try {
      await navigator.clipboard.writeText(displayedSql);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch { /* denied */ }
  };

  const handleResetSql = () => {
    setSqlText(generatedSql);
    setSqlEdited(false);
  };

  return (
    <div className="vlb query-builder">
      <CommonModal
        open={modalConfig.open}
        type={modalConfig.type}
        title={modalConfig.title}
        message={modalConfig.message}
        confirmText={modalConfig.confirmText}
        showCancel={false}
        onClose={() => setModalConfig((p) => ({ ...p, open: false }))}
        onConfirm={modalConfig.onConfirm}
      />

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="vlb__header">
        <div>
          <h3>Update Master Builder</h3>
          <p className="vlb__subtitle">
            Drag columns from the sidebar to perform automated schema corrections against target tables.
          </p>
        </div>
        <div className="vlb__header-actions">
          <button
            type="button"
            className="vlb-btn vlb-btn--secondary"
            onClick={async () => {
              onResetFields();
              setRunStatus(null);
              setSqlEdited(false);
              setHasActiveGrid(false);
              setColumnOrder([]);
              setTotalRowCount(0);
              setSearchText("");
              setCachedTableName("");
              await clearCachedGrid("last_active_update");
            }}
          >
            Clear Fields
          </button>
        </div>
      </div>

      <div className="vlb__body vlb-main-layout">
        <div className="vlb-sidebar-controls">
          {/* ── Drop Zones — JOIN (narrow left) + UPDATE ZONES (wide right) ───── */}
          <div className="vlb__zones">

        {/* JOIN column */}
        <div className="vlb__zones-col vlb__zones-col--join">
          <div className="vlb__zones-section-label">Join</div>
          <BuilderDropZone
            id="vlookup-lookup"
            label="Source Key"
            placeholder="Key from source table"
            value={safeLookups.slice(0, 1)}
            onRemove={removeAt(setLookupField)}
            accentColor="#2563eb"
            badge="1 field"
          />
          <BuilderDropZone
            id="vlookup-match"
            label="Target Key"
            placeholder="Matching key in master table"
            value={safeMatches.slice(0, 1)}
            onRemove={removeAt(setMatchField)}
            accentColor="#9333ea"
            badge="1 field"
          />
        </div>

        {/* UPDATE ZONES column — 2×2 grid */}
        <div className="vlb__zones-col vlb__zones-col--update">
          <div className="vlb__zones-section-label">Update Zones</div>
          <div className="vlb__zones-update-grid">
            <BuilderDropZone
              id="vlookup-return"
              label="Update Columns"
              placeholder="Column(s) to write into master"
              value={safeReturns}
              onRemove={removeAt(setReturnField)}
              accentColor="#059669"
              badge="multi"
            />
            <BuilderDropZone
              id="vlookup-where-zone"
              label="Filter Zone"
              placeholder="Drop filter columns"
              value={whereConditions.filter((c) => c.table && c.column).map((c) => ({ table: c.table, column: c.column }))}
              onRemove={(i) =>
                setWhereConditions((prev) => {
                  const filled = prev.filter((c) => c.table && c.column);
                  const target = filled[i];
                  return prev.map((c) =>
                    c === target ? { ...c, table: null, column: null } : c
                  );
                })
              }
              accentColor="#f97316"
              badge="multi"
            />
            {/* WHERE condition rows — accordion inside the update col */}
            <div className="vlb__where-block" style={{ gridColumn: "1 / -1" }}>
              <button
                type="button"
                className="vlb__where-toggle"
                onClick={() => setWhereOpen((v) => !v)}
              >
                <span>{whereOpen ? "▼" : "▶"} WHERE conditions</span>
                <span className="vlb__where-badge">{whereConditions.length}</span>
              </button>
              {whereOpen && (
                <div className="vlb__where-body">
                  {whereConditions.length > 0 ? (
                    whereConditions.map((cond, idx) => (
                      <div key={`where-${idx}`} className="vlb-where-row">
                        <div className="vlb-where-row__col vlb-where-row__col--drop">
                          <BuilderDropZone
                            id={`vlookup-where-${idx}`}
                            label="Column"
                            placeholder="Drop column"
                            value={cond.table && cond.column ? [{ table: cond.table, column: cond.column }] : []}
                            onRemove={() =>
                              setWhereConditions((prev) => {
                                const n = [...prev];
                                n[idx] = { ...n[idx], table: null, column: null };
                                return n;
                              })
                            }
                            accentColor="#f97316"
                          />
                        </div>
                        <div className="vlb-where-row__col">
                          <label>Operator</label>
                          <select
                            value={cond.operator || "="}
                            onChange={(e) =>
                              setWhereConditions((prev) => {
                                const n = [...prev]; n[idx] = { ...n[idx], operator: e.target.value }; return n;
                              })
                            }
                          >
                            {OPERATORS.map((op) => <option key={op}>{op}</option>)}
                          </select>
                        </div>
                        <div className="vlb-where-row__col">
                          <label>Value</label>
                          <input
                            type="text"
                            value={cond.value || ""}
                            disabled={["IS NULL","IS NOT NULL"].includes((cond.operator || "").toUpperCase())}
                            onChange={(e) =>
                              setWhereConditions((prev) => {
                                const n = [...prev]; n[idx] = { ...n[idx], value: e.target.value }; return n;
                              })
                            }
                          />
                        </div>
                        <div className="vlb-where-row__col">
                          <label>Connector</label>
                          <select
                            value={cond.connector || "AND"}
                            onChange={(e) =>
                              setWhereConditions((prev) => {
                                const n = [...prev]; n[idx] = { ...n[idx], connector: e.target.value }; return n;
                              })
                            }
                          >
                            <option>AND</option>
                            <option>OR</option>
                          </select>
                        </div>
                        <div className="vlb-where-row__actions">
                          <button
                            type="button"
                            onClick={() =>
                              setWhereConditions((prev) => {
                                const n = [...prev]; n.splice(idx + 1, 0, { ...n[idx] }); return n;
                              })
                            }
                          >⎘</button>
                          <button
                            type="button"
                            onClick={() =>
                              setWhereConditions((prev) => prev.filter((_, i) => i !== idx))
                            }
                          >✕</button>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="vlb-where-empty">No conditions — click + Add to begin.</div>
                  )}
                  <div className="vlb__where-controls">
                    <button
                      type="button"
                      className="vlb-btn vlb-btn--secondary"
                      onClick={() =>
                        setWhereConditions((prev) => [
                          ...(prev || []),
                          { connector: "AND", table: null, column: null, operator: "=", value: "" },
                        ])
                      }
                    >
                      + Add condition
                    </button>
                    <button
                      type="button"
                      className="vlb-btn vlb-btn--secondary"
                      onClick={() => setWhereConditions([])}
                    >
                      Clear all
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
          </div>
        </div>

        <div className="vlb-editor-preview-panel">
          {/* ── Monaco SQL card ───────────────────────────────────────────────── */}
          <div className="vlb__sql-card">
            <div className="vlb-cell-bar">
              <div className="vlb-cell-bar__label">
                <span className="vlb-cell-bar__sql">SQL</span>
                <span className="vlb-cell-bar__name">cell-vlookup</span>
                {sqlEdited && <span className="vlb-edited-badge">edited</span>}
              </div>
              <div className="vlb-cell-bar__actions">
                <button
                  type="button"
                  className="vlb-btn vlb-btn--secondary"
                  onClick={handleCopySql}
                  disabled={!displayedSql.trim()}
                >
                  {copied ? "Copied ✓" : "Copy"}
                </button>
                <button
                  type="button"
                  className="vlb-btn vlb-btn--secondary"
                  onClick={handleResetSql}
                  disabled={!sqlEdited}
                >
                  Reset
                </button>
                <button
                  type="button"
                  className="vlb-run-btn"
                  onClick={() => handleRunUpdate()}
                  disabled={!canRunUpdate || runStatus === "running" || runStatus === "exporting"}
                >
                  {runStatus === "running" ? "⏳ Running…" : "▶ Run"}
                </button>
              </div>
            </div>
            <div className="vlb__monaco-wrapper">
              <SqlEditor
                value={displayedSql}
                onChange={(val) => { setSqlText(val ?? ""); setSqlEdited(true); }}
              />
            </div>
          </div>

          {/* ── Results card ──────────────────────────────────────────────────── */}
          {hasActiveGrid && columnOrder.length > 0 && (
            <div className="vlb__results-card">
              {/* Export progress */}
              {runStatus === "exporting" && (
                <ExportProgress
                  progress={exportProgress}
                  status={exportStatusText}
                  fileName={exportFileName}
                />
              )}

              {/* Toolbar */}
              <div className="vlb__results-toolbar">
                <div className="vlb__results-toolbar-left">
                  <span className="vlb__row-count">
                    Live DB View: <strong>{targetTable || cachedTableName}</strong>{" "}
                    ({totalRowCount.toLocaleString("en-IN")} records)
                  </span>
                  <div className="vlb__search-wrapper">
                    <svg className="vlb__search-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
                    </svg>
                    <input
                      type="text"
                      className="vlb__search-input"
                      placeholder="Search all columns…"
                      value={searchText}
                      onChange={(e) => setSearchText(e.target.value)}
                    />
                  </div>
                </div>
                <div className="vlb__results-toolbar-right">
                  <button
                    type="button"
                    className="vlb-btn vlb-btn--secondary"
                    onClick={() => handleGridExport("csv")}
                    disabled={runStatus === "exporting"}
                  >
                    ⬇ CSV
                  </button>
                  <button
                    type="button"
                    className="vlb-btn vlb-btn--secondary"
                    onClick={() => handleGridExport("excel")}
                    disabled={runStatus === "exporting" || totalRowCount > 150000}
                  >
                    ⬇ Excel
                  </button>
                </div>
              </div>

              {/* AG Grid */}
              <div className="ag-theme-alpine vlb__ag-grid">
                <AgGridReact
                  columnDefs={gridColumns}
                  rowModelType="infinite"
                  cacheBlockSize={100}
                  maxConcurrentDatasourceRequests={2}
                  infiniteInitialRowCount={1}
                  animateRows
                  onGridReady={(params) => {
                    gridApiRef.current = params.api;
                    if (datasetDatasource) params.api.setGridOption("datasource", datasetDatasource);
                  }}
                  defaultColDef={{ resizable: true, flex: 1, minWidth: 100, sortable: false }}
                />
              </div>
            </div>
          )}

          {/* ── Empty state ───────────────────────────────────────────────────── */}
          {!canRunUpdate && !hasActiveGrid && (
            <div className="vlb__empty">
              <p>Drop source key, target key, and at least one update column above, then click <strong>▶ Run</strong>.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}