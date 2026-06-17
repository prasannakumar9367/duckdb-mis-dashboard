import * as duckdb from "@duckdb/duckdb-wasm";

let db   = null;
let conn = null;

/**
 * Initializes the DuckDB WebAssembly engine thread sandbox.
 */
export async function initDB() {
  if (db) return { db, conn };

  const bundles = duckdb.getJsDelivrBundles();
  const bundle  = await duckdb.selectBundle(bundles);

  const workerUrl = URL.createObjectURL(
    new Blob([`importScripts("${bundle.mainWorker}");`], { type: "text/javascript" })
  );

  const worker = new Worker(workerUrl);
  const logger = new duckdb.ConsoleLogger();

  db = new duckdb.AsyncDuckDB(logger, worker);
  await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
  URL.revokeObjectURL(workerUrl);

  conn = await db.connect();
  return { db, conn };
}

export const getDB   = () => db;
export const getConn = () => conn;

/**
 * Sanitizes uploaded file names into safe, valid SQL table identifiers.
 */
export function fileNameToTable(fileName) {
  return fileName
    .replace(/\.csv$/i, "")
    .replace(/\s+/g, "_")
    .replace(/[^a-zA-Z0-9_]/g, "")
    .toLowerCase();
}

/**
 * Registers an ArrayBuffer into the DuckDB virtual file system and builds an indexed table view.
 */
export async function registerBufferAndCreateTable(fileName, buffer) {
  if (!db || !conn) throw new Error("DuckDB not initialized");

  const tableName = fileNameToTable(fileName);
  await db.registerFileBuffer(fileName, new Uint8Array(buffer));

  // ── 🎯 all_varchar = true guarantees seamless type rehydration on mutated files ──
  await conn.query(`
    CREATE OR REPLACE TABLE "${tableName}" AS
    SELECT * FROM read_csv_auto('${fileName}', header = true, all_varchar = true)
  `);

  const [countRow] = (await conn.query(`SELECT COUNT(*) AS cnt FROM "${tableName}"`)).toArray();
  const rowCount   = Number(countRow.cnt);

  const columns = (await conn.query(`DESCRIBE "${tableName}"`))
    .toArray()
    .map((r) => ({ name: r.column_name, type: r.column_type }));

  return { name: tableName, rowCount, columns };
}

/**
 * Wrapper method to parse raw file objects cleanly during user upload drops.
 */
export async function registerAndCreateTable(file) {
  const rawBuffer = await file.arrayBuffer();
  const duckdbBuffer  = rawBuffer.slice(0);
  const storageBuffer = rawBuffer.slice(0);

  const meta = await registerBufferAndCreateTable(file.name, duckdbBuffer);

  return {
    tableName:     meta.name,
    rowCount:      meta.rowCount,
    columns:       meta.columns,
    storageBuffer,         
  };
}

/**
 * 🎯 PAGINATION DATA RETRIEVAL ENGINE
 */
export async function runQuery(sql) {
  if (!conn) throw new Error("DuckDB connection not initialized");
  
  const result = await conn.query(sql);
  
  return result.toArray().map((row) => {
    const rowObj = {};
    for (const key in row) {
      if (Object.prototype.hasOwnProperty.call(row, key)) {
        const value = row[key];
        rowObj[key] = typeof value === "bigint" ? Number(value) : value;
      }
    }
    return rowObj;
  });
}

/**
 * 🎯 IN-MEMORY DATA MUTATION ENGINE
 */
export async function runMutation(sql) {
  if (!conn) throw new Error("DuckDB connection not initialized");
  await conn.query(sql);
  return true;
}

/**
 * Drops active tables from the workspace catalog cleanly.
 */
export async function dropTable(name) {
  if (!conn) return;
  await conn.query(`DROP TABLE IF EXISTS "${name}"`);
}

/**
 * ── 🎯 HIGH-SPEED VIRTUAL FILE SYSTEM PERSISTENCE STREAM EXPORTER ──────────
 */
export async function getTableCSVBuffer(tableName) {
  if (!db || !conn) throw new Error("DuckDB not initialized");
  const tempFile = `temp_vfs_sync_${Date.now()}.csv`;
  
  await conn.query(`COPY "${tableName}" TO '${tempFile}' (HEADER, DELIMITER ',');`);
  const u8Array = await db.copyFileToBuffer(tempFile);
  
  // ── 🎯 FIXED: Slice the buffer memory immediately upon retrieval ──
  // This extracts a completely independent array copy out of WebAssembly memory
  // space before dropping the temp VFS asset or passing it to the main thread.
  const safeMainThreadBuffer = u8Array.buffer.slice(0);
  
  await db.dropFile(tempFile);
  return safeMainThreadBuffer;
}