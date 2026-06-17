import { useCallback, useState, useEffect, useRef } from "react";
import { DndContext } from "@dnd-kit/core";
import Header from "../components/Header/Header";
import Sidebar from "../components/Sidebar/Sidebar";
import QueryBuilder from "../components/QueryBuilder/QueryBuilder";
import SqlCell from "../components/SqlCell/SqlCell";
import { useNotebook } from "../context/useNotebook";
import VLookupBuilder from "../components/VLookupBuilder/VLookupBuilder";
import LandingPage from "../components/LandingPage/LandingPage";
import WorkspaceLoader from "../components/WorkspaceLoader/WorkspaceLoader"; 
import "./Notebook.css";

export default function Notebook() {
  const {
    dbReady,
    dbError,
    files,
    tables,
    uploadingFiles,
    cells,
    handleUpload,
    executeQuery,
    addCell,
    deleteCell,
    duplicateCell,
    updateCellQuery,
    deleteFile,
    deleteTable,
    clearAll,
    updateCellError,
    recordHistory,
    runMutation,
    persistTableChanges 
  } = useNotebook();

  const [mode, setMode] = useState("pivot");
  const [activeTab, setActiveTab] = useState("home");
  const [joinType, setJoinType] = useState("LEFT JOIN");
  const [autoExecuteSignal, setAutoExecuteSignal] = useState(0);
  const isSwappingRef = useRef(false);
  const justUploadedRef = useRef(false);
  const isInitializingRef = useRef(true); 
  const [leftJoinField, setLeftJoinField] = useState(null);
  const [rightJoinField, setRightJoinField] = useState(null);
  const [rowFields, setRowFields] = useState([]);
  const [columnFields, setColumnFields] = useState([]);
  const [valueFields, setValueFields] = useState([]);
  const [filterFields, setFilterFields] = useState([]);
  const [lookupField, setLookupField] = useState([]);
  const [matchField, setMatchField] = useState([]);
  const [returnField, setReturnField] = useState([]);

  const [whereConditions, setWhereConditions] = useState([
    {
      connector: "AND",
      table: null,
      column: null,
      alias: null,
      operator: "=",
      value: "",
    },
  ]);

  // ─── STABLE MEMOIZED ALIAS BRIDGES ─────────────────────────────────────────
  const parseFieldId = useCallback((id) => {
    if (typeof id !== "string") return null;
    const [table, ...columnParts] = id.split("|");
    if (!table || columnParts.length === 0) return null;
    return { table, column: columnParts.join("|") };
  }, []);

  const addPivotField = useCallback((field, setter) => {
    if (!field) return;
    setter((prev) => {
      if (
        prev.some(
          (item) => item.table === field.table && item.column === field.column,
        )
      )
        return prev;
      return [...prev, field];
    });
  }, []);

  const addValueField = useCallback((field) => {
    if (!field) return;
    setValueFields((prev) => {
      if (
        prev.some(
          (item) => item.table === field.table && item.column === field.column,
        )
      )
        return prev;
      return [...prev, { ...field, agg: "SUM" }];
    });
  }, []);

  const addVLookupField = useCallback((field, setter) => {
    if (!field) return;
    setter((prev) => {
      const arr = Array.isArray(prev) ? prev : [];
      const exists = arr.some(
        (item) => item.table === field.table && item.column === field.column,
      );
      return exists ? arr : [...arr, field];
    });
  }, []);

  // ─── STABLE MEMOIZED QUERY RUNNER REFERENCE ────────────────────────────────
  const handleVLookupQuery = useCallback((sqlText) => {
    return executeQuery(null, sqlText);
  }, [executeQuery]);

  useEffect(() => {
    const timer = setTimeout(() => {
      isInitializingRef.current = false;
    }, 800);
    return () => clearTimeout(timer);
  }, []);

  // ─── ACTIVE METADATA DATA VALIDATION SYSTEM ────────────────────────────────
  useEffect(() => {
    if (isInitializingRef.current) return;
    if (isSwappingRef.current) return;
    if (!dbReady || (lookupField.length === 0 && matchField.length === 0)) return;
    if (tables.length === 0) return;

    if (justUploadedRef.current) {
      justUploadedRef.current = false;
      return;
    }

    const activeTableNames = tables.map((t) => (typeof t === "string" ? t : t.name));
    const selectedSourceTable = lookupField[0]?.table;
    const selectedTargetTable = matchField[0]?.table;

    let mismatchDetected = false;

    if (selectedSourceTable && !activeTableNames.includes(selectedSourceTable)) {
      mismatchDetected = true;
    }
    if (selectedTargetTable && !activeTableNames.includes(selectedTargetTable)) {
      mismatchDetected = true;
    }

    if (mismatchDetected) {
      resetBuilder();
    }
  }, [tables, dbReady, lookupField, matchField]);

  const handleInterceptedUpload = async (fileSnapshot, options = {}) => {
    if (handleUpload) {
      isSwappingRef.current = true;
      justUploadedRef.current = true;

      await handleUpload(fileSnapshot);

      if (options?.isAutoUpdateOverride) {
        setAutoExecuteSignal((prev) => prev + 1);
      }
      isSwappingRef.current = false;
    }
  };

  const handleDrop = useCallback(
    (event) => {
      const { active, over } = event;
      if (!active || !over) return;

      const field = parseFieldId(active.id);
      if (!field) return;

      switch (over.id) {
        case "join-left":
          setLeftJoinField(field);
          break;
        case "join-right":
          setRightJoinField(field);
          break;
        case "vlookup-lookup":
          setLookupField([field]);
          break;
        case "vlookup-match":
          setMatchField([field]);
          break;
        case "vlookup-return":
          addVLookupField(field, setReturnField);
          break;
        
        // ── 🎯 FIXED: Explicit interception case for the parent filter zone container drop ──
        case "vlookup-where-zone":
          setWhereConditions((prev) => {
            const emptyIndex = prev.findIndex((c) => !c.table && !c.column);
            if (emptyIndex !== -1) {
              const next = [...prev];
              next[emptyIndex] = { ...next[emptyIndex], table: field.table, column: field.column };
              return next;
            }
            return [...prev, { connector: "AND", table: field.table, column: field.column, operator: "=", value: "" }];
          });
          break;

        case "pivot-rows":
          addPivotField(field, setRowFields);
          break;
        case "pivot-columns":
          addPivotField(field, setColumnFields);
          break;
        case "pivot-values":
          addValueField(field);
          break;
        case "pivot-filters":
          addPivotField(field, setFilterFields);
          break;
        default:
          if (over.id && String(over.id).startsWith("vlookup-where-")) {
            const parts = String(over.id).split("-");
            const idx = parseInt(parts[2], 10);
            if (!Number.isNaN(idx)) {
              setWhereConditions((prev) => {
                const next = prev.slice();
                const existing = next[idx] || {
                  connector: "AND",
                  table: null,
                  column: null,
                  alias: null,
                  operator: "=",
                  value: "",
                };
                next[idx] = {
                  ...existing,
                  table: field.table,
                  column: field.column,
                };
                return next;
              });
            }
          }
          break;
      }
    },
    [parseFieldId, addPivotField, addValueField, addVLookupField],
  );

  const resetBuilder = () => {
    setLeftJoinField(null);
    setRightJoinField(null);
    setRowFields([]);
    setColumnFields([]);
    setValueFields([]);
    setFilterFields([]);
    setLookupField([]);
    setMatchField([]);
    setReturnField([]);
    setMode("join");
    setJoinType("LEFT JOIN");
    setWhereConditions([
      {
        connector: "AND",
        table: null,
        column: null,
        alias: null,
        operator: "=",
        value: "",
      },
    ]);
    
    indexedDB.open("VLookupWorkspaceDB", 2).onsuccess = (e) => {
      const db = e.target.result;
      if (db.objectStoreNames.contains("cached_grids")) {
        const tx = db.transaction("cached_grids", "readwrite");
        tx.objectStore("cached_grids").delete("vlookup_field_config");
      }
    };
  };

  return (
    <DndContext onDragEnd={handleDrop}>
      <div className="notebook-layout">
        <Sidebar
          files={files}
          tables={tables}
          targetTableName={matchField[0]?.table}
          cells={cells}
          dbReady={dbReady}
          uploadingFiles={uploadingFiles}
          onUpload={handleInterceptedUpload}
          onTableClick={(tableName) => {
            if (activeTab === "home") setActiveTab("sql");
            addCell(`SELECT * \nFROM "${tableName}"\nLIMIT 100`);
          }}
          onDeleteFile={deleteFile}
          onDeleteTable={deleteTable}
          onClearWorkspace={clearAll}
        />
        <div className="main-content">
          <Header
            dbReady={dbReady}
            dbError={dbError}
            activeTab={activeTab}
            setActiveTab={setActiveTab}
            addCell={() => {
              if (activeTab === "home") setActiveTab("sql");
              addCell("");
            }}
          />

          {!dbReady ? (
            <WorkspaceLoader dbError={dbError} />
          ) : (
            <>
              {activeTab === "home" && (
                <LandingPage dbReady={dbReady} />
              )}

              {activeTab === "pivot" && (
                <QueryBuilder
                  tables={tables}
                  dbReady={dbReady}
                  mode={mode}
                  setMode={setMode}
                  joinType={joinType}
                  setJoinType={setJoinType}
                  leftJoinField={leftJoinField}
                  rightJoinField={rightJoinField}
                  setLeftJoinField={setLeftJoinField}
                  setRightJoinField={setRightJoinField}
                  rowFields={rowFields}
                  setRowFields={setRowFields}
                  columnFields={columnFields}
                  setColumnFields={setColumnFields}
                  valueFields={valueFields}
                  setValueFields={setValueFields}
                  filterFields={filterFields}
                  setFilterFields={setFilterFields}
                  runQuery={(sql) => executeQuery(null, sql)}
                  onResetFields={resetBuilder}
                  onClearJoin={() => {
                    setLeftJoinField(null);
                    setRightJoinField(null);
                  }}
                />
              )}

              {activeTab === "sql" && (
                <div className="sql-notebook-view">
                  <div className="workspace-panel-header">
                    <h2>SQL Notebook</h2>
                    <p>Run worksheet-style SQL cells in a single notebook view.</p>
                  </div>
                  <div className="cells-container">
                    {cells.length === 0 ? (
                      <LandingPage dbReady={dbReady} />
                    ) : (
                      cells.map((cell, index) => (
                        <SqlCell
                          key={cell.id}
                          cell={cell}
                          index={index}
                          onDelete={() => deleteCell(cell.id)}
                          onDuplicate={() => duplicateCell(cell.id)}
                          onQueryChange={(q) => updateCellQuery(cell.id, q)}
                          onRun={executeQuery}
                          onError={(err, elapsed) =>
                            updateCellError(cell.id, err, elapsed)
                          }
                          onRecordHistory={(meta) =>
                            recordHistory({ cellId: cell.id, ...meta })
                          }
                          dbReady={dbReady}
                        />
                      ))
                    )}
                  </div>
                </div>
              )}

              {activeTab === "vlookup" && (
                <VLookupBuilder
                  joinType={joinType}
                  setJoinType={setJoinType}
                  lookupField={lookupField}
                  matchField={matchField}
                  returnField={returnField}
                  setLookupField={setLookupField}
                  setMatchField={setMatchField}
                  setReturnField={setReturnField}
                  leftJoinField={leftJoinField}
                  rightJoinField={rightJoinField}
                  setLeftJoinField={setLeftJoinField}
                  setRightJoinField={setRightJoinField}
                  onResetFields={resetBuilder}
                  onResetAll={clearAll}
                  whereConditions={whereConditions}
                  setWhereConditions={setWhereConditions}
                  runQuery={handleVLookupQuery} 
                  runMutation={runMutation}
                  persistTableChanges={persistTableChanges} 
                  autoExecuteTrigger={autoExecuteSignal}
                />
              )}
            </>
          )}
        </div>
      </div>
    </DndContext>
  );
}