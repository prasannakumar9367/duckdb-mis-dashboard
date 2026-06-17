import { useState } from "react";
import CommonModal from "../CommonModal/CommonModal";
import "./Sidebar.css";

function formatCount(value) {
  if (typeof value !== "number") return "0";
  if (value >= 100000) return `${(value / 100000).toFixed(1)}L`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}K`;
  return `${value}`;
}

export default function Sidebar({
  files = [],
  tables = [],
  uploadingFiles = false,
  uploadProgress = 0,
  uploadStatus = "",
  onUpload,
  onTableClick,
  onDeleteFile,
  onDeleteTable,
  onClearWorkspace,
}) {
  const [expandedTable, setExpandedTable] = useState(null);
  const [modalConfig, setModalConfig] = useState({
    open: false,
    type: "warning",
    title: "",
    message: "",
    confirmText: "OK",
    onConfirm: null,
  });

  const closeModal = () => setModalConfig((prev) => ({ ...prev, open: false }));

  const handleInterceptedUpload = async (fileList) => {
    if (!fileList || fileList.length === 0) return;

    const filesSnapshot = Array.from(fileList);
    const incomingFile = filesSnapshot[0];
    const incomingName = incomingFile.name;

    const duplicateFile = files.find(
      (file) => (typeof file === "string" ? file : file.name) === incomingName,
    );

    if (duplicateFile) {
      setModalConfig({
        open: true,
        type: "warning",
        title: "Duplicate File Detected",
        message: `File '${incomingName}' already exists. Replace it?`,
        confirmText: "Replace",
        onConfirm: async () => {
          closeModal();
          if (onUpload) onUpload(filesSnapshot, { isAutoUpdateOverride: true });
        },
      });
      return;
    }

    if (onUpload) onUpload(filesSnapshot);
  };

  return (
    <>
      <div className="sidebar">
        <div className="sidebar-brand">
          <svg width="30" height="30" viewBox="0 0 16 16" fill="none">
            <rect x="1" y="1" width="6" height="6" rx="1.5" fill="#3b82f6" />
            <rect x="9" y="1" width="6" height="6" rx="1.5" fill="#3b82f6" opacity=".5" />
            <rect x="1" y="9" width="6" height="6" rx="1.5" fill="#3b82f6" opacity=".5" />
            <rect x="9" y="9" width="6" height="6" rx="1.5" fill="#3b82f6" opacity=".25" />
          </svg>
          <span>Notebook</span>
        </div>

        <div className="sidebar-body">
          <label className={`upload-btn ${uploadingFiles ? "uploading" : ""}`}>
            <input
              type="file"
              accept=".csv"
              hidden
              disabled={uploadingFiles}
              onChange={(e) => {
                handleInterceptedUpload(e.target.files);
                e.target.value = "";
              }}
            />
            <svg
              width="12"
              height="12"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M8 11V3M4 6l4-4 4 4" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M2 13h12" strokeLinecap="round" />
            </svg>
            {uploadingFiles ? "Uploading…" : "Upload CSV"}
          </label>

          {uploadingFiles && (
            <div className="upload-progress-card">
              <div className="upload-progress-label">{uploadStatus}</div>
              <div className="upload-progress-track">
                <div
                  className="upload-progress-track__fill"
                  style={{ width: `${uploadProgress}%`, transition: "width 0.2s ease" }}
                />
              </div>
              <div className="upload-progress-footer">
                <span>{uploadProgress}%</span>
              </div>
            </div>
          )}

          <div className="section-header">
            <span>Uploaded Files</span>
            <span className="section-count">{files.length}</span>
          </div>

          {files.length === 0 ? (
            <div className="empty-hint">No files uploaded yet</div>
          ) : (
            files.map((file, idx) => {
              const fileName = typeof file === "string" ? file : file.name;
              return (
                <div key={`file-${idx}-${fileName}`} className="file-item">
                  <div className="file-content">
                    <span>{fileName}</span>
                  </div>
                  <button
                    type="button"
                    className="icon-btn icon-btn-danger"
                    title="Delete file"
                    onClick={(e) => onDeleteFile?.(typeof file === "string" ? file : file)}
                  >
                    ×
                  </button>
                </div>
              );
            })
          )}

          <div className="section-header" style={{ marginTop: 14 }}>
            <span>DuckDB Tables</span>
            <span className="section-count">{tables.length}</span>
          </div>

          {tables.length === 0 ? (
            <div className="empty-hint">Tables appear after upload</div>
          ) : (
            tables.map((table, idx) => {
              const tableName = table?.name || String(table);
              const rowCount = table?.rowCount ?? 0;
              const columns = Array.isArray(table?.columns) ? table.columns : [];

              return (
                <div key={`table-${idx}-${tableName}`} className="table-group">
                  <div
                    className="table-item"
                    onClick={() => onTableClick?.(tableName)}
                    role="button"
                    tabIndex={0}
                  >
                    <div className="table-title-row">
                      <span className="table-name">{tableName}</span>
                      <span className="table-badge">{rowCount.toLocaleString()}</span>
                    </div>
                    <div className="table-actions">
                      <button
                        type="button"
                        className="table-expand-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          setExpandedTable(expandedTable === tableName ? null : tableName);
                        }}
                      >
                        {expandedTable === tableName ? "▲" : "▼"}
                      </button>
                      <button
                        type="button"
                        className="icon-btn icon-btn-danger"
                        title="Drop table"
                        onClick={(e) => {
                          e.stopPropagation();
                          onDeleteTable?.(table);
                        }}
                      >
                        ×
                      </button>
                    </div>
                  </div>

                  {expandedTable === tableName && (
                    <div className="col-list">
                      {columns.length === 0 ? (
                        <div className="empty-hint">No columns available</div>
                      ) : (
                        columns.map((column, cIdx) => {
                          const colName = column?.name ?? String(column);
                          const colType = column?.type ?? "unknown";

                          return (
                            <div
                              key={`col-${cIdx}-${colName}`}
                              className="col-item col-draggable"
                              draggable
                              onDragStart={(event) => {
                                event.dataTransfer.setData(
                                  "application/json",
                                  JSON.stringify({
                                    tableName,
                                    columnName: colName,
                                    columnType: colType,
                                  }),
                                );
                                event.dataTransfer.effectAllowed = "copy";
                              }}
                            >
                              <span className="col-name">{colName}</span>
                              <span className="col-type">{colType}</span>
                            </div>
                          );
                        })
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        <div className="sidebar-footer">
          <button type="button" className="clear-btn" onClick={() => onClearWorkspace?.()}>
            Clear Workspace
          </button>
        </div>
      </div>

      <CommonModal
        open={modalConfig.open}
        type={modalConfig.type}
        title={modalConfig.title}
        message={modalConfig.message}
        confirmText={modalConfig.confirmText}
        showCancel={true}
        onClose={closeModal}
        onConfirm={modalConfig.onConfirm}
      />
    </>
  );
}
