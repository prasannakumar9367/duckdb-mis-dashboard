/**
 * QueryBuilder.jsx
 * Demand vs Collection MIS Engine — Pivot + Join Builder
 *
 * Single "Pivot" mode: join is embedded inside the pivot SQL automatically.
 * - Monaco editor for SQL (editable, with reset)
 * - AG Grid infinite scroll for results
 * - CSV + Excel chunked export with progress
 * - All column names and table names discovered at runtime — zero hardcoded schema.
 */

import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import Editor from "@monaco-editor/react";
import { AgGridReact } from "ag-grid-react";
import "ag-grid-community/styles/ag-grid.css";
import "ag-grid-community/styles/ag-theme-alpine.css";

import { runQuery } from "../../services/duckdbService";
import { useNotebook } from "../../context/useNotebook";
import BuilderDropZone from "../VLookupBuilder/VLookupDropZone";
import "./QueryBuilder.css";

// ─── Constants ────────────────────────────────────────────────────────────────

const EXPORT_CHUNK_SIZE = 50_000;
const GRID_PAGE_SIZE   = 100;
const AGG_OPTIONS      = ["SUM", "COUNT", "AVG", "MIN", "MAX"];

// ─── Pure helpers ─────────────────────────────────────────────────────────────

function q(id) {
  return `"${String(id).replace(/"/g, '""')}"`;
}

function fieldKey(f) {
  return f ? `${f.table}__${f.column}` : "";
}

function buildAlias(tableName, usedAliases = new Set()) {
  const first = String(tableName).split(/[^a-zA-Z0-9]+/).filter(Boolean)[0] || "t";
  let candidate = first[0].toLowerCase();
  let alias = candidate;
  let i = 1;
  while (usedAliases.has(alias)) { alias = `${candidate}${i}`; i++; }
  return alias;
}

/**
 * Build pivot SQL that includes the join inline.
 * Rows → GROUP BY, Values → aggregated, Columns → client-side pivot.
 */
function buildPivotSql({
  joinType = "LEFT JOIN",
  leftTableName,
  rightTableName,
  leftJoinField,
  rightJoinField,
  rowFields   = [],
  columnFields = [],
  valueFields  = [],
  filterFields = [],
  tables       = [],
}) {
  if (!leftTableName) return null;

  const usedAliases = new Set();
  const lAlias = buildAlias(leftTableName, usedAliases);
  usedAliases.add(lAlias);

  let fromClause = `FROM ${q(leftTableName)} ${lAlias}`;

  if (rightTableName && leftJoinField && rightJoinField) {
    const rAlias = buildAlias(rightTableName, usedAliases);
    usedAliases.add(rAlias);
    fromClause +=
      `\n${joinType} ${q(rightTableName)} ${rAlias}` +
      ` ON ${lAlias}.${q(leftJoinField)} = ${rAlias}.${q(rightJoinField)}`;
  }

  // Build SELECT expressions
  const resolveAlias = (f) => {
    const snap = new Set(Array.from(usedAliases));
    return buildAlias(f.table, snap);
  };

  const groupByExprs = rowFields.map(
    (f) => `${resolveAlias(f)}.${q(f.column)}`
  );

  const valueExprs = valueFields.map((f) => {
    const agg = f.agg || "SUM";
    return `${agg}(${resolveAlias(f)}.${q(f.column)}) AS ${q(`${agg}_${f.column}`)}`;
  });

  const selectExprs = [...groupByExprs, ...valueExprs];
  if (!selectExprs.length) return null;

  const parts = [`SELECT ${selectExprs.join(",\n       ")}`, fromClause];
  if (groupByExprs.length) parts.push(`GROUP BY ${groupByExprs.join(", ")}`);

  return parts.join("\n");
}

// ─── Export helpers ───────────────────────────────────────────────────────────

function rowsToCsv(rows) {
  if (!rows.length) return "";
  const headers = Object.keys(rows[0]);
  const escape  = (v) => {
    if (v == null) return "";
    const s = String(v);
    return s.includes(",") || s.includes('"') || s.includes("\n")
      ? `"${s.replace(/"/g, '""')}"`
      : s;
  };
  return [
    headers.join(","),
    ...rows.map((r) => headers.map((h) => escape(r[h])).join(",")),
  ].join("\n");
}

