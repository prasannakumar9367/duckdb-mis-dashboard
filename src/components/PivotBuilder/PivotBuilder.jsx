import { useState, useMemo } from "react";
import PivotDropZone from "./PivotDropZone";
import { buildPivot, formatValue, AGGREGATIONS } from "./pivotUtils";
import "./PivotBuilder.css";

export default function PivotBuilder({ data = [], columns = [], onClose }) {
  const [rowField, setRowField] = useState(null);
  const [colField, setColField] = useState(null);
  const [valueField, setValueField] = useState(null);
  const [aggFn, setAggFn] = useState("SUM");
  const pivot = useMemo(
    () => buildPivot(data, rowField, colField, valueField, aggFn),
    [data, rowField, colField, valueField, aggFn],
  );

  const startDrag = (e, col) => {
    e.dataTransfer.setData("text/plain", col);
    e.dataTransfer.effectAllowed = "move";
  };


  const exportCSV = () => {
    if (!pivot) return;
    const { rowKeys, colKeys, cells, rowTotals, colTotals, grandTotal } = pivot;
    const header = ["", ...colKeys, "Total"].join(",");
    const rows = rowKeys.map((rk) => {
      const vals = colKeys.map((ck) => cells[rk]?.[ck] ?? "");
      return [rk, ...vals, rowTotals[rk] ?? ""].join(",");
    });
    const totalsRow = [
      "Total",
      ...colKeys.map((ck) => colTotals[ck] ?? ""),
      grandTotal ?? "",
    ].join(",");
    const csv = [header, ...rows, totalsRow].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `pivot_${aggFn.toLowerCase()}_${valueField ?? "data"}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const activeFields = new Set(
    [rowField, colField, valueField].filter(Boolean),
  );

  return (
    <div className="pivot-overlay" role="dialog" aria-label="Pivot Builder">
      <div className="pivot-panel">
        <div className="pivot-header">
          <div className="pivot-header__left">
            <svg
              width="14"
              height="14"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
            >
              <rect x="1" y="1" width="6" height="6" rx="1" />
              <rect x="9" y="1" width="6" height="6" rx="1" />
              <rect x="1" y="9" width="6" height="6" rx="1" />
              <rect x="9" y="9" width="6" height="6" rx="1" />
            </svg>
            <span>Pivot Builder</span>
            <span className="pivot-header__rows">
              {data.length.toLocaleString()} rows
            </span>
          </div>
          <div className="pivot-header__right">
            {pivot && (
              <button
                className="pivot-btn pivot-btn--ghost"
                onClick={exportCSV}
                title="Export pivot as CSV"
              >
                <svg
                  width="11"
                  height="11"
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                >
                  <path
                    d="M8 2v9M4 8l4 4 4-4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <path d="M2 14h12" strokeLinecap="round" />
                </svg>
                Export
              </button>
            )}
            <button
              className="pivot-btn pivot-btn--close"
              onClick={onClose}
              aria-label="Close pivot builder"
            >
              ×
            </button>
          </div>
        </div>

        <div className="pivot-body">
          <div className="pivot-config">
            <div className="pivot-config__section-label">Columns</div>
            <div className="pivot-field-list">
              {columns.map((col) => (
                <div
                  key={col}
                  className={`pivot-field${activeFields.has(col) ? " pivot-field--active" : ""}`}
                  draggable
                  onDragStart={(e) => startDrag(e, col)}
                  onDragEnd={() => {}}
                  title={`Drag "${col}" to a zone`}
                >
                  <svg
                    width="9"
                    height="9"
                    viewBox="0 0 9 12"
                    fill="currentColor"
                    opacity=".4"
                  >
                    <circle cx="2.5" cy="2" r="1.2" />
                    <circle cx="6.5" cy="2" r="1.2" />
                    <circle cx="2.5" cy="6" r="1.2" />
                    <circle cx="6.5" cy="6" r="1.2" />
                    <circle cx="2.5" cy="10" r="1.2" />
                    <circle cx="6.5" cy="10" r="1.2" />
                  </svg>
                  {col}
                </div>
              ))}
            </div>

            <div
              className="pivot-config__section-label"
              style={{ marginTop: 16 }}
            >
              Aggregation
            </div>
            <div className="pivot-agg-select-wrap">
              <select
                className="pivot-agg-select"
                value={aggFn}
                onChange={(e) => setAggFn(e.target.value)}
              >
                {AGGREGATIONS.map((fn) => (
                  <option key={fn} value={fn}>
                    {fn}
                  </option>
                ))}
              </select>
              <svg
                width="10"
                height="10"
                viewBox="0 0 10 10"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                className="pivot-select-caret"
              >
                <path
                  d="M2 3.5l3 3 3-3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>

            <div className="pivot-zones">
              <PivotDropZone
                label="Rows"
                field={rowField}
                onDrop={setRowField}
                onClear={() => setRowField(null)}
                accent="#3b82f6"
              />
              <PivotDropZone
                label="Columns"
                field={colField}
                onDrop={setColField}
                onClear={() => setColField(null)}
                accent="#8b5cf6"
              />
              <PivotDropZone
                label="Values"
                field={valueField}
                onDrop={setValueField}
                onClear={() => setValueField(null)}
                accent="#10b981"
              />
            </div>

            {(!rowField || !valueField) && (
              <p className="pivot-hint">
                Drag columns into <strong>Rows</strong> and{" "}
                <strong>Values</strong> to build a pivot.
              </p>
            )}
          </div>

          <div className="pivot-result">
            {pivot ? (
              <div className="pivot-table-container">
                <PivotTable
                  pivot={pivot}
                  aggFn={aggFn}
                  rowField={rowField}
                  colField={colField}
                />
              </div>
            ) : (
              <div className="pivot-empty">
                <svg
                  width="32"
                  height="32"
                  viewBox="0 0 32 32"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.2"
                  opacity=".25"
                >
                  <rect x="2" y="2" width="12" height="12" rx="2" />
                  <rect x="18" y="2" width="12" height="12" rx="2" />
                  <rect x="2" y="18" width="12" height="12" rx="2" />
                  <rect x="18" y="18" width="12" height="12" rx="2" />
                </svg>
                <span>Set Rows + Values to see results</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function PivotTable({ pivot, aggFn, rowField, colField }) {
  const { rowKeys, colKeys, cells, colTotals, rowTotals, grandTotal } = pivot;

  return (
    <div className="pivot-table-wrap">
      <table className="pivot-table">
        <thead>
          <tr>
            <th className="pivot-th pivot-th--corner">
              {rowField}
              {colField && <span className="pivot-th-sub"> / {colField}</span>}
            </th>
            {colKeys.map((ck) => (
              <th key={ck} className="pivot-th pivot-th--col">
                {ck}
              </th>
            ))}
            <th className="pivot-th pivot-th--total">Total</th>
          </tr>
        </thead>
        <tbody>
          {rowKeys.map((rk, ri) => (
            <tr
              key={rk}
              className={ri % 2 === 0 ? "pivot-tr--even" : "pivot-tr--odd"}
            >
              <td className="pivot-td pivot-td--row-label">{rk}</td>
              {colKeys.map((ck) => (
                <td key={ck} className="pivot-td pivot-td--value">
                  {formatValue(cells[rk]?.[ck], aggFn)}
                </td>
              ))}
              <td className="pivot-td pivot-td--row-total">
                {formatValue(rowTotals[rk], aggFn)}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="pivot-tfoot-row">
            <td className="pivot-td pivot-td--footer-label">Total</td>
            {colKeys.map((ck) => (
              <td key={ck} className="pivot-td pivot-td--col-total">
                {formatValue(colTotals[ck], aggFn)}
              </td>
            ))}
            <td className="pivot-td pivot-td--grand-total">
              {formatValue(grandTotal, aggFn)}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
