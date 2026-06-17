import {
  createContext,
  useState,
  useEffect,
  useCallback,
  useContext,
  useRef,
} from "react";

import {
  initDB,
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

export function useNotebook() {
  return useContext(NotebookContext);
}

export function NotebookProvider({ children }) {
  const [dbReady, setDbReady] = useState(false);
  const [dbError, setDbError] = useState(null);
  const [restoring, setRestoring] = useState(true);
  const [uploadingFiles, setUploadingFiles] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadStatus, setUploadStatus] = useState("");

  const [files, setFiles] = useState([]);
  const [tables, setTables] = useState([]);
  const [cells, setCells] = useState(DEFAULT_CELLS);
  const [pivotConfig, setPivotConfig] = useState(null);

  const debounceTimer = useRef(null);

  const normalizeFileDescriptor = useCallback((descriptor) => {
    if (!descriptor) return "";
    return typeof descriptor === "string" ? descriptor : descriptor.name || "";
  }, []);

  const normalizeTableKey = useCallback((fileName) => fileNameToTable(String(fileName)), []);

  useEffect(() => {
    async function bootstrap() {
      try {
        await initDB();
      } catch (error) {
        setDbError(error?.message || String(error));
        setRestoring(false);
        return;
      }

      try {
        const savedFilesState = (await loadState("files")) || [];
        const normalizedSavedFiles = Array.isArray(savedFilesState)
          ? savedFilesState.map((entry) => {
              if (typeof entry === "string") {
                return {
                  id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
                  name: entry,
                };
              }
              return {
                id: entry.id || `${Date.now()}-${Math.random().toString(36).slice(2)}`,
                ...entry,
              };
            })
          : [];

        const restoreKeys = new Set(normalizedSavedFiles.map((file) => normalizeTableKey(file.name)));

        const storedCSVBinaries = await loadAllCSVBuffers();
        const restoredTables = [];

        for (const record of storedCSVBinaries) {
          const fileName = record.name;
          const tableKey = normalizeTableKey(fileName);

          if (restoreKeys.size > 0 && !restoreKeys.has(tableKey)) {
            console.warn(`[bootstrap] Skipping orphaned buffer ${fileName}`);
            continue;
          }

          try {
            const meta = await registerBufferAndCreateTable(fileName, record.buffer);
            restoredTables.push(meta);
          } catch (error) {
            console.warn(`[bootstrap] Failed to restore ${fileName}:`, error);
          }
        }

        if (normalizedSavedFiles.length > 0) {
          setFiles(normalizedSavedFiles);
        }

        if (restoredTables.length > 0) {
          setTables(restoredTables);
          saveState("tables", restoredTables).catch(() => {});
        }

        const savedCells = await loadState("cells");
        if (Array.isArray(savedCells) && savedCells.length > 0) {
          setCells(savedCells);
        }

        setDbReady(true);
      } catch (error) {
        console.warn("[bootstrap] restore failed:", error);
        setDbReady(true);
      } finally {
        setRestoring(false);
      }
    }

    bootstrap();
  }, [normalizeTableKey]);

  const persistCells = useCallback((updatedCells) => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      const slim = updatedCells.map(({ id, query, columns, error, elapsed }) => ({
        id,
        query,
        columns,
        error,
        elapsed,
      }));
      saveState("cells", slim).catch(() => {});
    }, 400);
  }, []);

  const handleUpload = useCallback(async (fileList) => {
    if (!fileList || fileList.length === 0) return;

    setUploadingFiles(true);
    setUploadProgress(0);
    setUploadStatus("Preparing upload...");

    try {
      const incomingFiles = Array.from(fileList);
      const uploadedFiles = [];
      const uploadedTables = [];

      for (let index = 0; index < incomingFiles.length; index += 1) {
        const file = incomingFiles[index];
        const fileName = normalizeFileDescriptor(file);
        const tableKey = normalizeTableKey(fileName);

        setUploadStatus(`Streaming ${fileName}...`);
        setUploadProgress(0);

        const rawBuffer = await new Promise((resolve, reject) => {
          const reader = new FileReader();

          reader.onprogress = (event) => {
            if (event.lengthComputable) {
              const percent = Math.round((event.loaded / event.total) * 100);
              setUploadProgress(Math.min(Math.max(percent, 0), 100));
              setUploadStatus(`Streaming ${fileName}...`);
            }
          };

          reader.onload = () => resolve(reader.result);
          reader.onerror = () => reject(reader.error || new Error("File read failed"));
          reader.readAsArrayBuffer(file);
        });

        setUploadStatus(`Building DuckDB schema for ${fileName}`);
        setUploadProgress(92);

        // ── 🎯 FIXED: Isolate memory buffers before registration mutations ──
        // Slicing here prevents DuckDB from neutering the array data copy 
        // that IndexedDB requires down the line.
        const duckdbBuffer  = rawBuffer.slice(0);
        const storageBuffer = rawBuffer.slice(0);

        const meta = await registerBufferAndCreateTable(fileName, duckdbBuffer);
        await saveCSVBuffer(fileName, storageBuffer);

        uploadedFiles.push({
          id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
          name: fileName,
          tableKey,
        });
        uploadedTables.push(meta);
      }

      setUploadStatus("Finalizing ingestion...");
      setUploadProgress(100);
      await new Promise((resolve) => setTimeout(resolve, 180));

      setFiles((prev) => {
        const incomingKeyMap = new Map(uploadedFiles.map((file) => [file.tableKey, file]));

        const retained = prev.map((item) => {
          const itemKey = normalizeTableKey(normalizeFileDescriptor(item));
          const replacement = incomingKeyMap.get(itemKey);
          if (replacement) {
            return {
              ...item,
              id: item.id || replacement.id,
              name: replacement.name,
            };
          }
          return item;
        });

        const existingKeys = new Set(retained.map((item) => normalizeTableKey(normalizeFileDescriptor(item))));
        const appended = uploadedFiles
          .filter((file) => !existingKeys.has(file.tableKey))
          .map(({ id, name }) => ({ id, name }));

        const next = [...retained, ...appended];
        saveState("files", next).catch(() => {});
        return next;
      });

      setTables((prev) => {
        const incomingNames = new Set(uploadedTables.map((table) => table.name));
        const retained = prev.filter((table) => !incomingNames.has(table.name));
        const next = [...retained, ...uploadedTables];
        saveState("tables", next).catch(() => {});
        return next;
      });
    } catch (error) {
      console.error("[handleUpload] Error:", error);
      setUploadStatus("Upload failed.");
      alert(`Upload failed: ${error?.message || String(error)}`);
    } finally {
      setUploadingFiles(false);
      setUploadProgress(0);
      setUploadStatus("");
    }
  }, [normalizeFileDescriptor, normalizeTableKey]);

  const persistTableChanges = useCallback(async (tableName) => {
    try {
      const savedFilesState = (await loadState("files")) || [];
      const savedFiles = Array.isArray(savedFilesState) ? savedFilesState : [];

      const matchedFile = savedFiles.find((entry) => {
        const name = normalizeFileDescriptor(entry);
        return normalizeTableKey(name) === tableName;
      });

      const fileName = matchedFile
        ? normalizeFileDescriptor(matchedFile)
        : `${tableName}.csv`;

      const updatedBuffer = await getTableCSVBuffer(tableName);
      await saveCSVBuffer(fileName, updatedBuffer);
    } catch (error) {
      console.error("persistTableChanges failed:", error);
    }
  }, [normalizeFileDescriptor, normalizeTableKey]);

  const executeQuery = useCallback(async (cellId, sql) => {
    let targetSql = String(sql || "").trim();
    const isSelect = /^select\s+/i.test(targetSql);
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
    } catch (error) {
      console.warn("Pivot transform failed:", error);
    }

    setCells((prev) => {
      const updated = prev.map((cell) =>
        cell.id === cellId
          ? { ...cell, columns: finalRows.length > 0 ? Object.keys(finalRows[0]) : [], error: null }
          : cell,
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
      const updated = prev.map((cell) =>
        cell.id === id ? { ...cell, error, elapsed, columns: [] } : cell,
      );
      persistCells(updated);
      return updated;
    });
  }, [persistCells]);

  const addCell = useCallback((query = "") => {
    setCells((prev) => {
      const next = [
        ...prev,
        { id: Date.now(), query, columns: [], error: null, elapsed: null },
      ];
      persistCells(next);
      return next;
    });
  }, [persistCells]);

  const deleteCell = useCallback((id) => {
    setCells((prev) => {
      const next = prev.filter((cell) => cell.id !== id);
      persistCells(next);
      return next;
    });
  }, [persistCells]);

  const duplicateCell = useCallback((id) => {
    setCells((prev) => {
      const index = prev.findIndex((cell) => cell.id === id);
      if (index === -1) return prev;
      const copy = { ...prev[index], id: Date.now(), error: null, columns: [] };
      const next = [...prev];
      next.splice(index + 1, 0, copy);
      persistCells(next);
      return next;
    });
  }, [persistCells]);

  const updateCellQuery = useCallback((id, query) => {
    setCells((prev) => {
      const next = prev.map((cell) => (cell.id === id ? { ...cell, query } : cell));
      persistCells(next);
      return next;
    });
  }, [persistCells]);

  const deleteFile = useCallback(async (fileNameOrObj) => {
    const name = typeof fileNameOrObj === "string" ? fileNameOrObj : fileNameOrObj.name;
    await deleteCSVBuffer(name).catch(() => {});
    try {
      const tableName = fileNameToTable(name);
      await dropTable(tableName).catch(() => {});
    } catch (error) {
      console.error("Failed to drop table during file removal:", error);
    }

    setFiles((prev) => {
      const next = prev.filter((item) => normalizeFileDescriptor(item) !== name);
      saveState("files", next).catch(() => {});
      return next;
    });

    setTables((prev) => {
      const next = prev.filter((table) => table.name !== fileNameToTable(name));
      saveState("tables", next).catch(() => {});
      return next;
    });
  }, [normalizeFileDescriptor]);

  const deleteTable = useCallback(async (tableNameOrObj) => {
    const name = typeof tableNameOrObj === "string" ? tableNameOrObj : tableNameOrObj.name;
    await dropTable(name).catch(() => {});

    try {
      const savedFilesState = await loadState("files");
      if (Array.isArray(savedFilesState)) {
        const match = savedFilesState.find((entry) => {
          const fileName = normalizeFileDescriptor(entry);
          return fileNameToTable(fileName) === name;
        });
        if (match) {
          const fileName = normalizeFileDescriptor(match);
          await deleteCSVBuffer(fileName).catch(() => {});
          setFiles((prev) => {
            const next = prev.filter((item) => normalizeFileDescriptor(item) !== fileName);
            saveState("files", next).catch(() => {});
            return next;
          });
        }
      }
    } catch (error) {
      console.error("Clean storage table match removal failed:", error);
    }

    setTables((prev) => {
      const next = prev.filter((table) => table.name !== name);
      saveState("tables", next).catch(() => {});
      return next;
    });
  }, [normalizeFileDescriptor]);

  const clearAll = useCallback(async () => {
    await clearIndexedDB();
    setFiles([]);
    setTables([]);
    setCells(DEFAULT_CELLS);
  }, []);

  const recordHistory = useCallback(
    ({ cellId, sql, rowCount, elapsed, error }) =>
      saveQueryHistory({ cellId, sql, rowCount, elapsed, error }).catch(() => {}),
    [],
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