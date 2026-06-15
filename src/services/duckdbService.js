import * as duckdb from "@duckdb/duckdb-wasm";

let db   = null;
let conn = null;


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



export function fileNameToTable(fileName) {
  return fileName
    .replace(/\.csv$/i, "")
    .replace(/\s+/g, "_")
    .replace(/[^a-zA-Z0-9_]/g, "")
    .toLowerCase();
}

export async function registerBufferAndCreateTable(fileName, buffer) {
  if (!db || !conn) throw new Error("DuckDB not initialized");

  const tableName = fileNameToTable(fileName);

  const uint8 = buffer instanceof Uint8Array
    ? new Uint8Array(buffer.buffer.slice(0))
    : new Uint8Array(buffer.slice(0));

  await db.registerFileBuffer(fileName, uint8);

  await conn.query(`
    CREATE OR REPLACE TABLE "${tableName}" AS
    SELECT * FROM read_csv_auto('${fileName}', header = true, all_varchar = false)
  `);

  const [countRow] = (await conn.query(`SELECT COUNT(*) AS cnt FROM "${tableName}"`)).toArray();
  const rowCount   = Number(countRow.cnt);

  const columns = (await conn.query(`DESCRIBE "${tableName}"`))
    .toArray()
    .map((r) => ({ name: r.column_name, type: r.column_type }));

  return { name: tableName, rowCount, columns };
}

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


export async function runQuery(sql) {
  if (!conn) throw new Error("DuckDB connection not initialized");

  const result = await conn.query(sql);

  return result.toArray().map((row) => {
    const obj = {};
    for (const [k, v] of Object.entries(row)) {
      obj[k] = typeof v === "bigint" ? Number(v) : v;
    }
    return obj;
  });
}

export async function dropTable(tableName) {
  if (!conn) throw new Error("DuckDB connection not initialized");
  await conn.query(`DROP TABLE IF EXISTS "${tableName}"`);
}