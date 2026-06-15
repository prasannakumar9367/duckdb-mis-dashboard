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
import { exportCSV } from "../../utils/exportCsv";
import { exportExcel } from "../../utils/exportExcel";
import { useDroppable } from "@dnd-kit/core";

ModuleRegistry.registerModules([AllCommunityModule]);
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

// ─── STRING SANITIZATION UTILS ───────────────────────────────────────────────
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
  autoExecuteTrigger, // 🎯 Prop handling tracking updates from hot uploads
}) {
  const [whereOpen, setWhereOpen] = useState(false);
  const [vlookupOpen, setVlookupOpen] = useState(true);

  const [sqlText, setSqlText] = useState("");
  const [sqlEdited, setSqlEdited] = useState(false);
  const [runStatus, setRunStatus] = useState(null);
  const [gridData, setGridData] = useState([]);
  const [columnOrder, setColumnOrder] = useState([]);  
  const [cachedTableName, setCachedTableName] = useState(""); 
  const [searchText, setSearchText] = useState("");
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

  const safeLookups = Array.isArray(lookupField) ? lookupField : [];
  const safeMatches = Array.isArray(matchField) ? matchField : [];
  const safeReturns = Array.isArray(returnField) ? returnField : [];

  const sourceTable = safeLookups[0]?.table || null;
  const targetTable = safeMatches[0]?.table || null;
  const sourceKey = safeLookups[0]?.column || null;
  const targetKey = safeMatches[0]?.column || null;

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

  // ── Rehydration Lifecycle Hook ──
  useEffect(() => {
    async function rehydrateCachedSheet() {
      const cache = await getCachedGrid("last_active_update");
      if (cache && Array.isArray(cache.data) && cache.data.length > 0) {
        setGridData(cache.data);
        setCachedTableName(cache.tableName);
        setColumnOrder(cache.columnOrder || Object.keys(cache.data[0] || {}));
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
      filter: true,
      resizable: true,
      flex: 1,
      minWidth: 110,
    }));
  }, [columnOrder]);

  const handleGridExport = (type) => {
    if (!gridData || gridData.length === 0) return;
    
    const cols = columnOrder.length > 0 ? columnOrder : Object.keys(gridData[0]);
    const formattedRows = gridData.map((row) => {
      const cleanRow = {};
      cols.forEach((col) => {
        const val = row[col];
        cleanRow[col] =
          val === null || val === undefined ? "NULL" : String(val);
      });
      return cleanRow;
    });

    const fileBase = String(targetTable || cachedTableName || "master_results")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_]/gi, "_");
    if (type === "csv") exportCSV(formattedRows, `${fileBase}.csv`);
    if (type === "excel") exportExcel(formattedRows, `${fileBase}.xlsx`);
  };

  const handleRunUpdate = async () => {
    if (!runQuery || !canRunUpdate) return;
    setRunStatus("running");

    try {
      await runQuery(sqlText);

      const masterSelectSql = `SELECT * FROM ${quoteIdentifier(targetTable)};`;
      const fullMasterDataset = await runQuery(masterSelectSql);

      const parsedRows = Array.isArray(fullMasterDataset) ? fullMasterDataset : [];
      const nativeOrder = parsedRows.length > 0 ? Object.keys(parsedRows[0]) : [];

      setRunStatus("success");
      setGridData(parsedRows);
      setColumnOrder(nativeOrder);
      setCachedTableName(targetTable);

      await setCachedGrid("last_active_update", {
        tableName: targetTable,
        data: parsedRows,
        columnOrder: nativeOrder, 
      });

      setModalConfig({
        open: true,
        type: "success",
        title: "Update Successful",
        message: `The table "${targetTable}" has been updated successfully. Click OK to close and view the results.`,
        confirmText: "OK",
        onConfirm: () => {},
      });
    } catch (err) {
      setRunStatus("error");
      setModalConfig({
        open: true,
        type: "error",
        title: "Execution Error",
        message: `Failed to execute the SQL query context statement.`,
        confirmText: "OK",
        onConfirm: () => {},
      });
    }
  };

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
          <h3>VLOOKUP Builder</h3>
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
              setGridData([]);
              setColumnOrder([]);
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
                <BuilderDropZone
                  id="vlookup-lookup"
                  label="SOURCE KEY"
                  placeholder="Key from source table"
                  value={safeLookups.slice(0, 1)}
                  onRemove={removeAt(setLookupField)}
                  accentColor="#1d4ed8"
                  badge="1 field"
                />
                <BuilderDropZone
                  id="vlookup-match"
                  label="TARGET KEY"
                  placeholder="Matching key in master table"
                  value={safeMatches.slice(0, 1)}
                  onRemove={removeAt(setMatchField)}
                  accentColor="#1d4ed8"
                  badge="1 field"
                />
                <BuilderDropZone
                  id="vlookup-return"
                  label="UPDATE COLUMN"
                  placeholder="Column(s) to write into master"
                  value={safeReturns}
                  onRemove={removeAt(setReturnField)}
                  accentColor="#1d4ed8"
                  badge="multi"
                />
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
              <span className="vlb-accordion__badge">
                {whereConditions ? whereConditions.length : 0} items
              </span>
            </button>

            {whereOpen && (
              <div className="vlb-accordion__body">
                {Array.isArray(whereConditions) &&
                whereConditions.length > 0 ? (
                  whereConditions.map((cond, idx) => (
                    <div key={`vwhere-${idx}`} className="vlb-where-row">
                      <BuilderDropZone
                        id={`vlookup-where-${idx}`}
                        label="Filter column"
                        placeholder="Drop column"
                        value={
                          cond.table && cond.column
                            ? [{ table: cond.table, column: cond.column }]
                            : []
                        }
                        onRemove={() =>
                          setWhereConditions((prev) => {
                            const next = prev.slice();
                            next[idx] = {
                              ...(next[idx] || {}),
                              table: null,
                              column: null,
                            };
                            return next;
                          })
                        }
                        accentColor="#f97316"
                      />
                      <div className="vlb-where-row__operator">
                        <label>Operator</label>
                        <select
                          value={cond.operator || "="}
                          onChange={(e) =>
                            setWhereConditions((prev) => {
                              const next = prev.slice();
                              next[idx] = {
                                ...(next[idx] || {}),
                                operator: e.target.value,
                              };
                              return next;
                            })
                          }
                        >
                          {OPERATORS.map((op) => (
                            <option key={op} value={op}>
                              {op}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="vlb-where-row__value">
                        <label>Value</label>
                        <input
                          type="text"
                          value={cond.value || ""}
                          onChange={(e) =>
                            setWhereConditions((prev) => {
                              const next = prev.slice();
                              next[idx] = {
                                ...(next[idx] || {}),
                                value: e.target.value,
                              };
                              return next;
                            })
                          }
                          disabled={["IS NULL", "IS NOT NULL"].includes(
                            (cond.operator || "").toUpperCase(),
                          )}
                        />
                      </div>
                      <div className="vlb-where-row__connector">
                        <label>Connector</label>
                        <select
                          value={cond.connector || "AND"}
                          onChange={(e) =>
                            setWhereConditions((prev) => {
                              const next = prev.slice();
                              next[idx] = {
                                ...(next[idx] || {}),
                                connector: e.target.value,
                              };
                              return next;
                            })
                          }
                        >
                          <option value="AND">AND</option>
                          <option value="OR">OR</option>
                        </select>
                      </div>
                      <div className="vlb-where-row__actions">
                        <button
                          type="button"
                          onClick={() =>
                            setWhereConditions((prev) => {
                              const next = prev.slice();
                              next.splice(idx + 1, 0, { ...(next[idx] || {}) });
                              return next;
                            })
                          }
                        >
                          ⎘
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setWhereConditions((prev) =>
                              prev.filter((_, i) => i !== idx),
                            )
                          }
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="vlb-where-empty">No criteria mapped</div>
                )}
                <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
                  <button
                    className="vlb-btn vlb-btn--primary"
                    type="button"
                    onClick={() =>
                      setWhereConditions((prev) => [
                        ...(prev || []),
                        {
                          connector: "AND",
                          table: null,
                          column: null,
                          alias: null,
                          operator: "=",
                          value: "",
                        },
                      ])
                    }
                  >
                    + Add condition
                  </button>
                  <button
                    className="vlb-btn vlb-btn--secondary"
                    type="button"
                    onClick={() => setWhereConditions([])}
                  >
                    Clear all
                  </button>
                </div>
              </div>
            )}
          </section>
        </div>

        <div className="vlb__preview">
          <div
            className="vlb-sql-card-wrapper"
            style={{
              border: "1px solid #e5e5e3",
              borderRadius: "6px",
              overflow: "hidden",
              background: "#fff",
            }}
          >
            <div
              className="vlb-cell-bar"
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "6px 12px",
                background: "#fafafa",
                borderBottom: "1px solid #e5e5e3",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  fontSize: "12px",
                  fontWeight: "500",
                  color: "#2563eb",
                }}
              >
                <span>SQL</span>
                <span style={{ color: "#a3a3a3" }}>cell-vlookup</span>
              </div>

              <button
                type="button"
                onClick={handleRunUpdate}
                disabled={!canRunUpdate || runStatus === "running"}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  height: "24px",
                  padding: "0 10px",
                  background: "#18181b",
                  color: "#fff",
                  border: "none",
                  borderRadius: "4px",
                  fontSize: "11px",
                  fontWeight: "500",
                  cursor: "pointer",
                }}
              >
                <span>{runStatus === "running" ? "⏳" : "▶"}</span>
                <span>Run</span>
              </button>
            </div>

            <div className="vlb-sql-card__editor">
              <CompactSqlEditor
                value={sqlText}
                onChange={(val) => {
                  setSqlText(val ?? "");
                  setSqlEdited(true);
                }}
              />
            </div>
          </div>

          {gridData.length > 0 && (
            <div
              className="vlb-grid-card result-grid-wrapper"
              style={{ marginTop: "16px" }}
            >
              <div
                className="result-toolbar"
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: "8px",
                }}
              >
                <span
                  className="row-count"
                  style={{
                    fontSize: "13px",
                    fontWeight: "600",
                    color: "#1f2937",
                  }}
                >
                  Updated Result: <strong>{targetTable || cachedTableName}</strong> (
                  {gridData.length.toLocaleString()} rows synced)
                </span>
                <div className="export-btns">
                  <button
                    className="vlb-btn vlb-btn--secondary"
                    style={{
                      padding: "4px 8px",
                      fontSize: "12px",
                      marginRight: "6px",
                    }}
                    onClick={() => handleGridExport("csv")}
                  >
                    ⬇ CSV
                  </button>
                  <button
                    className="vlb-btn vlb-btn--secondary"
                    style={{ padding: "4px 8px", fontSize: "12px" }}
                    onClick={() => handleGridExport("excel")}
                  >
                    ⬇ Excel
                  </button>
                </div>
              </div>
              <div className="ag-theme-alpine result-grid-content vlb-ag-grid-container">
                <AgGridReact
                  rowData={gridData}
                  columnDefs={gridColumns}
                  defaultColDef={{ resizable: true, flex: 1, minWidth: 100 }}
                  animateRows={true}
                  pagination={true}
                  paginationPageSize={25}
                  domLayout="autoHeight"
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}