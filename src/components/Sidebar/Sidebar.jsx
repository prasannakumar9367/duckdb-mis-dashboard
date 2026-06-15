import { useState } from "react";
import { useDraggable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import CommonModal from "../CommonModal/CommonModal";
import "./Sidebar.css";

function formatCount(n) {
  if (n >= 100000) return (n / 100000).toFixed(1) + "L";
  if (n >= 1000) return (n / 1000).toFixed(1) + "K";
  return n;
}

function DraggableColumn({ tableName, column, type }) {
  const id = `${tableName}|${column}`;
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({ id });
  const style = {
    transform: CSS.Translate.toString(transform),
    opacity: isDragging ? 0.45 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="col-item col-draggable"
      {...listeners}
      {...attributes}
      title={`Drag ${tableName}.${column}`}
    >
      <span className="col-name">{column}</span>
      <span className="col-type">{type}</span>
    </div>
  );
}

export default function Sidebar({
  files = [],
  tables = [],
  dbReady = false,
  uploadingFiles = false,
  onUpload,
  onTableClick,
  onDeleteFile,
  onDeleteTable,
  onClearWorkspace,
  targetTableName = null,
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

    const matchingExistingFile = files.find(
      (f) => (typeof f === "string" ? f : f.name) === incomingName,
    );
    if (matchingExistingFile) {
      setModalConfig({
        open: true,
        type: "warning",
        title: "Duplicate Table Conflict",
        message: `A file named "${incomingName}" already exists. Uploading this will safely replace the old table metrics and automatically re-run your active updates. Proceed?`,
        confirmText: "Replace & Auto-Run",
        onConfirm: async () => {
          closeModal();
          if (onDeleteFile) await onDeleteFile(matchingExistingFile);
          if (onUpload) onUpload(filesSnapshot, { isAutoUpdateOverride: true });
        },
      });
      return;
    }

    if (tables.length >= 2) {
      let evictIndex = tables.length - 1;
      if (targetTableName) {
        const masterIndex = tables.findIndex((t) => {
          const name = typeof t === "string" ? t : t.name;
          return name === targetTableName;
        });
        if (masterIndex === 1) evictIndex = 0;
      }

      const tableToEvict = tables[evictIndex];
      const correspondingFileToEvict = files[evictIndex];

      setModalConfig({
        open: true,
        type: "warning",
        title: "Workspace Cap Warning",
        message: `To accommodate this upload while safeguarding your Master configuration, "${tableToEvict.name || tableToEvict}" will be cleanly released from memory.`,
        confirmText: "Proceed",
        onConfirm: async () => {
          closeModal();
          if (onDeleteTable && tableToEvict) await onDeleteTable(tableToEvict);
          if (onDeleteFile && correspondingFileToEvict)
            await onDeleteFile(correspondingFileToEvict);
          if (onUpload) onUpload(filesSnapshot);
        },
      });
      return;
    }

    if (onUpload) onUpload(filesSnapshot);
  };


  const triggerDeleteFileModal = (e, file) => {
    e.stopPropagation();
    const fileName = typeof file === "string" ? file : file.name;

    setModalConfig({
      open: true,
      type: "warning",
      title: "Remove File Dependency",
      message: `Are you sure you want to delete the file "${fileName}"? `,
      confirmText: "Delete File",
      onConfirm: () => {
        if (onDeleteFile) onDeleteFile(file);
        closeModal();
      },
    });
  };

  const triggerDeleteTableModal = (e, table) => {
    e.stopPropagation();
    const tableName = typeof table === "string" ? table : table.name;

    setModalConfig({
      open: true,
      type: "warning",
      title: "Drop Database Table",
      message: `Are you sure you want to execute a DROP table command on "${tableName}"? `,
      confirmText: "Drop Table",
      onConfirm: () => {
        if (onDeleteTable) onDeleteTable(table);
        closeModal();
      },
    });
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
          <div
            className={`db-indicator ${dbReady ? "ready" : "loading"}`}
            title={dbReady ? "DuckDB ready" : "Initializing DuckDB..."}
          />
        </div>

        <div className="sidebar-body">
          <label className={`upload-btn ${uploadingFiles ? "uploading" : ""}`}>
            {uploadingFiles ? (
              <>
                <span className="upload-spinner" /> Uploading…
              </>
            ) : (
              <>
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path
                    d="M8 11V3M4 6l4-4 4 4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <path d="M2 13h12" strokeLinecap="round" />
                </svg>
                Upload CSV
              </>
            )}
            <input
              type="file"
              accept=".csv"
              hidden
              disabled={uploadingFiles || !dbReady}
              onChange={(e) => {
                handleInterceptedUpload(e.target.files);
                e.target.value = ""; 
              }}
            />
          </label>

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
                <div
                  key={`file-${idx}-${fileName}`}
                  className="file-item"
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}
                >
                  <div className="file-content">
                    <span>{fileName}</span>
                  </div>
                  <button
                    type="button"
                    className="icon-btn icon-btn-danger"
                    title="Delete file"
                    onClick={(e) => triggerDeleteFileModal(e, file)}
                    style={{
                      background: "none",
                      border: "none",
                      color: "#dc2626",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      padding: "4px",
                    }}
                  >
                    <svg
                      viewBox="0 0 16 16"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      style={{ width: "14px", height: "14px" }}
                    >
                      <path
                        d="M3 4h10M6 4V3h4v1M5 4l.5 9h5l.5-9"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </button>
                </div>
              );
            })
          )}

          <div className="section-header" style={{ marginTop: 12 }}>
            <span>DuckDB Tables</span>
            <span className="section-count">{tables.length}</span>
          </div>
          {tables.length === 0 ? (
            <div className="empty-hint">Tables appear after upload</div>
          ) : (
            tables.map((table, idx) => {
              const tableName = typeof table === "string" ? table : table.name;
              const rowCount =
                typeof table === "object" && table.rowCount
                  ? table.rowCount
                  : 0;
              return (
                <div key={`table-${idx}-${tableName}`} className="table-group">
                  <div
                    className="table-item"
                    onClick={() => onTableClick && onTableClick(tableName)}
                  >
                    <span className="table-name">{tableName}</span>
                    <div
                      className="table-actions"
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "4px",
                      }}
                    >
                      {rowCount > 0 && (
                        <span className="table-badge">
                          {formatCount(rowCount)}
                        </span>
                      )}
                      <button
                        type="button"
                        className="table-expand-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          setExpandedTable(
                            expandedTable === tableName ? null : tableName,
                          );
                        }}
                      >
                        ▼
                      </button>

                      <button
                        type="button"
                        className="icon-btn icon-btn-danger"
                        title="Drop table"
                        onClick={(e) => triggerDeleteTableModal(e, table)}
                        style={{
                          background: "none",
                          border: "none",
                          color: "#dc2626",
                          cursor: "pointer",
                          display: "flex",
                          alignItems: "center",
                          padding: "4px",
                        }}
                      >
                        <svg
                          viewBox="0 0 16 16"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.5"
                          style={{ width: "14px", height: "14px" }}
                        >
                          <path
                            d="M3 4h10M6 4V3h4v1M5 4l.5 9h5l.5-9"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      </button>
                    </div>
                  </div>
                  {expandedTable === tableName && table.columns && (
                    <div className="col-list">
                      {table.columns.map((col, cIdx) => (
                        <DraggableColumn
                          key={`col-${cIdx}-${col.name}`}
                          tableName={tableName}
                          column={col.name}
                          type={col.type}
                        />
                      ))}
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