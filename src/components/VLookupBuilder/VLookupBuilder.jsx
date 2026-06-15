import { useEffect, useMemo, useRef, useState } from "react";
import Editor from "@monaco-editor/react";
import "./VLookupBuilder.css";
import { buildWhereClause } from "../QueryBuilder/whereUtils";

// Modular Components & Hooks
import { useVLookupSql } from "./useVLookupSql";
import CommonModal from "../CommonModal/CommonModal";

// AG Grid Core Packages
import { AgGridReact } from "ag-grid-react";
import { ModuleRegistry, AllCommunityModule } from "ag-grid-community";
import "ag-grid-community/styles/ag-grid.css";
import "ag-grid-community/styles/ag-theme-alpine.css";
import { exportCSV } from "../../utils/exportCsv";
import { exportExcel } from "../../utils/exportExcel";

// DnD Kit Hook
import { useDroppable } from "@dnd-kit/core";

ModuleRegistry.registerModules([AllCommunityModule]);

// ─── INDEXEDDB CORE MANAGEMENT LIFECYCLE ────────────────────────────────────
const DB_NAME = "VLookupWorkspaceDB";
const STORE_NAME = "cached_grids";

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = (e) => resolve(e.target.result);
    request.onerror = (e) => reject(e.target.error);
  });
}

async function setCachedGrid(key, data) {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const request = store.put(data, key);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } catch (err) {
    console.error("IndexedDB persistence write failed:", err);
  }
}

async function getCachedGrid(key) {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const request = store.get(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } catch (err) {
    console.error("IndexedDB persistence read failed:", err);
    return null;
  }
}

async function clearCachedGrid(key) {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const request = store.delete(key);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } catch (err) {
    console.error("IndexedDB persistence clear failed:", err);
  }
}

