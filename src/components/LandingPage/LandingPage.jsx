import React from "react";
import "./LandingPage.css";

export default function LandingPage({onUploadClick }) {
  return (
    <div className="welcome-workspace-panel">
      <div className="welcome-message-card">
        <div className="welcome-header-group">
          <div className="welcome-icon-wrapper">
            <svg width="24" height="24" viewBox="0 0 16 16" fill="none">
              <rect x="1" y="1" width="6" height="6" rx="1.5" fill="#2563eb" />
              <rect x="9" y="1" width="6" height="6" rx="1.5" fill="#2563eb" opacity=".5" />
              <rect x="1" y="9" width="6" height="6" rx="1.5" fill="#2563eb" opacity=".5" />
              <rect x="9" y="9" width="6" height="6" rx="1.5" fill="#2563eb" opacity=".25" />
            </svg>
          </div>
          <div>
            <h2>Welcome to Your SQL Notebook</h2>
            <p>An in-memory relational workbench powered by DuckDB.</p>
          </div>
        </div>

        <hr className="welcome-divider" />

        <div className="suggestions-section">
          <h3> Quick Start Suggestions</h3>
          <ul className="suggestions-list">
            <li>
              <strong>Upload Datasets:</strong> Click the <code>Upload CSV</code> button in the left sidebar to ingest tables into memory.
            </li>
            <li>
              <strong>Execute SQL Queries:</strong> Use the <code>+ SQL Cell</code> button on the top right to start writing raw SQL worksheets.
            </li>
            <li>
              <strong>Drag &amp; Drop VLookup:</strong> Head to the <code>VLOOKUP Builder</code> tab and drag table columns directly into key zones to match sheets without nested formulas.
            </li>
            <li>
              <strong>Pivot Summaries:</strong> Flip over to the <code>PIVOT Builder</code> to dynamically group attributes and summarize structural values.
            </li>
          </ul>
        </div>

      </div>
    </div>
  );
}