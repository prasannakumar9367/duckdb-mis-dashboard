import "./Header.css";
import React from "react";

export default function Header({
  dbReady,
  dbError,
  activeTab,
  setActiveTab,
  addCell,
}) {
  return (
    <div className="header">
      <div className="header-left">
        <div className="header-title-group">
          <h3>Demand vs Collection Notebook</h3>
          {!dbReady && !dbError && (
            <span className="header-status loading">Initializing DuckDB…</span>
          )}
          {dbReady && <span className="header-status ready">DuckDB Ready</span>}
        </div>
        <div className="header-tabs">
          <button
            type="button"
            className={activeTab === "home" ? "active" : ""}
            onClick={() => setActiveTab("home")}
          >
            Overview
          </button>
          <button
            type="button"
            className={activeTab === "sql" ? "active" : ""}
            onClick={() => setActiveTab("sql")}
          >
            SQL Notebook
          </button>
          <button
            type="button"
            className={activeTab === "pivot" ? "active" : ""}
            onClick={() => setActiveTab("pivot")}
          >
            PIVOT Builder
          </button>
          <button
            type="button"
            className={activeTab === "vlookup" ? "active" : ""}
            onClick={() => setActiveTab("vlookup")}
          >
            VLOOKUP Builder
          </button>
        </div>
      </div>
      <div className="header-actions">
        {activeTab === "sql" && (
          <button
            className="btn btn-primary"
            onClick={addCell}
            disabled={!dbReady}
          >
            <svg
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M8 3v10M3 8h10" strokeLinecap="round" />
            </svg>
            SQL Cell
          </button>
        )}
      </div>
    </div>
  );
}
