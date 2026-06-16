import {
  createContext,
  useState,
  useEffect,
  useCallback,
  useRef,
} from "react";

import {
  initDB,
  registerAndCreateTable,
  registerBufferAndCreateTable,
  fileNameToTable,
  runQuery,
  runMutation,
  dropTable,
  getTableCSVBuffer,
} from "../services/duckdbService";
import pivotTransform from "../utils/pivotTransform";

import {
  saveCSVBuffer,
  loadAllCSVBuffers,
  saveState,
  loadState,
  clearStorage as clearIndexedDB,
  deleteCSVBuffer,
} from "../services/storageService";

import { saveQueryHistory } from "../services/queryHistoryService";

const DEFAULT_CELLS = [
  { id: 1, query: "", columns: [], error: null, elapsed: null },
];

const NotebookContext = createContext(null);

export function NotebookProvider({ children }) {
  const [dbReady, setDbReady] = useState(false);
  const [dbError, setDbError] = useState(null);
  const [restoring, setRestoring] = useState(true);
  const [uploadingFiles, setUploadingFiles] = useState(false);

  // ── 🎯 REAL-TIME LOCAL BYTE UPLOAD PROGRESS TRACKING STATES ────────────────
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadStatus, setUploadStatus] = useState("");

  const [files, setFiles] = useState([]);    
  const [tables, setTables] = useState([]);    
  const [cells, setCells] = useState(DEFAULT_CELLS);
  const [pivotConfig, setPivotConfig] = useState(null);

  const debounceTimer = useRef(null);

  // ─── WORKSPACE REHYDRATION LIFECYCLE ──────────────────────────────────────
  useEffect(() => {
    async function bootstrap() {
      try {
        await initDB();
      } catch (e) {
        setDbError(e.message);
        setRestoring(false);
        return;
      }

      try {
        const storedCSVs = await loadAllCSVBuffers();
        const restoredTables = [];

        const savedFilesList = await loadState("files"); 
        
        // ── 🎯 FIXED: Map allowed items to standardized table tokens to eliminate case mismatches ──
        const allowedNames = new Set(
          Array.isArray(savedFilesList)
            ? savedFilesList.map((f) => fileNameToTable(typeof f === "string" ? f : f.name))
            : []
        );

        // Re-populate all database memory tables before unlocking the UI interface view
        for (const { name, buffer } of storedCSVs) {
          const tableKey = fileNameToTable(name);
          if (allowedNames.size > 0 && !allowedNames.has(tableKey)) {
            console.warn(`[restore] Skipping orphaned CSV buffer "${name}"`);
            continue;
          }
          try {
            const meta = await registerBufferAndCreateTable(name, buffer);
            restoredTables.push(meta);
          } catch (err) {
            console.warn(`[restore] Could not rebuild table from "${name}":`, err);
          }
        }

        const savedFiles = await loadState("files");
        if (Array.isArray(savedFiles) && savedFiles.length > 0) {
          setFiles(savedFiles);
        }

        if (restoredTables.length > 0) {
          setTables(restoredTables);
          await saveState("tables", restoredTables);
        } else {
          const savedTables = await loadState("tables");
          if (Array.isArray(savedTables) && savedTables.length > 0) {
            setTables(savedTables);
          }
        }

        const savedCells = await loadState("cells");
        if (Array.isArray(savedCells) && savedCells.length > 0) {
          setCells(savedCells);
        }
        
        setDbReady(true);
      } catch (err) {
        console.warn("[restore] IndexedDB restore failed:", err);
        setDbReady(true); 
      } finally {
        setRestoring(false);
      }
    }

    bootstrap();
  }, []);

  // ─── STATE STORAGE PERSISTENCE ─────────────────────────────────────────────
  const persistCells = useCallback((updatedCells) => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      const slim = updatedCells.map(({ id, query, columns, error, elapsed }) => ({
        id, query, columns, error, elapsed,
      }));
      saveState("cells", slim).catch(() => {});
    }, 400);
  }, []);

  // ─── HIGH-PERFORMANCE PROGRESSIVE FILE INGESTION CONTROLLER ────────────────
  const handleUpload = useCallback(async (fileList) => {
    setUploadingFiles(true);
    setUploadProgress(0);
    setUploadStatus("Initializing local stream...");
    
    try {
      const newFiles = [];
      const newTables = [];

      for (const file of Array.from(fileList)) {
        const rawBuffer = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          
          reader.onprogress = (event) => {
            if (event.lengthComputable) {
              const percentage = Math.round((event.loaded / event.total) * 100);
              setUploadProgress(Math.min(percentage, 99));
              setUploadStatus(`Reading bytes: ${percentage}%`);
            }
          };

          reader.onload = () => resolve(reader.result);
          reader.onerror = () => reject(reader.error);
          reader.readAsArrayBuffer(file);
        });

        setUploadProgress(99);
        setUploadStatus("DuckDB allocating schemas & counting indexing limits...");
        await new Promise((r) => setTimeout(r, 60));

        const duckdbBuffer  = rawBuffer.slice(0);
        const storageBuffer = rawBuffer.slice(0);

        const meta = await registerBufferAndCreateTable(file.name, duckdbBuffer);
        await saveCSVBuffer(file.name, storageBuffer);

        newFiles.push({ id: Date.now() + Math.random(), name: file.name });
        newTables.push({ name: meta.name, rowCount: meta.rowCount, columns: meta.columns });
      }

      setUploadProgress(100);
      setUploadStatus("Ingestion complete!");
      await new Promise((r) => setTimeout(r, 350));

      setFiles((prev) => {
        const incomingNames = new Set(newFiles.map((f) => f.name));
        const cleanPrev = prev.filter((f) => !incomingNames.has(typeof f === "string" ? f : f.name));
        const merged = [...cleanPrev, ...newFiles];
        saveState("files", merged).catch(() => {});
        return merged;
      });

      setTables((prev) => {
        const incomingNames = new Set(newTables.map((t) => t.name));
        const cleanPrev = prev.filter((t) => !incomingNames.has(t.name));
        const merged = [...cleanPrev, ...newTables];
        saveState("tables", merged).catch(() => {});
        return merged;
      });

    } catch (err) {
      console.error("[upload] Error:", err);
      setUploadStatus("Ingestion failed.");
      alert(`File processing aborted: ${err.message || String(err)}`);
    } finally {
      setUploadingFiles(false);
      setUploadProgress(0);
      setUploadStatus("");
    }
  }, []);

  // ─── LONG-TERM WORKSPACE PERSISTENCE HOOK ────────────────────────────────
  const persistTableChanges = useCallback(async (tableName) => {
    try {
      const savedFiles = await loadState("files") || files;
      
      // ── 🎯 FIXED: Case-insensitive token lookup maps original filename case structures correctly ──
      const match = savedFiles.find((f) => {
        const nameStr = typeof f === "string" ? f : f.name;
        return fileNameToTable(nameStr) === tableName.toLowerCase().trim();
      });

      const fileName = match ? (typeof match === "string" ? match : match.name) : `${tableName}.csv`;
      const updatedBuffer = await getTableCSVBuffer(tableName);

      await saveCSVBuffer(fileName, updatedBuffer);
      console.log(`[Storage Link] Permanently saved updates for table: ${tableName} under file: ${fileName}`);
    } catch (err) {
      console.error("Context long term synchronization write failed:", err);
    }
  }, [files]);

  // ─── SAFE NOTEBOOK CELL QUERY RUNNER ───────────────────────────────────────
  const executeQuery = useCallback(async (cellId, sql) => {
    let targetSql = sql.trim();

    const isSelect = /^select\s/i.test(targetSql);
    const hasLimit = /\slimit\s+\d+/i.test(targetSql);
    if (isSelect && !hasLimit) {
      targetSql = `${targetSql.replace(/;+$/, "")} LIMIT 1000;`;
    }

    const rows = await runQuery(targetSql); 
    let finalRows = rows;
    
    try {
      if (
        pivotConfig &&
        pivotConfig.sql &&
        typeof pivotConfig.sql === "string" &&
        pivotConfig.sql.trim() === String(sql).trim()
      ) {
        const rf = (pivotConfig.rowFields && pivotConfig.rowFields[0]) || null;
        const cf = (pivotConfig.columnFields && pivotConfig.columnFields[0]) || null;
        const vf = (pivotConfig.valueFields && pivotConfig.valueFields[0]) || null;
        if (rf && cf && vf) {
          finalRows = pivotTransform(
            rows,
            rf.column,
            cf.column,
            vf.column,
            vf.agg || "SUM",
          );
        }
      }
    } catch (err) {
      console.warn("Pivot transform failed:", err);
    }

    setCells((prev) => {
      const updated = prev.map((c) =>
        c.id === cellId
          ? { ...c, columns: finalRows.length > 0 ? Object.keys(finalRows[0]) : [], error: null }
          : c
      );
      persistCells(updated);
      return updated;
    });

    return rows;
  }, [persistCells, pivotConfig]);

  const registerPivotConfig = useCallback((cfg) => {
    setPivotConfig(cfg);
  }, []);

  const updateCellError = useCallback((id, error, elapsed) => {
    setCells((prev) => {
      const updated = prev.map((c) =>
        c.id === id ? { ...c, error, elapsed, columns: [] } : c
      );
      persistCells(updated);
      return updated;
    });
  }, [persistCells]);

  const addCell = useCallback((query = "") => {
    setCells((prev) => {
      const updated = [
        ...prev,
        { id: Date.now(), query, columns: [], error: null, elapsed: null },
      ];
      persistCells(updated);
      return updated;
    });
  }, [persistCells]);

  const deleteCell = useCallback((id) => {
    setCells((prev) => {
      const updated = prev.filter((c) => c.id !== id);
      persistCells(updated);
      return updated;
    });
  }, [persistCells]);

  const duplicateCell = useCallback((id) => {
    setCells((prev) => {
      const idx = prev.findIndex((c) => c.id === id);
      if (idx === -1) return prev;
      const { ...rest } = prev[idx];
      const copy = { ...rest, id: Date.now(), error: null, columns: [] };
      const next = [...prev];
      next.splice(idx + 1, 0, copy);
      persistCells(next);
      return next;
    });
  }, [persistCells]);

  const updateCellQuery = useCallback((id, query) => {
    setCells((prev) => {
      const updated = prev.map((c) => (c.id === id ? { ...c, query } : c));
      persistCells(updated);
      return updated;
    });
  }, [persistCells]);

  // ─── WORKSPACE FILE & TABLE DELETIONS ──────────────────────────────────────
  const deleteFile = useCallback(async (fileNameOrObj) => {
    const name = typeof fileNameOrObj === "string" ? fileNameOrObj : fileNameOrObj.name;
    await deleteCSVBuffer(name).catch(() => {});
    try {
      const tableName = fileNameToTable(name);
      await dropTable(tableName).catch(() => {});
    } catch (err) {
      console.error("Failed to drop table during file removal:", err);
    }

    setFiles((prev) => {
      const updated = prev.filter((f) => f.name !== name);
      saveState("files", updated).catch(() => {});
      return updated;
    });

    setTables((prev) => {
      const updated = prev.filter((t) => t.name !== fileNameToTable(name));
      saveState("tables", updated).catch(() => {});
      return updated;
    });
  }, []);

  const deleteTable = useCallback(async (tableNameOrObj) => {
    const name = typeof tableNameOrObj === "string" ? tableNameOrObj : tableNameOrObj.name;
    await dropTable(name).catch(() => {});
    try {
      const savedFiles = await loadState("files");
      if (Array.isArray(savedFiles)) {
        const match = savedFiles.find((f) => fileNameToTable(typeof f === "string" ? f : f.name) === name);
        if (match) {
          const fileName = typeof match === "string" ? match : match.name;
          await deleteCSVBuffer(fileName).catch(() => {});
          setFiles((prev) => {
            const updatedFiles = prev.filter((f) => f.name !== fileName);
            saveState("files", updatedFiles).catch(() => {});
            return updatedFiles;
          });
        }
      }
    } catch (err) {
      console.error("Clean storage table match removal failed:", err);
    }

    setTables((prev) => {
      const updated = prev.filter((t) => t.name !== name);
      saveState("tables", updated).catch(() => {});
      return updated;
    });
  }, []);

  const clearAll = useCallback(async () => {
    await clearIndexedDB();
    setFiles([]);
    setTables([]);
    setCells(DEFAULT_CELLS);
  }, []);

  const recordHistory = useCallback(
    ({ cellId, sql, rowCount, elapsed, error }) =>
      saveQueryHistory({ cellId, sql, rowCount, elapsed, error }).catch(() => {}),
    []
  );

  return (
    <NotebookContext.Provider
      value={{
        dbReady,
        dbError,
        restoring,
        files,
        tables,
        uploadingFiles,
        uploadProgress, 
        uploadStatus,   
        cells,
        handleUpload,
        executeQuery,
        runMutation, 
        persistTableChanges, 
        updateCellError,
        addCell,
        deleteCell,
        duplicateCell,
        updateCellQuery,
        deleteFile,
        deleteTable,
        clearAll,
        recordHistory, 
        registerPivotConfig,
        pivotConfig,
      }}
    >
      {children}
    </NotebookContext.Provider>
  );
}

export { NotebookContext };