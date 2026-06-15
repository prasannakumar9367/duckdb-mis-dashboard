import React from "react";
import { useDroppable } from "@dnd-kit/core";

export default function VLookupDropZone({
  id,
  label,
  placeholder,
  value,
  onRemove,
  accentColor,
  badge,
}) {
  const { setNodeRef, isOver } = useDroppable({ id });
  const items = Array.isArray(value) ? value : [];

  return (
    <div
      ref={setNodeRef}
      className={`vlb-dropzone${isOver ? " vlb-dropzone--over" : ""}${
        items.length > 0 ? " vlb-dropzone--filled" : ""
      }`}
    >
      <div className="vlb-dropzone__label" style={{ color: accentColor }}>
        {label}
        {badge && <span className="vlb-dropzone__badge">{badge}</span>}
      </div>

      {items.length > 0 ? (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
          {items.map((item, index) => (
            <div
              key={`vlb-chip-${item.table}-${item.column}-${index}`}
              className="vlb-dropzone__chip"
            >
              <span className="vlb-dropzone__chip-text">
                {item.table}.{item.column}
              </span>
              <button
                type="button"
                className="vlb-dropzone__chip-clear"
                onClick={() => onRemove(index)}
                aria-label={`Remove ${item.column}`}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      ) : (
        <div className="vlb-dropzone__placeholder">{placeholder}</div>
      )}
    </div>
  );
}
