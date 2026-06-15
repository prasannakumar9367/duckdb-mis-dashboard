import { useEffect, useMemo, useState } from "react";  
import "ag-grid-community/styles/ag-grid.css";
import "ag-grid-community/styles/ag-theme-alpine.css";
import { exportCSV } from "../../utils/exportCsv";
import { exportExcel } from "../../utils/exportExcel";
import "./ResultGrid.css";
import { AgGridReact } from "ag-grid-react";
import { ModuleRegistry, AllCommunityModule } from "ag-grid-community";

ModuleRegistry.registerModules([AllCommunityModule]);

export default function ResultGrid({ data, columns, fileName = "results" }) {
  const [searchText, setSearchText] = useState("");  

  const cols = useMemo(() => {
    if (!data || data.length === 0) return [];
    return columns && columns.length ? columns : Object.keys(data[0]);
  }, [data, columns]);
  
  const columnDefs = useMemo(
    () =>
      cols.map((col) => ({
        field: col,
        sortable: true,
        filter: false, 
        resizable: true,
        flex: 1,
        minWidth: 100,
      })),
    [cols],
  );

  const getCleanFileName = () => {
    const stringName = String(fileName);
    return stringName
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_]/gi, "_")  
      .replace(/_{2,}/g, "_")  
      .replace(/^_+|_+$/g, "");  
  };

  const handleExport = (type) => {
    if (!data || data.length === 0) return;
    
    const formattedRows = data.map((row) => {
      const cleanRow = {};
      cols.forEach((col) => {
        const val = row[col];
        if (val === null || val === undefined) {
          cleanRow[col] = "NULL";  
        } else {
          cleanRow[col] = String(val); 
        }
      });
      return cleanRow;
    });

    const finalFileName = getCleanFileName() || "query_results";

    if (type === "csv") {
      exportCSV(formattedRows, `${finalFileName}.csv`);
    } else if (type === "excel") {
      exportExcel(formattedRows, `${finalFileName}.xlsx`);
    }
  };

  if (!data || data.length === 0 || cols.length === 0) return null;

  return (
    <div className="result-grid-wrapper">
      <div className="result-toolbar">
        <div className="toolbar-left" style={{ display: "flex", alignItems: "center", gap: "16px", flex: 1 }}>
          <span className="row-count">{data.length.toLocaleString()} rows</span>
          
         
        {/* Global Search Input Filter Container */}
<div className="global-search-container" style={{ position: "relative", width: "100%", maxWidth: "300px" }}>
  <input
    type="text"
    placeholder="Search all columns..."
    value={searchText}
    onChange={(e) => setSearchText(e.target.value)}
    style={{
      width: "100%",
      height: "28px",
      padding: "0 10px 0 28px",
      fontSize: "12px",
      border: "1px solid #cbd5e1",
      borderRadius: "4px",
      outline: "none",
      boxSizing: "border-box"
    }}
  />
  
 
  <span style={{ 
    position: "absolute", 
    left: "9px", 
    top: "7px", 
    display: "flex", 
    alignItems: "center", 
    color: "#9ca3af" 
  }}>
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  </span>
</div>
        </div>

        <div className="export-btns">
          <button onClick={() => handleExport("csv")}>⬇ CSV</button>
          <button onClick={() => handleExport("excel")}>⬇ Excel</button>
        </div>
      </div>

      <div className="ag-theme-alpine result-grid-content">
        <AgGridReact
          rowData={data}
          columnDefs={columnDefs}
          defaultColDef={{
            resizable: true,
            flex: 1,
            minWidth: 100,
            filter: false,  
          }}
          quickFilterText={searchText}  
          animateRows={true}
          rowSelection="multiple"
          pagination={true}
          paginationPageSize={100}
          suppressRowClickSelection={true}
          domLayout="autoHeight"
        />
      </div>
    </div>
  );
}