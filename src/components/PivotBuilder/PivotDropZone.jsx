import { useDroppable } from "@dnd-kit/core";

export default function PivotDropZone({ id, label, field, onClear, accent = "#3b82f6" }) {
  const { setNodeRef, isOver } = useDroppable({ id });

  return (
    <div
      ref={setNodeRef}
      className={`pivot-dropzone${isOver ? " pivot-dropzone--over" : ""}${field ? " pivot-dropzone--filled" : ""}`}
      style={{ "--dz-accent": accent }}
    >
      <span className="pivot-dropzone__label">{label}</span>
      {field ? (
        <div className="pivot-dropzone__chip">
          <span className="pivot-dropzone__chip-name">{field.table}.{field.column}</span>
          <button
            type="button"
            className="pivot-dropzone__clear"
            onClick={onClear}
            title={`Remove ${field.column}`}
          >
            ×
          </button>
        </div>
      ) : (
        <div className="pivot-dropzone__placeholder">Drop a column here</div>
      )}
    </div>
  );
}