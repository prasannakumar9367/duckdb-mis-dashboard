import { useEffect, useState, useCallback, useMemo } from "react";
import { AgGridReact } from "ag-grid-react";
import { runQuery } from "../../services/duckdbService";
import * as XLSX from "xlsx";
import "./PivotBuilder.css";

const DPD_OPTIONS = [
  { label: "Full Portfolio", value: "full" },
  { label: "0 DPD", value: "0dpd" },
  { label: "0-30 DPD", value: "0-30dpd" },
  { label: "0-90 DPD", value: "0-90dpd" },
];

const CURRENCY_FORMATTER = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 2,
});

function formatCurrency(value) {
  if (value === null || value === undefined) return "—";
  const num = Number(value);
  if (isNaN(num)) return String(value);
  
  if (num >= 1e7) {
    return `₹${(num / 1e7).toFixed(2)} Cr`;
  }
  if (num >= 1e5) {
    return `₹${(num / 1e5).toFixed(2)} L`;
  }
  return CURRENCY_FORMATTER.format(num);
}

function MoMDeltaRenderer(props) {
  const { value, data } = props;
  if (value === null || value === undefined) return "—";
  
  const current = Number(value);
  const previous = data?.previous_month_collection_pct ? Number(data.previous_month_collection_pct) : null;
  
  if (previous === null) return `${current.toFixed(2)}%`;
  
  let color = "#6b7280";
  let prefix = "—";
  
  if (current > previous) {
    color = "#15803d";
    prefix = "▲";
  } else if (current < previous) {
    color = "#b91c1c";
    prefix = "▼";
  }
  
  return (
    <div style={{ color, fontWeight: "500" }}>
      {prefix} {current.toFixed(2)}%
    </div>
  );
}

function buildPivotSQL({
  selectedTable,
  bifurcationField,
  dpdFilter,
  tableColumns = [],
}) {
  if (!selectedTable || !bifurcationField) {
    return null;
  }

  const hasColumn = (colName) =>
    tableColumns.some((c) => c.name.toLowerCase() === colName.toLowerCase());

  let dpdWhere = "";
  switch (dpdFilter) {
    case "0dpd":
      dpdWhere = " WHERE CAST(dpd AS INT) = 0";
      break;
    case "0-30dpd":
      dpdWhere = " WHERE CAST(dpd AS INT) BETWEEN 0 AND 30";
      break;
    case "0-90dpd":
      dpdWhere = " WHERE CAST(dpd AS INT) BETWEEN 0 AND 90";
      break;
    default:
      dpdWhere = "";
  }

  const demandExpr = [];
  if (hasColumn("installment_amount")) demandExpr.push("installment_amount");
  if (hasColumn("total_due_amount")) demandExpr.push("total_due_amount");
  if (!demandExpr.length) demandExpr.push("0");
  const demand = `COALESCE(${demandExpr.join(", ")}, 0)`;

  const collectionExpr = [];
  if (hasColumn("collection_amount")) collectionExpr.push("collection_amount");
  if (hasColumn("total_amount_collected")) collectionExpr.push("total_amount_collected");
  if (!collectionExpr.length) collectionExpr.push("0");
  const collection = `COALESCE(${collectionExpr.join(", ")}, 0)`;

  const paidTag = () => {
    if (dpdFilter === "0dpd" || dpdFilter === "0-30dpd") {
      return `CASE 
        WHEN ${collection} >= total_due_amount THEN 'Paid' 
        WHEN ${collection} > 0 THEN 'Partial' 
        ELSE 'Not Paid' 
      END`;
    }
    return `CASE 
      WHEN ${collection} >= installment_amount THEN 'Paid' 
      WHEN ${collection} > 0 THEN 'Partial' 
      ELSE 'Not Paid' 
    END`;
  };

  const sql = `
WITH pivot_data AS (
  SELECT
    "${bifurcationField}" AS row_group,
    SUM(${demand}) AS total_demand,
    SUM(${collection}) AS total_collection,
    ROUND(SUM(${collection}) / NULLIF(SUM(${demand}), 0) * 100, 2) AS collection_pct,
    ${paidTag()} AS payment_status
  FROM "${selectedTable}"
  ${dpdWhere}
  GROUP BY "${bifurcationField}"
),
final_paid_list AS (
  SELECT DISTINCT loan_number FROM "${selectedTable}"
  WHERE payment_status = 'PAID'
)
SELECT
  row_group,
  total_demand,
  total_collection,
  collection_pct,
  CASE 
    WHEN row_group IN (SELECT loan_number FROM final_paid_list) 
    THEN 'PAID' 
    ELSE payment_status 
  END AS payment_status
FROM pivot_data
ORDER BY row_group
`;

  return sql.trim();
}