function quoteIdentifier(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function toPlainSql(sql) {
  try {
    return JSON.parse(JSON.stringify({ sql })).sql;
  } catch {
    return sql;
  }
}

// ─── STYLED COMPACT DROP ZONE ────────────────────────────────────────────────
function BuilderDropZone({
  id,
  label,
  placeholder,
  value,
  onRemove,
  accentColor,
  badge,
}) {
  const { setNodeRef, isOver } = useDroppable({ id });
  const items = Array.isArray(value) ? value : [];

  return (
    <div
      ref={setNodeRef}
      className={`vlb-dropzone${isOver ? " vlb-dropzone--over" : ""}${
        items.length > 0 ? " vlb-dropzone--filled" : ""
      }`}
    >
      <div className="vlb-dropzone__label" style={{ color: accentColor }}>
        {label}
        {badge && <span className="vlb-dropzone__badge">{badge}</span>}
      </div>

      {items.length > 0 ? (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
          {items.map((item, index) => (
            <div
              key={`vlb-chip-${item.table}-${item.column}-${index}`}
              className="vlb-dropzone__chip"
            >
              <span className="vlb-dropzone__chip-text">
                {item.table}.{item.column}
              </span>
              <button
                type="button"
                className="vlb-dropzone__chip-clear"
                onClick={() => onRemove(index)}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      ) : (
        <div className="vlb-dropzone__placeholder">{placeholder}</div>
      )}
    </div>
  );
}

// ─── REDUCED MONACO CODE WRAPPER ─────────────────────────────────────────────
function CompactSqlEditor({ value, onChange }) {
  const editorRef = useRef(null);
  return (
    <Editor
      height="140px"
      language="sql"
      value={toPlainSql(value)}
      onChange={onChange}
      theme="vs-light"
      onMount={(editor) => {
        editorRef.current = editor;
      }}
      options={{
        minimap: { enabled: false },
        fontSize: 12,
        lineNumbers: "on",
        scrollBeyondLastLine: false,
        automaticLayout: true,
        wordWrap: "on",
        padding: { top: 8, bottom: 8 },
        folding: false,
        renderValidationDecorations: "off",
        scrollbar: { vertical: "auto", horizontal: "auto" },
      }}
    />
  );
}

// ─── MAIN BUILDER EXCLUSIVE COMPONENT ────────────────────────────────────────
export default function VLookupBuilder({
  joinType,
  lookupField = [],
  matchField = [],
  returnField = [],
  setLookupField,
  setMatchField,
  setReturnField,
  onResetFields,
  whereConditions = [],
  setWhereConditions,
  runQuery,
  runMutation,
  autoExecuteTrigger,
}) {
  const [whereOpen, setWhereOpen] = useState(false);
  const [vlookupOpen, setVlookupOpen] = useState(true);

  const [sqlText, setSqlText] = useState("");
  const [sqlEdited, setSqlEdited] = useState(false);
  const [runStatus, setRunStatus] = useState(null);
  
  // ── 🎯 INFINITE SCROLLING CORE STATES ──────────────────────────────────────
  const [hasActiveGrid, setHasActiveGrid] = useState(false);
  const [columnOrder, setColumnOrder] = useState([]);
  const [totalRowCount, setTotalRowCount] = useState(0);
  const [cachedTableName, setCachedTableName] = useState(""); 
  const [searchText, setSearchText] = useState("");
  const gridApiRef = useRef(null);

  // ── 🎯 REF POINTER HOOK CONTAINER TO DECOUPLE RE-RENDER LOOPS ──────────────
  const gridParamsRef = useRef({});

  // ── 🎯 SAFE FIELD EXTRACTIONS (DEFINED EXACTLY ONCE) ───────────────────────
  const safeLookups = Array.isArray(lookupField) ? lookupField : [];
  const safeMatches = Array.isArray(matchField) ? matchField : [];
  const safeReturns = Array.isArray(returnField) ? returnField : [];

  const sourceTable = safeLookups[0]?.table || null;
  const targetTable = safeMatches[0]?.table || null;
  const sourceKey = safeLookups[0]?.column || null;
  const targetKey = safeMatches[0]?.column || null;

  // Dynamically sync arguments on every cycle without creating new closures
  gridParamsRef.current = {
    searchText,
    columnOrder,
    totalRowCount,
    activeTable: targetTable || cachedTableName,
    runQuery
  };

  // Modal Control UI Trigger State
  const [modalConfig, setModalConfig] = useState({
    open: false,
    type: "success",
    title: "",
    message: "",
    onConfirm: () => {},
  });

  const OPERATORS = [
    "=", "!=", ">", "<", ">=", "<=",
    "LIKE", "NOT LIKE", "IN", "NOT IN", "IS NULL", "IS NOT NULL",
  ];

  const aliasMap = new Map();
  if (Array.isArray(lookupField) && lookupField[0])
    aliasMap.set(lookupField[0].table, "s");
  if (Array.isArray(matchField) && matchField[0])
    aliasMap.set(matchField[0].table, "m");

  const whereSql = buildWhereClause(whereConditions || [], aliasMap);

  const generatedSql = useVLookupSql({
    mode: "update",
    joinType,
    lookupField,
    matchField,
    returnField,
    leftJoinField: null,
    rightJoinField: null,
    whereSql,
  });

  // ── 🎯 REHYDRATION LIFECYCLE HOOK ─────────────────────────────────────────
  useEffect(() => {
    async function rehydrateCachedSheet() {
      const cache = await getCachedGrid("last_active_update");
      if (cache && cache.tableName) {
        setHasActiveGrid(true);
        setCachedTableName(cache.tableName);
        setTotalRowCount(cache.totalRows || 0);
        setColumnOrder(cache.columnOrder || []);
      }
    }
    rehydrateCachedSheet();
  }, []);

  useEffect(() => {
    if (!sqlEdited) setSqlText(generatedSql);
  }, [generatedSql, sqlEdited]);

  const canRunUpdate =
    sourceTable &&
    targetTable &&
    sourceKey &&
    targetKey &&
    safeReturns.length > 0;

  const gridColumns = useMemo(() => {
    if (!columnOrder || columnOrder.length === 0) return [];
    return columnOrder.map((col) => ({
      field: col,
      sortable: true,
      filter: false,
      resizable: true,
      flex: 1,
      minWidth: 110,
    }));
  }, [columnOrder]);

const handleGridExport = async (type) => {
    const activeTable = targetTable || cachedTableName;
    if (!runQuery || !activeTable) return;

    try {
      // 1. Enter running state to update button UI indicators
      setRunStatus("running"); 

      const totalRows = totalRowCount && totalRowCount > 0 ? totalRowCount : 0;
      if (totalRows === 0) {
        setRunStatus(null);
        alert("No records found in database to export.");
        return;
      }

      // ── 🎯 CHUNK budget CONFIGURATION ──────────────────────────────────────
      const CHUNK_SIZE = 50000; // Safe memory chunk to ensure WASM malloc never crashes
      let allFormattedRows = [];
      let cols = columnOrder.length > 0 ? columnOrder : [];

      // 2. PROGRESSIVE LOOP STREAM TO EXTRACT OVER 10 LAKH ROWS SAFELY
      for (let offset = 0; offset < totalRows; offset += CHUNK_SIZE) {
        
        // Explicitly supply LIMIT and OFFSET to bypass your global interceptor safely
        const chunkSql = `SELECT * FROM ${quoteIdentifier(activeTable)} LIMIT ${CHUNK_SIZE} OFFSET ${offset};`;
        
        const chunkDataset = await runQuery(chunkSql);
        const parsedChunkRows = Array.isArray(chunkDataset) ? chunkDataset : [];

        if (parsedChunkRows.length === 0) break;

        // Extract metadata header keys on the very first loop pass if uninitialized
        if (cols.length === 0 && parsedChunkRows.length > 0) {
          cols = Object.keys(parsedChunkRows[0] || {});
        }

        // Map values immediately to standard primitives to free up WebAssembly row structures
        for (let i = 0; i < parsedChunkRows.length; i++) {
          const row = parsedChunkRows[i];
          const cleanRow = {};
          
          for (let j = 0; j < cols.length; j++) {
            const col = cols[j];
            const val = row[col];
            // Format dates/numbers safely and translate DB Null pointers to clean spaces
            cleanRow[col] = val === null || val === undefined ? "" : String(val);
          }
          
          allFormattedRows.push(cleanRow);
        }
      }

      if (allFormattedRows.length === 0) {
        setRunStatus(null);
        alert("No records were successfully compiled during dataset download extraction.");
        return;
      }

      // 3. Generate structured file descriptors
      const fileBase = String(activeTable).trim().toLowerCase().replace(/[^a-z0-9_]/gi, "_");
      const timestamp = new Date().toISOString().slice(0, 10);
      const fileName = `${fileBase}_full_dataset_${timestamp}`;

      // 4. Send the consolidated compiled row matrix directly to downloading utilities
      if (type === "csv") {
        exportCSV(allFormattedRows, `${fileName}.csv`);
      } else if (type === "excel") {
        exportExcel(allFormattedRows, `${fileName}.xlsx`);
      }
      
      setRunStatus("success");
    } catch (err) {
      console.error("Advanced stream builder crashed:", err);
      setRunStatus("error");
      alert(`Export processing halted: ${err.message || String(err)}`);
    }
  };
  // ── 🎯 BATCHED MEMORY MUTATION TRANSACTION RUNNER ─────────────────────────
  const handleRunUpdate = async () => {
    if (!runQuery || !runMutation || !canRunUpdate) return;
    setRunStatus("running");

    try {
      const individualQueries = sqlText
        .split(";")
        .map(q => q.trim())
        .filter(q => q.length > 0 && !q.startsWith("--"));

      for (const query of individualQueries) {
        await runMutation(query + ";");
      }

      const sampleSql = `SELECT * FROM ${quoteIdentifier(targetTable)} LIMIT 1;`;
      const sampleResult = await runQuery(sampleSql);
      const nativeOrder = sampleResult.length > 0 ? Object.keys(sampleResult[0]) : [];

      const countSql = `SELECT COUNT(*) as cnt FROM ${quoteIdentifier(targetTable)};`;
      const countResult = await runQuery(countSql);
      const totalRows = countResult && countResult[0] ? (countResult[0].cnt ?? 0) : 0;

      setRunStatus("success");
      setColumnOrder(nativeOrder);
      setTotalRowCount(totalRows);
      setCachedTableName(targetTable);
      setHasActiveGrid(true);

      // Force explicit re-bind of parameters on success view mutation bounds
      if (gridApiRef.current && datasetDatasource) {
        gridApiRef.current.setGridOption("datasource", datasetDatasource);
        gridApiRef.current.refreshInfiniteCache();
      }

      await setCachedGrid("last_active_update", {
        tableName: targetTable,
        columnOrder: nativeOrder,
        totalRows: totalRows
      });

      setModalConfig({
        open: true,
        type: "success",
        title: "Update Successful",
        message: `The table "${targetTable}" has been updated successfully. Total records active: ${Number(totalRows).toLocaleString('en-IN')} rows.`,
        confirmText: "OK",
        onConfirm: () => {},
      });
    } catch (err) {
      console.error("Mutation failed:", err);
      setRunStatus("error");
      setModalConfig({
        open: true,
        type: "error",
        title: "Execution Error",
        message: `Failed to execute transaction: ${err.message || String(err)}`,
        confirmText: "OK",
        onConfirm: () => {},
      });
    }
  };

  // ── 🎯 STATIC DATASOURCE PATTERN (PREVENTS MAXIMUM UPDATE DEPTH ERRORS) ──
  const datasetDatasource = useMemo(() => {
    return {
      getRows: async (params) => {
        try {
          const { searchText, columnOrder, totalRowCount, activeTable, runQuery } = gridParamsRef.current;

          if (!activeTable || !runQuery) {
            params.successCallback([], -1); // Keep cache open if not initialized
            return;
          }

          const start = params.startRow;
          const end = params.endRow;
          const pageSize = end - start;

          let searchClause = "";
          if (searchText.trim() && columnOrder.length > 0) {
            const escapedText = searchText.replace(/'/g, "''");
            const filterConditions = columnOrder
              .map(col => `CAST(${quoteIdentifier(col)} AS VARCHAR) ILIKE '%${escapedText}%'`)
              .join(" OR ");
            searchClause = `WHERE ${filterConditions}`;
          }

          const chunkSql = `SELECT * FROM ${quoteIdentifier(activeTable)} ${searchClause} LIMIT ${pageSize} OFFSET ${start};`;
          const chunkRows = await runQuery(chunkSql);

          let lastRow = -1;
          if (chunkRows.length < pageSize) {
            lastRow = start + chunkRows.length;
          } else if (!searchText.trim()) {
            lastRow = totalRowCount && totalRowCount > 0 ? totalRowCount : -1;
          }

          params.successCallback(chunkRows, lastRow);
        } catch (error) {
          console.error("Grid lazy-load streaming failed:", error);
          params.failCallback();
        }
      }
    };
  }, []);

  // ── 🎯 ASYNC QUICK-FILTER CACHE PURGE HOOK ──────────────────────────────────
  useEffect(() => {
    if (gridApiRef.current) {
      gridApiRef.current.refreshInfiniteCache();
    }
  }, [searchText]);

  // Bind the datasource whenever the table component mounts or updates layout state
  useEffect(() => {
    if (gridApiRef.current && datasetDatasource && hasActiveGrid) {
      gridApiRef.current.setGridOption("datasource", datasetDatasource);
      gridApiRef.current.refreshInfiniteCache();
    }
  }, [datasetDatasource, hasActiveGrid]);

  useEffect(() => {
    if (autoExecuteTrigger && autoExecuteTrigger > 0 && canRunUpdate) {
      handleRunUpdate();
    }
  }, [autoExecuteTrigger]);

  const removeAt = (setter) => (index) =>
    setter((prev) =>
      Array.isArray(prev) ? prev.filter((_, i) => i !== index) : [],
    );

  const vlookupCount = [safeLookups, safeMatches, safeReturns].filter(
    (arr) => arr.length > 0,
  ).length;

  return (
    <div className="vlb">
      <CommonModal
        open={modalConfig.open}
        type={modalConfig.type}
        title={modalConfig.title}
        message={modalConfig.message}
        confirmText={modalConfig.confirmText}
        showCancel={false}
        onClose={() => setModalConfig((prev) => ({ ...prev, open: false }))}
        onConfirm={modalConfig.onConfirm}
      />

      <div className="vlb__header">
        <div>
          <h3>Update Master Builder</h3>
          <p>
            Drag columns from sidebar to perform automated schema corrections
            against target tables.
          </p>
        </div>
        <div className="vlb__meta">
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

      <div className="vlb__body">
        <div className="vlb__controls">
          <section className="vlb-accordion">
            <button
              type="button"
              className={`vlb-accordion__header${vlookupOpen ? " vlb-accordion__header--open" : ""}`}
              onClick={() => setVlookupOpen((v) => !v)}
            >
              <span>{vlookupOpen ? "▼" : "▶"} Update Zones</span>
              <span className="vlb-accordion__badge">{vlookupCount}/3</span>
            </button>

            {vlookupOpen && (
              <div className="vlb-accordion__body">
                <BuilderDropZone id="vlookup-lookup" label="SOURCE KEY" placeholder="Key from source table" value={safeLookups.slice(0, 1)} onRemove={removeAt(setLookupField)} accentColor="#1d4ed8" badge="1 field" />
                <BuilderDropZone id="vlookup-match" label="TARGET KEY" placeholder="Matching key in master table" value={safeMatches.slice(0, 1)} onRemove={removeAt(setMatchField)} accentColor="#7c3aed" badge="1 field" />
                <BuilderDropZone id="vlookup-return" label="UPDATE COLUMN" placeholder="Column(s) to write into master" value={safeReturns} onRemove={removeAt(setReturnField)} accentColor="#059669" badge="multi" />
              </div>
            )}
          </section>

          <section className="vlb-accordion">
            <button
              type="button"
              className={`vlb-accordion__header${whereOpen ? " vlb-accordion__header--open" : ""}`}
              onClick={() => setWhereOpen((v) => !v)}
            >
              <span>{whereOpen ? "▼" : "▶"} WHERE Builder</span>
              <span className="vlb-accordion__badge">{whereConditions ? whereConditions.length : 0} items</span>
            </button>

            {whereOpen && (
              <div className="vlb-accordion__body">
                {Array.isArray(whereConditions) && whereConditions.length > 0 ? (
                  whereConditions.map((cond, idx) => (
                    <div key={`vwhere-${idx}`} className="vlb-where-row">
                      <BuilderDropZone id={`vlookup-where-${idx}`} label="Filter column" placeholder="Drop column" value={cond.table && cond.column ? [{ table: cond.table, column: cond.column }] : []} onRemove={() => setWhereConditions((prev) => { const next = prev.slice(); next[idx] = { ...(next[idx] || {}), table: null, column: null }; return next; })} accentColor="#f97316" />
                      <div className="vlb-where-row__operator">
                        <label>Operator</label>
                        <select value={cond.operator || "="} onChange={(e) => setWhereConditions((prev) => { const next = prev.slice(); next[idx] = { ...(next[idx] || {}), operator: e.target.value }; return next; })}>
                          {OPERATORS.map((op) => <option key={op} value={op}>{op}</option>)}
                        </select>
                      </div>
                      <div className="vlb-where-row__value">
                        <label>Value</label>
                        <input type="text" value={cond.value || ""} onChange={(e) => setWhereConditions((prev) => { const next = prev.slice(); next[idx] = { ...(next[idx] || {}), value: e.target.value }; return next; })} disabled={["IS NULL", "IS NOT NULL"].includes((cond.operator || "").toUpperCase())} />
                      </div>
                      <div className="vlb-where-row__connector">
                        <label>Connector</label>
                        <select value={cond.connector || "AND"} onChange={(e) => setWhereConditions((prev) => { const next = prev.slice(); next[idx] = { ...(next[idx] || {}), connector: e.target.value }; return next; })}>
                          <option value="AND">AND</option>
                          <option value="OR">OR</option>
                        </select>
                      </div>
                      <div className="vlb-where-row__actions">
                        <button type="button" onClick={() => setWhereConditions((prev) => { const next = prev.slice(); next.splice(idx + 1, 0, { ...(next[idx] || {}) }); return next; })}>⎘</button>
                        <button type="button" onClick={() => setWhereConditions((prev) => prev.filter((_, i) => i !== idx))}>✕</button>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="vlb-where-empty">No criteria mapped</div>
                )}
                <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
                  <button className="vlb-btn vlb-btn--primary" type="button" onClick={() => setWhereConditions((prev) => [...(prev || []), { connector: "AND", table: null, column: null, alias: null, operator: "=", value: "" }])}>+ Add condition</button>
                  <button className="vlb-btn vlb-btn--secondary" type="button" onClick={() => setWhereConditions([])}>Clear all</button>
                </div>
              </div>
            )}
          </section>
        </div>

        <div className="vlb__preview">
          <div className="vlb-sql-card-wrapper" style={{ border: "1px solid #e5e5e3", borderRadius: "6px", overflow: "hidden", background: "#fff" }}>
            <div className="vlb-cell-bar" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 12px", background: "#fafafa", borderBottom: "1px solid #e5e5e3" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "12px", fontWeight: "500", color: "#2563eb" }}>
                <span>SQL</span>
                <span style={{ color: "#a3a3a3" }}>cell-vlookup</span>
              </div>

              <button type="button" onClick={handleRunUpdate} disabled={!canRunUpdate || runStatus === "running"} style={{ display: "flex", alignItems: "center", gap: "6px", height: "24px", padding: "0 10px", background: "#18181b", color: "#fff", border: "none", borderRadius: "4px", fontSize: "11px", fontWeight: "500", cursor: "pointer" }}>
                <span>{runStatus === "running" ? "⏳" : "▶"}</span>
                <span>Run</span>
              </button>
            </div>

            <div className="vlb-sql-card__editor">
              <CompactSqlEditor value={sqlText} onChange={(val) => { setSqlText(val ?? ""); setSqlEdited(true); }} />
            </div>
          </div>

          {hasActiveGrid && columnOrder.length > 0 && (
            <div className="vlb-grid-card result-grid-wrapper" style={{ marginTop: "16px" }}>
              <div className="result-toolbar" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px", gap: "12px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "16px", flex: 1 }}>
                  <span className="row-count" style={{ fontSize: "13px", fontWeight: "600", color: "#1f2937", whiteSpace: "nowrap" }}>
                    Live DB View: <strong>{targetTable || cachedTableName}</strong> ({totalRowCount.toLocaleString()} records processed)
                  </span>

                  <div className="global-search-container" style={{ position: "relative", width: "100%", maxWidth: "260px" }}>
                    <input
                      type="text"
                      placeholder="Search all columns..."
                      value={searchText}
                      onChange={(e) => setSearchText(e.target.value)}
                      style={{ width: "100%", height: "26px", padding: "0 10px 0 28px", fontSize: "12px", border: "1px solid #cbd5e1", borderRadius: "4px", outline: "none", boxSizing: "border-box" }}
                    />
                    <span style={{ position: "absolute", left: "9px", top: "6px", display: "flex", alignItems: "center", color: "#9ca3af" }}>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
                      </svg>
                    </span>
                  </div>
                </div>

                <div className="export-btns">
                  <button className="vlb-btn vlb-btn--secondary" style={{ padding: "4px 8px", fontSize: "12px", marginRight: "6px" }} onClick={() => handleGridExport("csv")}>⬇ CSV</button>
                  <button className="vlb-btn vlb-btn--secondary" style={{ padding: "4px 8px", fontSize: "12px" }} onClick={() => handleGridExport("excel")}>⬇ Excel</button>
                </div>
              </div>
              
              <div 
                className="ag-theme-alpine result-grid-content vlb-ag-grid-container"
                style={{ height: "450px", width: "100%" }}
              >
                <AgGridReact
                  columnDefs={gridColumns}
                  rowModelType="infinite" 
                  onGridReady={(params) => {
                    gridApiRef.current = params.api;
                    if (datasetDatasource) {
                      params.api.setGridOption("datasource", datasetDatasource);
                    }
                  }}
                  defaultColDef={{ 
                    resizable: true, 
                    flex: 1, 
                    minWidth: 100,
                    sortable: false 
                  }}
                  cacheBlockSize={100}
                  maxConcurrentDatasourceRequests={2}
                  infiniteInitialRowCount={1}
                  animateRows={true}
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}