function downloadText(content, filename, mime = "text/csv;charset=utf-8;") {
  const blob = new Blob([content], { type: mime });
  const url  = URL.createObjectURL(blob);
  const a    = Object.assign(document.createElement("a"), { href: url, download: filename });
  a.click();
  URL.revokeObjectURL(url);
}

function exportExcel(rows, filename = "export.xlsx") {
  if (typeof window.XLSX === "undefined") {
    console.warn("SheetJS not loaded — falling back to CSV");
    downloadText(rowsToCsv(rows), filename.replace(".xlsx", ".csv"));
    return;
  }
  const ws = window.XLSX.utils.json_to_sheet(rows);
  const wb = window.XLSX.utils.book_new();
  window.XLSX.utils.book_append_sheet(wb, ws, "Results");
  window.XLSX.writeFile(wb, filename);
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatusBar({ count, message }) {
  return (
    <div className="qb-status-bar">
      <span>
        Rows:{" "}
        <strong>{count !== null ? count.toLocaleString("en-IN") : "—"}</strong>
      </span>
      {message && <span className="qb-status-bar__msg">{message}</span>}
    </div>
  );
}

function ExportProgress({ progress, status }) {
  return (
    <div className="qb-export-progress">
      <span className="qb-export-progress__label">{status}</span>
      <div className="qb-export-progress__track">
        <div
          className="qb-export-progress__fill"
          style={{ width: `${progress}%` }}
        />
      </div>
      <span className="qb-export-progress__pct">{progress}%</span>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

/**
 * Props:
 *   joinType        — "LEFT JOIN" | "INNER JOIN" | "RIGHT JOIN" | "FULL OUTER JOIN"
 *   leftTableName   — left/demand table
 *   leftJoinField   — column to join on (left side)   [string]
 *   rightTableName  — right/NH-structure table
 *   rightJoinField  — column to join on (right side)  [string]
 *   tables          — [{ name, columns: [{ name, type }] }]
 *   onResetFields   — clear all drop-zone state in parent
 *   onClearJoin     — clear join fields in parent
 */
export default function QueryBuilder({
  joinType = "LEFT JOIN",
  leftTableName,
  leftJoinField: leftJoinProp,
  rightTableName,
  rightJoinField: rightJoinProp,
  tables = [],
  onResetFields,
  onClearJoin,
}) {
  // ── Drop-zone state ───────────────────────────────────────────────────────
  const [leftJoinField,  setLeftJoinField]  = useState(leftJoinProp  ?? null);
  const [rightJoinField, setRightJoinField] = useState(rightJoinProp ?? null);
  const [rowFields,      setRowFields]      = useState([]);
  const [columnFields,   setColumnFields]   = useState([]);
  const [valueFields,    setValueFields]    = useState([]);
  const [filterFields,   setFilterFields]   = useState([]);

  useEffect(() => { setLeftJoinField(leftJoinProp   ?? null); }, [leftJoinProp]);
  useEffect(() => { setRightJoinField(rightJoinProp ?? null); }, [rightJoinProp]);

  // ── SQL state ─────────────────────────────────────────────────────────────
  const [sqlText,   setSqlText]   = useState("");
  const [sqlEdited, setSqlEdited] = useState(false);
  const [copied,    setCopied]    = useState(false);

  // ── Grid / query state ────────────────────────────────────────────────────
  const [gridApi,       setGridApi]       = useState(null);
  const [columnDefs,    setColumnDefs]    = useState([]);
  const [previewCount,  setPreviewCount]  = useState(null);
  const [statusMessage, setStatusMessage] = useState("");
  const [executing,     setExecuting]     = useState(false);
  const [metaLoading,   setMetaLoading]   = useState(false);
  const [metaError,     setMetaError]     = useState(null);
  const [hasResults,    setHasResults]    = useState(false);

  // ── Export state ──────────────────────────────────────────────────────────
  const [exporting,      setExporting]      = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [exportStatus,   setExportStatus]   = useState("");

  // ── Context ───────────────────────────────────────────────────────────────
  const { registerPivotConfig } = useNotebook();

  // ── Generated SQL (memoised) ──────────────────────────────────────────────
  const generatedSql = useMemo(
    () =>
      buildPivotSql({
        joinType,
        leftTableName,
        rightTableName,
        leftJoinField,
        rightJoinField,
        rowFields,
        columnFields,
        valueFields,
        filterFields,
        tables,
      }) ?? "",
    [
      joinType, leftTableName, rightTableName,
      leftJoinField, rightJoinField,
      rowFields, columnFields, valueFields, filterFields, tables,
    ]
  );

  const displayedSql = sqlEdited ? sqlText : generatedSql;

  useEffect(() => {
    if (!sqlEdited) setSqlText(generatedSql);
  }, [generatedSql, sqlEdited]);

  // Register pivot config with notebook context
  useEffect(() => {
    if (typeof registerPivotConfig === "function") {
      registerPivotConfig({ sql: generatedSql, rowFields, columnFields, valueFields });
    }
  }, [generatedSql, rowFields, columnFields, valueFields, registerPivotConfig]);

  // ── Datasource ref (stable across renders) ────────────────────────────────
  const datasourceRef     = useRef(null);
  const displayedSqlRef   = useRef(displayedSql);
  const columnDefsRef     = useRef(columnDefs);

  useEffect(() => { displayedSqlRef.current = displayedSql; }, [displayedSql]);
  useEffect(() => { columnDefsRef.current   = columnDefs;   }, [columnDefs]);

  // ── Run Preview ───────────────────────────────────────────────────────────
  const runPreview = useCallback(async () => {
    const baseSql = displayedSqlRef.current.replace(/;\s*$/, "");
    if (!baseSql.trim()) return;

    setExecuting(true);
    setMetaError(null);
    setStatusMessage("Running…");
    setHasResults(false);

    try {
      // Count
      const countRes = await runQuery(
        `SELECT COUNT(*) AS cnt FROM (${baseSql}) AS _cnt`
      );
      const total = Number(countRes?.[0]?.cnt ?? 0);
      setPreviewCount(total);

      // Column defs from first row
      const sample = await runQuery(`${baseSql} LIMIT 1`);
      if (sample.length > 0) {
        const defs = Object.keys(sample[0]).map((key) => ({
          field: key,
          headerName: key,
          sortable: true,
          filter: true,
          resizable: true,
          minWidth: 120,
        }));
        setColumnDefs(defs);
        columnDefsRef.current = defs;
      }

      setStatusMessage(`${total.toLocaleString("en-IN")} rows`);

      // Build datasource and attach to grid
      const ds = {
        getRows: async (params) => {
          const sql  = displayedSqlRef.current.replace(/;\s*$/, "");
          const limit = params.endRow - params.startRow;
          try {
            const rows = await runQuery(`${sql} LIMIT ${limit} OFFSET ${params.startRow}`);
            const last = rows.length < limit ? params.startRow + rows.length : undefined;
            params.successCallback(rows, last);
          } catch {
            params.failCallback();
          }
        },
      };
      datasourceRef.current = ds;
      if (gridApi) gridApi.setDatasource(ds);

      setHasResults(true);
    } catch (err) {
      setMetaError(err?.message || "Query failed");
      setStatusMessage("Error");
    } finally {
      setExecuting(false);
    }
  }, [gridApi]);

  // ── AG Grid ready ─────────────────────────────────────────────────────────
  const handleGridReady = useCallback((params) => {
    setGridApi(params.api);
    if (datasourceRef.current) params.api.setDatasource(datasourceRef.current);
  }, []);

  // ── SQL editor ────────────────────────────────────────────────────────────
  const handleSqlChange = (val) => {
    setSqlText(val ?? "");
    setSqlEdited(true);
  };

  const handleResetSql = () => {
    setSqlText(generatedSql);
    setSqlEdited(false);
    setStatusMessage("SQL reset.");
  };

  const handleCopySql = async () => {
    try {
      await navigator.clipboard.writeText(displayedSql);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch { /* permission denied */ }
  };

  // ── Export CSV ────────────────────────────────────────────────────────────
  const handleExportCsv = async () => {
    const baseSql = displayedSql.replace(/;\s*$/, "");
    if (!baseSql.trim()) return;
    setExporting(true);
    setExportProgress(0);
    setExportStatus("Starting export…");

    try {
      const total = previewCount ?? Number(
        (await runQuery(`SELECT COUNT(*) AS cnt FROM (${baseSql}) AS _e`))?.[0]?.cnt ?? 0
      );
      const parts = [];
      let offset  = 0;

      while (offset < total) {
        const chunk = await runQuery(`${baseSql} LIMIT ${EXPORT_CHUNK_SIZE} OFFSET ${offset}`);
        parts.push(...chunk);
        offset += chunk.length;
        setExportProgress(Math.min(100, Math.round((offset / total) * 100)));
        setExportStatus(`${offset.toLocaleString("en-IN")} / ${total.toLocaleString("en-IN")} rows`);
        if (chunk.length < EXPORT_CHUNK_SIZE) break;
      }

      downloadText(rowsToCsv(parts), `pivot_export_${Date.now()}.csv`);
      setExportStatus("Export complete.");
    } catch (err) {
      setExportStatus("Export failed.");
    } finally {
      setExporting(false);
      setExportProgress(0);
    }
  };

  // ── Export Excel ──────────────────────────────────────────────────────────
  const handleExportExcel = async () => {
    const baseSql = displayedSql.replace(/;\s*$/, "");
    if (!baseSql.trim()) return;
    setExporting(true);
    setExportProgress(0);
    setExportStatus("Preparing Excel…");

    try {
      const total = previewCount ?? Number(
        (await runQuery(`SELECT COUNT(*) AS cnt FROM (${baseSql}) AS _e`))?.[0]?.cnt ?? 0
      );
      const rows   = [];
      let offset   = 0;

      while (offset < total) {
        const chunk = await runQuery(`${baseSql} LIMIT ${EXPORT_CHUNK_SIZE} OFFSET ${offset}`);
        rows.push(...chunk);
        offset += chunk.length;
        setExportProgress(Math.min(100, Math.round((offset / total) * 100)));
        setExportStatus(`${offset.toLocaleString("en-IN")} / ${total.toLocaleString("en-IN")} rows`);
        if (chunk.length < EXPORT_CHUNK_SIZE) break;
      }

      exportExcel(rows, `pivot_export_${Date.now()}.xlsx`);
      setExportStatus("Export complete.");
    } catch {
      setExportStatus("Export failed.");
    } finally {
      setExporting(false);
      setExportProgress(0);
    }
  };

  // ── Helpers ───────────────────────────────────────────────────────────────
  const removeFromList = (field, setter) =>
    setter((prev) => prev.filter((item) => fieldKey(item) !== fieldKey(field)));

  const updateValueAgg = (field, agg) =>
    setValueFields((prev) =>
      prev.map((item) => fieldKey(item) === fieldKey(field) ? { ...item, agg } : item)
    );

  const canRun = !!displayedSql.trim() && !!leftTableName;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="query-builder">

      {/* ── Header ───────────────────────────────────────────────────────── */}
      <div className="query-builder__header">
        <div>
          <h3>Pivot Builder</h3>
          <p className="query-builder__subtitle">
            {leftTableName && rightTableName
              ? `${leftTableName} ${joinType} ${rightTableName}`
              : "Configure the join and drop fields below to build your pivot query."}
          </p>
        </div>
        <div className="query-builder__meta">
          {typeof onResetFields === "function" && (
            <button className="btn-secondary" type="button" onClick={onResetFields}>
              Reset
            </button>
          )}
          {typeof onClearJoin === "function" && (
            <button className="btn-secondary" type="button" onClick={onClearJoin}>
              Clear Join
            </button>
          )}
        </div>
      </div>

      {/* ── Drop Zones ───────────────────────────────────────────────────── */}
      <div className="query-builder__builder">

        {/* Join fields */}
        <div className="builder-panel builder-panel--join">
          <div className="builder-panel__section-label">Join</div>
          <BuilderDropZone
            id="join-left"
            label="Left Join Field"
            placeholder="Drop left join column"
            values={leftJoinField ? [leftJoinField] : []}
            onRemove={() => setLeftJoinField(null)}
            accent="#2563eb"
          />
          <BuilderDropZone
            id="join-right"
            label="Right Join Field"
            placeholder="Drop right join column"
            values={rightJoinField ? [rightJoinField] : []}
            onRemove={() => setRightJoinField(null)}
            accent="#9333ea"
          />
        </div>

        {/* Pivot fields */}
        <div className="builder-panel builder-panel--pivot">
          <div className="builder-panel__section-label">Pivot</div>
          <div className="builder-panel__pivot-grid">
            <BuilderDropZone
              id="pivot-rows"
              label="Rows (Group By)"
              placeholder="Drop row fields"
              values={rowFields}
              onRemove={(f) => removeFromList(f, setRowFields)}
              accent="#1d4ed8"
            />
            <BuilderDropZone
              id="pivot-columns"
              label="Columns"
              placeholder="Drop column fields"
              values={columnFields}
              onRemove={(f) => removeFromList(f, setColumnFields)}
              accent="#7c3aed"
            />
            <BuilderDropZone
              id="pivot-values"
              label="Values (Aggregate)"
              placeholder="Drop value fields"
              values={valueFields}
              onRemove={(f) => removeFromList(f, setValueFields)}
              accent="#059669"
            />
            <BuilderDropZone
              id="pivot-filters"
              label="Filters"
              placeholder="Drop filter fields"
              values={filterFields}
              onRemove={(f) => removeFromList(f, setFilterFields)}
              accent="#f97316"
            />
          </div>

          {/* Aggregation selectors */}
          {valueFields.length > 0 && (
            <div className="builder-agg-panel">
              <p className="builder-agg-panel__label">Aggregation</p>
              {valueFields.map((field) => (
                <label key={fieldKey(field)} className="builder-agg-item">
                  <span className="builder-agg-item__name">
                    {field.table}.{field.column}
                  </span>
                  <select
                    value={field.agg || "SUM"}
                    onChange={(e) => updateValueAgg(field, e.target.value)}
                  >
                    {AGG_OPTIONS.map((agg) => (
                      <option key={agg} value={agg}>{agg}</option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Monaco SQL Editor ─────────────────────────────────────────────── */}
      <div className="query-builder__sql-card">
        <div className="qb-cell-bar">
          <div className="qb-cell-bar__label">
            <span>SQL</span>
            <span className="qb-cell-bar__muted">pivot-query</span>
            {sqlEdited && <span className="qb-edited-badge">edited</span>}
          </div>
          <div className="qb-cell-bar__actions">
            <button
              type="button"
              className="btn-secondary"
              onClick={handleCopySql}
              disabled={!displayedSql.trim()}
            >
              {copied ? "Copied ✓" : "Copy"}
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={handleResetSql}
              disabled={!sqlEdited}
            >
              Reset
            </button>
            <button
              type="button"
              className="qb-run-btn"
              onClick={runPreview}
              disabled={executing || !canRun}
            >
              {executing ? "⏳ Running…" : "▶ Run"}
            </button>
          </div>
        </div>

        <div className="qb-monaco-wrapper">
          <Editor
            height="180px"
            language="sql"
            value={displayedSql}
            onChange={handleSqlChange}
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
        </div>
      </div>

      {/* ── Results Panel ─────────────────────────────────────────────────── */}
      {(hasResults || metaError || executing) && (
        <div className="query-builder__results-card">

          {/* Toolbar */}
          <div className="qb-results-toolbar">
            <StatusBar count={previewCount} message={statusMessage} />
            <div className="qb-results-toolbar__exports">
              <button
                type="button"
                className="btn-secondary"
                onClick={handleExportCsv}
                disabled={exporting || !hasResults}
              >
                {exporting ? `${exportProgress}%` : "⬇ CSV"}
              </button>
              <button
                type="button"
                className="btn-secondary"
                onClick={handleExportExcel}
                disabled={exporting || !hasResults}
              >
                ⬇ Excel
              </button>
            </div>
          </div>

          {/* Export progress */}
          {exporting && (
            <ExportProgress progress={exportProgress} status={exportStatus} />
          )}

          {/* Error */}
          {metaError && (
            <div className="query-builder__error">
              <strong>Error:</strong> {metaError}
            </div>
          )}

          {/* AG Grid */}
          {!metaError && (
            <div className="ag-theme-alpine qb-ag-grid">
              <AgGridReact
                columnDefs={columnDefs}
                rowModelType="infinite"
                cacheBlockSize={GRID_PAGE_SIZE}
                maxBlocksInCache={5}
                animateRows
                onGridReady={handleGridReady}
                defaultColDef={{
                  sortable: true,
                  filter: true,
                  resizable: true,
                  minWidth: 120,
                }}
                overlayNoRowsTemplate={
                  executing
                    ? "<span>Running query…</span>"
                    : "<span>No results</span>"
                }
              />
            </div>
          )}
        </div>
      )}

      {/* ── Empty state ───────────────────────────────────────────────────── */}
      {!canRun && !executing && (
        <div className="query-builder__empty">
          <p>
            Select a left table and drop fields into the Rows or Values zones
            to build your pivot query, then click <strong>▶ Run</strong>.
          </p>
        </div>
      )}
    </div>
  );
}