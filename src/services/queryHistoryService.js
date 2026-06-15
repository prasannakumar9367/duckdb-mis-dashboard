const DB_NAME    = "duckdb_notebook";
const DB_VERSION = 2;         
const HIST_STORE = "queryHistory";

function openHistDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains("files")) {
        db.createObjectStore("files", { keyPath: "name" });
      }
      if (!db.objectStoreNames.contains("state")) {
        db.createObjectStore("state", { keyPath: "key" });
      }
      if (!db.objectStoreNames.contains(HIST_STORE)) {
        const store = db.createObjectStore(HIST_STORE, { keyPath: "id" });
        store.createIndex("byCellId",    "cellId",    { unique: false });
        store.createIndex("byExecutedAt","executedAt",{ unique: false });
      }
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

export async function saveQueryHistory({ cellId, sql, rowCount, elapsed, error }) {
  const db = await openHistDB();
  const entry = {
    id:          `${cellId}_${Date.now()}`,
    cellId,
    sql,
    rowCount:    rowCount ?? 0,
    elapsed:     elapsed  ?? null,
    error:       error    ?? null,
    executedAt:  new Date().toISOString(),
  };
  return new Promise((resolve, reject) => {
    const tx = db.transaction(HIST_STORE, "readwrite");
    tx.objectStore(HIST_STORE).put(entry);
    tx.oncomplete = () => resolve(entry);
    tx.onerror    = () => reject(tx.error);
  });
}


export async function loadCellHistory(cellId) {
  const db = await openHistDB();
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(HIST_STORE, "readonly");
    const index = tx.objectStore(HIST_STORE).index("byCellId");
    const req   = index.getAll(cellId);
    req.onsuccess = () =>
      resolve((req.result ?? []).sort((a, b) => b.executedAt.localeCompare(a.executedAt)));
    req.onerror = () => reject(req.error);
  });
}


export async function loadAllHistory() {
  const db = await openHistDB();
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(HIST_STORE, "readonly");
    const req = tx.objectStore(HIST_STORE).getAll();
    req.onsuccess = () =>
      resolve((req.result ?? []).sort((a, b) => b.executedAt.localeCompare(a.executedAt)));
    req.onerror = () => reject(req.error);
  });
}


export async function deleteCellHistory(cellId) {
  const db    = await openHistDB();
  const all   = await loadCellHistory(cellId);
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(HIST_STORE, "readwrite");
    const store = tx.objectStore(HIST_STORE);
    all.forEach((entry) => store.delete(entry.id));
    tx.oncomplete = () => resolve();
    tx.onerror    = () => reject(tx.error);
  });
}


export async function clearAllHistory() {
  const db = await openHistDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(HIST_STORE, "readwrite");
    tx.objectStore(HIST_STORE).clear();
    tx.oncomplete = () => resolve();
    tx.onerror    = () => reject(tx.error);
  });
}