export default function PivotBuilder({ tables = [], dbReady = false }) {
  const [selectedTable, setSelectedTable] = useState("");
  const [tableColumns, setTableColumns] = useState([]);
  const [bifurcationField, setBifurcationField] = useState("");
  const [dpdFilter, setDpdFilter] = useState("full");
  const [gridApi, setGridApi] = useState(null);
  const [columnDefs, setColumnDefs] = useState([]);
  const [rowData, setRowData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    async function loadTableColumns() {
      if (!selectedTable || !dbReady) {
        setTableColumns([]);
        setBifurcationField("");
        return;
      }

      try {
        const describeSql = `DESCRIBE "${selectedTable}"`;
        const result = await runQuery(describeSql);
        setTableColumns(result);
        if (result.length > 0) {
          setBifurcationField(result[0].name);
        }
      } catch (err) {
        console.error("Failed to load table columns:", err);
        setError("Failed to load table columns");
        setTableColumns([]);
      }
    }

    loadTableColumns();
  }, [selectedTable, dbReady]);

  const generatedSQL = useMemo(() => {
    return buildPivotSQL({
      selectedTable,
      bifurcationField,
      dpdFilter,
      tableColumns,
    });
  }, [selectedTable, bifurcationField, dpdFilter, tableColumns]);

  const handleGenerate = async () => {
    if (!generatedSQL) return;

    setLoading(true);
    setError(null);

    try {
      const results = await runQuery(generatedSQL);
      setRowData(results);

      if (results.length > 0) {
        const keys = Object.keys(results[0]);
        const defs = keys.map((key) => {
          const colDef = {
            field: key,
            sortable: true,
            filter: true,
            resizable: true,
            minWidth: 120,
          };

          if (
            key === "total_demand" ||
            key === "total_collection"
          ) {
            colDef.valueFormatter = (params) => formatCurrency(params.value);
          } else if (key === "collection_pct") {
            colDef.cellRenderer = MoMDeltaRenderer;
          }

          return colDef;
        });
        setColumnDefs(defs);
      }
    } catch (err) {
      console.error("Query failed:", err);
      setError(err?.message || "Query execution failed");
    } finally {
      setLoading(false);
    }
  };

  const handleExport = () => {
    if (!rowData.length || !selectedTable) return;

    const wsData = rowData.map((row) =>
      Object.keys(row).reduce((acc, key) => {
        const val = row[key];
        if (key === "total_demand" || key === "total_collection") {
          acc[key] = formatCurrency(val);
        } else {
          acc[key] = val;
        }
        return acc;
      }, {})
    );

    const ws = XLSX.utils.json_to_sheet(wsData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "MIS Report");

    const dpdLabel = DPD_OPTIONS.find((opt) => opt.value === dpdFilter)?.label || dpdFilter;
    const fileName = `MIS_Report_${selectedTable}_${dpdLabel}_${new Date().toISOString().split("T")[0]}.xlsx`;

    XLSX.writeFile(wb, fileName);
  };

  return (
    <div className="pivot-builder">
      <div className="pivot-builder__header">
        <h3>Pivot Builder</h3>
        <p>Configure MIS report parameters and generate demand vs collection analysis.</p>
      </div>

      <div className="pivot-builder__toolbar">
        <div className="toolbar-group">
          <label>Target Table</label>
          <select
            value={selectedTable}
            onChange={(e) => setSelectedTable(e.target.value)}
            disabled={!dbReady}
          >
            <option value="">— Select table —</option>
            {tables.map((t) => (
              <option key={t.name} value={t.name}>
                {t.name}
              </option>
            ))}
          </select>
        </div>

        <div className="toolbar-group">
          <label>Bifurcation Dimension</label>
          <select
            value={bifurcationField}
            onChange={(e) => setBifurcationField(e.target.value)}
            disabled={!selectedTable || tableColumns.length === 0}
          >
            <option value="">— Select field —</option>
            {tableColumns.map((col) => (
              <option key={col.name} value={col.name}>
                {col.name}
              </option>
            ))}
          </select>
        </div>

        <div className="toolbar-group">
          <label>DPD Filter</label>
          <select value={dpdFilter} onChange={(e) => setDpdFilter(e.target.value)}>
            {DPD_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        <div className="toolbar-actions">
          <button
            className="btn-primary"
            onClick={handleGenerate}
            disabled={!generatedSQL || loading}
          >
            {loading ? "Generating..." : "Generate Report"}
          </button>
          <button
            className="btn-secondary"
            onClick={handleExport}
            disabled={!rowData.length}
          >
            Export Excel
          </button>
        </div>
      </div>

      {error && (
        <div className="pivot-builder__error">
          <strong>Error:</strong> {error}
        </div>
      )}

      <div className="pivot-builder__grid-container">
        {rowData.length > 0 ? (
          <div className="ag-theme-alpine" style={{ width: "100%", height: "500px" }}>
            <AgGridReact
              rowData={rowData}
              columnDefs={columnDefs}
              defaultColDef={{
                sortable: true,
                filter: true,
                resizable: true,
                minWidth: 120,
              }}
              animateRows
              onGridReady={(params) => setGridApi(params.api)}
            />
          </div>
        ) : (
          <div className="pivot-builder__empty">
            <p>Configure parameters and click "Generate Report" to view results.</p>
          </div>
        )}
      </div>
    </div>
  );
}
