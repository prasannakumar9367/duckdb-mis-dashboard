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
  return (
    <Editor
      height="140px"
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
  persistTableChanges, 
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

  // ── 🎯 REAL-TIME CHROMIUM BROWSER STYLE METRIC STATES ─────────────────────
  const [exportProgress, setExportProgress] = useState(0);
  const [exportStatusText, setExportStatusText] = useState("");
  const [exportFileName, setExportFileName] = useState("");

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

  // Sync latest arguments seamlessly inside the tracking ref object box
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

  // ── 🎯 HIGH FREQUENCY CHROMIUM DOWNLOAD ENGINE FOR 14+ LAKH ROWS ───────────
  const handleGridExport = async (type) => {
    const activeTable = targetTable || cachedTableName;
    if (!runQuery || !activeTable) return;

    try {
      const totalRows = totalRowCount && totalRowCount > 0 ? totalRowCount : 0;
      if (totalRows === 0) {
        alert("No records found in database to export.");
        return;
      }

      if (type === "excel" && totalRows > 150000) {
        alert(`The selected dataset contains ${totalRows.toLocaleString()} rows. Client-side Excel compilation will run out of browser heap space. Please use the high-performance "⬇ CSV" option instead.`);
        return;
      }

      const fileBase = String(activeTable).trim().replace(/[^a-zA-Z0-9_]/gi, "_");
      const currentName = `${fileBase}_full_dataset.${type === "csv" ? "csv" : "xlsx"}`;
      
      setExportFileName(currentName);
      setRunStatus("exporting"); 
      setExportProgress(0);
      setExportStatusText("Calculating stream footprint...");

      const CHUNK_SIZE = 50000; 
      let csvContentParts = []; 
      let allExcelRows = []; 
      let cols = columnOrder.length > 0 ? columnOrder : [];

      const escapeCsvCell = (val) => {
        if (val === null || val === undefined) return "";
        const str = String(val);
        if (str.includes('"') || str.includes(',') || str.includes('\n') || str.includes('\r')) {
          return `"${str.replace(/"/g, '""')}"`;
        }
        return str;
      };

      const startTime = Date.now();

      for (let offset = 0; offset < totalRows; offset += CHUNK_SIZE) {
        const chunkSql = `SELECT * FROM ${quoteIdentifier(activeTable)} LIMIT ${CHUNK_SIZE} OFFSET ${offset};`;
        const chunkDataset = await runQuery(chunkSql);
        const parsedChunkRows = Array.isArray(chunkDataset) ? chunkDataset : [];

        if (parsedChunkRows.length === 0) break;

        if (cols.length === 0 && parsedChunkRows.length > 0) {
          cols = Object.keys(parsedChunkRows[0] || {});
        }

        if (type === "csv") {
          if (offset === 0) {
            csvContentParts.push(cols.map(c => escapeCsvCell(c)).join(",") + "\n");
          }

          let chunkTextAccumulator = "";
          for (let i = 0; i < parsedChunkRows.length; i++) {
            const row = parsedChunkRows[i];
            const lineCells = [];
            for (let j = 0; j < cols.length; j++) {
              lineCells.push(escapeCsvCell(row[cols[j]]));
            }
            chunkTextAccumulator += lineCells.join(",") + "\n";
          }
          csvContentParts.push(chunkTextAccumulator);
        } else {
          for (let i = 0; i < parsedChunkRows.length; i++) {
            const row = parsedChunkRows[i];
            const cleanRow = {};
            for (let j = 0; j < cols.length; j++) {
              const col = cols[j];
              cleanRow[col] = row[col] === null || row[col] === undefined ? "" : String(row[col]);
            }
            allExcelRows.push(cleanRow);
          }
        }

        const processedRows = Math.min(offset + CHUNK_SIZE, totalRows);
        const currentPercentage = Math.min(Math.round((processedRows / totalRows) * 100), 100);
        
        const accumulatedBytes = type === "csv" 
          ? csvContentParts.reduce((sum, chunk) => sum + chunk.length, 0)
          : allExcelRows.length * cols.length * 12; 
        
        const elapsedSeconds = (Date.now() - startTime) / 1000;
        const bytesPerSecond = elapsedSeconds > 0 ? accumulatedBytes / elapsedSeconds : 0;
        
        const currentMB = (accumulatedBytes / (1024 * 1024)).toFixed(1);
        const estimatedTotalBytes = (accumulatedBytes / processedRows) * totalRows;
        const totalMB = (estimatedTotalBytes / (1024 * 1024)).toFixed(1);
        const mbPerSecond = (bytesPerSecond / (1024 * 1024)).toFixed(1);
        
        const remainingSeconds = bytesPerSecond > 0 
          ? Math.max(0, Math.round((estimatedTotalBytes - accumulatedBytes) / bytesPerSecond)) 
          : 0;

        setExportProgress(currentPercentage);
        
        if (currentPercentage < 100) {
          setExportStatusText(
            `${mbPerSecond} MB/s - ${currentMB} MB of ${totalMB} MB, ${remainingSeconds} secs left`
          );
        } else {
          setExportStatusText("Finishing download compilation...");
        }

        await new Promise((resolve) => setTimeout(resolve, 0));
      }

      await new Promise((r) => setTimeout(r, 150));
      const timestamp = new Date().toISOString().slice(0, 10);
      const fileName = `${fileBase}_full_dataset_${timestamp}`;

      if (type === "csv") {
        const blob = new Blob(csvContentParts, { type: "text/csv;charset=utf-8;" });
        csvContentParts = []; 

        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.setAttribute("href", url);
        link.setAttribute("download", `${fileName}.csv`);
        link.style.visibility = "hidden";
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
      } else if (type === "excel") {
        exportExcel(allExcelRows, `${fileName}.xlsx`);
        allExcelRows = []; 
      }
      
      setRunStatus("success");
    } catch (err) {
      console.error("Advanced stream builder crashed:", err);
      setRunStatus("error");
      alert(`Export processing halted: ${err.message || String(err)}`);
    }
  };

  // ─── 🎯 REAL TRANSACTION SYNC RUNNER ENGINE ──────────────────────────────
  const handleRunUpdate = async (explicitSql) => {
    if (!runQuery || !runMutation || !canRunUpdate) return;
    setRunStatus("running");

    try {
      // 🎯 FIXED: Direct multi-statement execution prioritizes automated overrides first
      const sqlToRun = explicitSql || sqlText || generatedSql;

      const cleanSql = sqlToRun
        .split("\n")
        .filter(line => !line.trim().startsWith("--"))
        .join("\n");

      const individualQueries = cleanSql
        .split(";")
        .map(q => q.trim())
        .filter(q => q.length > 0);

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

      // Force-purge infinite scroll layouts to instantly fetch updated values cleanly
      if (gridApiRef.current && datasetDatasource) {
        gridApiRef.current.setGridOption("datasource", datasetDatasource);
        gridApiRef.current.purgeInfiniteCache(); 
      }

      await setCachedGrid("last_active_update", {
        tableName: targetTable,
        columnOrder: nativeOrder,
        totalRows: totalRows
      });

      if (persistTableChanges) {
        await persistTableChanges(targetTable);
      }

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

  const datasetDatasource = useMemo(() => {
    return {
      getRows: async (params) => {
        try {
          const { searchText, columnOrder, totalRowCount, activeTable, runQuery } = gridParamsRef.current;

          if (!activeTable || !runQuery) {
            params.successCallback([], -1); 
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

  useEffect(() => {
    if (gridApiRef.current) {
      gridApiRef.current.refreshInfiniteCache();
    }
  }, [searchText]);

  useEffect(() => {
    if (gridApiRef.current && datasetDatasource && hasActiveGrid) {
      gridApiRef.current.setGridOption("datasource", datasetDatasource);
      gridApiRef.current.refreshInfiniteCache();
    }
  }, [datasetDatasource, hasActiveGrid]);

  // ── 🎯 FIXED: Parameter hook link safely handles macro overrides directly without execution lag ──
  useEffect(() => {
    if (autoExecuteTrigger && autoExecuteTrigger > 0 && canRunUpdate) {
      handleRunUpdate(generatedSql);
    }
  }, [autoExecuteTrigger, canRunUpdate, generatedSql]);

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

              <button type="button" onClick={() => handleRunUpdate()} disabled={!canRunUpdate || runStatus === "running" || runStatus === "exporting"} style={{ display: "flex", alignItems: "center", gap: "6px", height: "24px", padding: "0 10px", background: "#18181b", color: "#fff", border: "none", borderRadius: "4px", fontSize: "11px", fontWeight: "500", cursor: "pointer" }}>
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
              
              {runStatus === "exporting" && (
                <div 
                  className="vlb-browser-download-card" 
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "14px",
                    background: "#ffffff", 
                    border: "1px solid #e2e8f0", 
                    borderRadius: "6px", 
                    padding: "14px 16px", 
                    marginBottom: "16px",
                    boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
                    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
                  }}
                >
                  <div 
                    className="download-icon-frame"
                    style={{
                      position: "relative",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      width: "32px",
                      height: "36px",
                      background: "#f1f5f9",
                      border: "1px solid #cbd5e1",
                      borderRadius: "4px",
                      overflow: "hidden"
                    }}
                  >
                    <span style={{ fontSize: "11px", fontWeight: "800", color: "#16a34a" }}>CSV</span>
                    <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: "4px", background: "#16a34a" }} />
                  </div>

                  <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "2px" }}>
                    <div 
                      style={{ 
                        fontSize: "13px", 
                        fontWeight: "500", 
                        color: "#0f172a",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        maxWidth: "520px"
                      }}
                      title={exportFileName}
                    >
                      {exportFileName}
                    </div>

                    <div style={{ fontSize: "12px", color: "#64748b", fontWeight: "400" }}>
                      {exportStatusText}
                    </div>

                    <div style={{ width: "100%", height: "3.5px", background: "#e2e8f0", borderRadius: "2px", overflow: "hidden", marginTop: "4px" }}>
                      <div 
                        style={{ 
                          width: `${exportProgress}%`, 
                          height: "100%", 
                          background: "#2563eb", 
                          transition: "width 0.15s ease-out" 
                        }} 
                      />
                    </div>
                  </div>
                </div>
              )}

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
                  <button 
                    className="vlb-btn vlb-btn--secondary" 
                    style={{ padding: "4px 8px", fontSize: "12px", marginRight: "6px" }} 
                    onClick={() => handleGridExport("csv")}
                    disabled={runStatus === "exporting"}
                  >
                    ⬇ CSV
                  </button>
                  <button 
                    className="vlb-btn vlb-btn--secondary" 
                    style={{ padding: "4px 8px", fontSize: "12px" }} 
                    onClick={() => handleGridExport("excel")}
                    disabled={runStatus === "exporting" || totalRowCount > 150000}
                  >
                    ⬇ Excel
                  </button>
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