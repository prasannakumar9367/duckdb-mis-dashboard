import { useEffect, useMemo, useState } from "react";
import { useDroppable } from "@dnd-kit/core";
import Editor from "@monaco-editor/react";
import "./QueryBuilder.css";
import { useNotebook } from "../../context/useNotebook";

const JOIN_TYPES = ["LEFT JOIN", "INNER JOIN", "RIGHT JOIN", "FULL JOIN"];
const AGGREGATIONS = ["SUM", "COUNT", "AVG", "MIN", "MAX"];

function quoteIdentifier(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}


function buildAliasName(tableName, existingAliases = new Set()) {
  const words = tableName.split(/[^A-Za-z0-9]+/).filter(Boolean);
  let candidate =
    words.length > 0
      ? words.map((word) => word[0].toLowerCase()).join("")
      : "t";
  if (!candidate) candidate = "t";
  let alias = candidate;
  let index = 1;
  while (existingAliases.has(alias)) {
    alias = `${candidate}${index}`;
    index += 1;
  }
  return alias;
}

function fieldKey(field) {
  if (!field) return "";
  return `${field.table}|${field.column}`;
}

function useBuilderSql({
  mode,
  joinType,
  leftJoinField,
  rightJoinField,
  rowFields,
  columnFields,
  valueFields,
  filterFields,
}) {
  return useMemo(() => {
    const selectedFields = [
      ...(rowFields || []),
      ...(columnFields || []),
      ...(valueFields || []),
      ...(filterFields || []),
    ].filter(Boolean);

    const allTables = new Set();
    selectedFields.forEach((field) => allTables.add(field.table));
    if (leftJoinField) allTables.add(leftJoinField.table);
    if (rightJoinField) allTables.add(rightJoinField.table);

    if (mode === "join") {
      if (!leftJoinField || !rightJoinField) {
        return "-- Drag one column into Left Table and one into Right Table to generate a JOIN statement.";
      }

      const aliases = new Map();
      const usedAliases = new Set();
      const leftAlias = buildAliasName(leftJoinField.table, usedAliases);
      usedAliases.add(leftAlias);
      aliases.set(leftJoinField.table, leftAlias);
      let rightAlias = buildAliasName(rightJoinField.table, usedAliases);
      if (leftJoinField.table === rightJoinField.table) {
        rightAlias = buildAliasName(`_${rightJoinField.table}_r`, usedAliases);
      }
      usedAliases.add(rightAlias);
      aliases.set(rightJoinField.table, rightAlias);

      const leftRef = `${leftAlias}.${quoteIdentifier(leftJoinField.column)}`;
      const rightRef = `${rightAlias}.${quoteIdentifier(rightJoinField.column)}`;

      const joinSql = [
        `SELECT`,
        `  *`,
        `FROM ${quoteIdentifier(leftJoinField.table)} ${leftAlias}`,
        `  ${joinType} ${quoteIdentifier(rightJoinField.table)} ${rightAlias}`,
        `    ON ${leftRef} = ${rightRef}`,
        `;`,
      ].join("\n");

      return joinSql;
    }

    if (mode === "pivot") {
      if (!Array.isArray(valueFields) || valueFields.length === 0) {
        return "-- Drag at least one Measures field into Values to generate a pivot query.";
      }
      if (!Array.isArray(columnFields) || columnFields.length === 0) {
        return "-- Drag at least one Columns field to pivot data sideways into an Excel matrix.";
      }

      const selectedTables = new Set(
        selectedFields.map((field) => field.table),
      );
      const hasJoin = leftJoinField && rightJoinField;
      const aliasMap = new Map();
      const usedAliases = new Set();
      const joinAliases = {};

      if (hasJoin) {
        const leftAlias = buildAliasName(leftJoinField.table, usedAliases);
        usedAliases.add(leftAlias);
        aliasMap.set(leftJoinField.table, leftAlias);
        joinAliases.left = leftAlias;

        let rightAlias = buildAliasName(rightJoinField.table, usedAliases);
        if (leftJoinField.table === rightJoinField.table) {
          rightAlias = buildAliasName(
            `_${rightJoinField.table}_r`,
            usedAliases,
          );
        }
        usedAliases.add(rightAlias);
        aliasMap.set(rightJoinField.table, rightAlias);
        joinAliases.right = rightAlias;
      }

      selectedTables.forEach((table) => {
        if (!aliasMap.has(table)) {
          const alias = buildAliasName(table, usedAliases);
          usedAliases.add(alias);
          aliasMap.set(table, alias);
        }
      });

      const fieldReference = (field) => {
        if (!field) return "";
        const alias =
          aliasMap.get(field.table) || buildAliasName(field.table, usedAliases);
        return `${alias}.${quoteIdentifier(field.column)}`;
      };

      const distinctRows = Array.from(
        new Map(rowFields.map((field) => [fieldKey(field), field])).values(),
      );
      const distinctCols = Array.from(
        new Map(columnFields.map((field) => [fieldKey(field), field])).values(),
      );
      const distinctFilters = Array.from(
        new Map(filterFields.map((field) => [fieldKey(field), field])).values(),
      );
      const distinctValues = Array.from(
        new Map(valueFields.map((field) => [fieldKey(field), field])).values(),
      );

 
      const subqueryNameMap = new Map();
      const allocatedNames = new Set();
      const allUniqueFields = [...distinctRows, ...distinctCols, ...distinctValues, ...distinctFilters];

      allUniqueFields.forEach((field) => {
        const key = fieldKey(field);
        if (subqueryNameMap.has(key)) return;

        let candidate = field.column;
        if (allocatedNames.has(candidate)) {
          candidate = `${field.table}_${field.column}`;
        }
        let finalName = candidate;
        let counter = 1;
        while (allocatedNames.has(finalName)) {
          finalName = `${candidate}_${counter}`;
          counter++;
        }
        allocatedNames.add(finalName);
        subqueryNameMap.set(key, finalName);
      });

      const subquerySelectParts = [];
      subqueryNameMap.forEach((finalName, key) => {
        const field = allUniqueFields.find((f) => fieldKey(f) === key);
        const ref = fieldReference(field);
        subquerySelectParts.push(`    ${ref} AS ${quoteIdentifier(finalName)}`);
      });

      const fromParts = [];
      if (hasJoin) {
        const leftTable = leftJoinField.table;
        const rightTable = rightJoinField.table;
        const leftRef = `${joinAliases.left}.${quoteIdentifier(leftJoinField.column)}`;
        const rightRef = `${joinAliases.right}.${quoteIdentifier(rightJoinField.column)}`;
        fromParts.push(
          `  FROM ${quoteIdentifier(leftTable)} ${joinAliases.left}`,
          `    ${joinType} ${quoteIdentifier(rightTable)} ${joinAliases.right}`,
          `      ON ${leftRef} = ${rightRef}`,
        );
      } else if (selectedTables.size > 0) {
        const [table] = selectedTables;
        fromParts.push(`  FROM ${quoteIdentifier(table)} ${aliasMap.get(table)}`);
      } else {
        return "-- Drag a field from a table to start generating pivot SQL.";
      }

      const whereClauses = distinctFilters.map(
        (field) => `${fieldReference(field)} IS NOT NULL`
      );

      const implicitWhere = whereClauses.length > 0
        ? `  WHERE\n    ${whereClauses.join(" AND\n    ")}`
        : "";

      const whereClause = implicitWhere;

      const subquerySql = [
        `  SELECT`,
        subquerySelectParts.join(",\n"),
        ...fromParts,
        whereClause,
      ]
        .filter(Boolean)
        .join("\n");

      const rowNames = distinctRows.map(f => subqueryNameMap.get(fieldKey(f)));
      const colNames = distinctCols.map(f => subqueryNameMap.get(fieldKey(f)));
      const valNames = distinctValues.map(f => subqueryNameMap.get(fieldKey(f)));

      const baseSelect = [...rowNames, ...colNames, ...valNames].map(quoteIdentifier).join(', ');
      
     
      const colTotalsSelect = [
        ...rowNames.map(quoteIdentifier),
        ...colNames.map(name => `'\u200BGrand Total' AS ${quoteIdentifier(name)}`),
        ...valNames.map(quoteIdentifier)
      ].join(', ');

      const rowTotalsSelect = [
        ...rowNames.map(name => `'Grand Total' AS ${quoteIdentifier(name)}`),
        ...colNames.map(quoteIdentifier),
        ...valNames.map(quoteIdentifier)
      ].join(', ');

      const overallTotalsSelect = [
        ...rowNames.map(name => `'Grand Total' AS ${quoteIdentifier(name)}`),
        ...colNames.map(name => `'\u200BGrand Total' AS ${quoteIdentifier(name)}`),
        ...valNames.map(quoteIdentifier)
      ].join(', ');

      const outerOnParts = colNames.map(quoteIdentifier);
      const outerGroupByParts = rowNames.map(quoteIdentifier);
      const outerUsingParts = distinctValues.map((field) => {
        const simpleName = subqueryNameMap.get(fieldKey(field));
        const agg = !!field.agg && AGGREGATIONS.includes(field.agg) ? field.agg : "SUM";
        return `${agg}(${quoteIdentifier(simpleName)})`;
      });

      const sortParts = [
        ...rowNames.map(name => `CASE WHEN ${quoteIdentifier(name)} = 'Grand Total' THEN 1 ELSE 0 END`),
        ...rowNames.map(quoteIdentifier)
      ];

      return [
        `WITH base_metrics AS (`,
        subquerySql,
        `),`,
        `metrics_with_totals AS (`,
        `  SELECT ${baseSelect} FROM base_metrics`,
        `  UNION ALL`,
        `  SELECT ${colTotalsSelect} FROM base_metrics`,
        `  UNION ALL`,
        `  SELECT ${rowTotalsSelect} FROM base_metrics`,
        `  UNION ALL`,
        `  SELECT ${overallTotalsSelect} FROM base_metrics`,
        `)`,
        `PIVOT metrics_with_totals`,
        `ON ${outerOnParts.join(", ")}`,
        outerUsingParts.length > 0 ? `USING ${outerUsingParts.join(", ")}` : "",
        outerGroupByParts.length > 0 ? `GROUP BY ${outerGroupByParts.join(", ")}` : "",
        outerGroupByParts.length > 0 ? `ORDER BY ${sortParts.join(", ")}` : "",
        `;`
      ]
        .filter(Boolean)
        .join("\n");
    }

    return "-- Select a builder tab to start building SQL.";
  }, [
    mode,
    joinType,
    leftJoinField,
    rightJoinField,
    rowFields,
    columnFields,
    valueFields,
    filterFields,
  ]);
}

function BuilderDropZone({
  id,
  label,
  placeholder,
  values = [],
  onRemove,
  accent,
}) {
  const { setNodeRef, isOver } = useDroppable({ id });
  const active = isOver ? "true" : "false";

  return (
    <div
      ref={setNodeRef}
      data-dragging-over={active}
      className="builder-dropzone"
      style={{
        borderColor: accent,
        background: isOver ? "rgba(59, 130, 246, 0.08)" : "transparent",
      }}
    >
      <div className="builder-dropzone__label">{label}</div>
      {values.length === 0 ? (
        <div className="builder-dropzone__placeholder">{placeholder}</div>
      ) : (
        values.map((field) => (
          <div key={fieldKey(field)} className="builder-dropzone__chip">
            <span>{`${field.table}.${field.column}`}</span>
            {field.agg && (
              <span className="builder-dropzone__badge">{field.agg}</span>
            )}
            <button onClick={() => onRemove && onRemove(field)} type="button">
              ×
            </button>
          </div>
        ))
      )}
    </div>
  );
}

export default function QueryBuilder({
  mode,
  setMode,
  joinType,
  setJoinType,
  leftJoinField,
  rightJoinField,
  setLeftJoinField,
  setRightJoinField,
  rowFields,
  setRowFields,
  columnFields,
  setColumnFields,
  valueFields,
  setValueFields,
  filterFields,
  setFilterFields,
  onResetFields,
  onClearJoin,
}) {
  const [sqlText, setSqlText] = useState("");
  const [sqlEdited, setSqlEdited] = useState(false);
  const [copied, setCopied] = useState(false);

  const generatedSql = useBuilderSql({
    mode,
    joinType,
    leftJoinField,
    rightJoinField,
    rowFields,
    columnFields,
    valueFields,
    filterFields,
  });

  const { registerPivotConfig } = useNotebook();

  useEffect(() => {
    if (mode === "pivot") {
      registerPivotConfig({
        sql: generatedSql,
        rowFields: rowFields || [],
        columnFields: columnFields || [],
        valueFields: valueFields || [],
      });
    }
  }, [mode, generatedSql, rowFields, columnFields, valueFields, registerPivotConfig]);


  const handleSqlChange = (value) => {
    setSqlText(value ?? "");
    setSqlEdited(true);
  };

  const handleResetSql = () => {
    setSqlText(generatedSql);
    setSqlEdited(false);
  };

  const displayedSql = sqlEdited ? sqlText : generatedSql;

  const handleCopySql = async () => {
    const textToCopy = displayedSql ?? "";
    if (!textToCopy.trim()) return;
    try {
      await navigator.clipboard.writeText(textToCopy);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch (err) {
      console.warn("Failed to copy generated SQL statement:", err);
    }
  };

  const removeFromList = (field, list, setter) => {
    setter(list.filter((item) => fieldKey(item) !== fieldKey(field)));
  };

  const removeValueField = (field) => {
    setValueFields(
      valueFields.filter((item) => fieldKey(item) !== fieldKey(field)),
    );
  };

  const setValueAgg = (field, agg) => {
    setValueFields(
      valueFields.map((item) => {
        if (fieldKey(item) !== fieldKey(field)) return item;
        return { ...item, agg };
      }),
    );
  };

  

  return (
    <div className="query-builder">
      <div className="query-builder__header">
        <div>
          <h3>PIVOT Builder</h3>
          <p>
            Drag table columns from the sidebar into the builder zones to
            generate DuckDB SQL.
          </p>
        </div>
        <div className="query-builder__meta">
          <button className="btn-secondary" type="button" onClick={onClearJoin}>
            Reset Builder
          </button>
          <button
            className="btn-secondary"
            type="button"
            onClick={onResetFields}
          >
            Clear Fields
          </button>
        </div>
      </div>

      <div className="query-builder__body">
        <div className="query-builder__controls">
          <section className="builder-accordion">
            <button
              type="button"
              className="builder-accordion-header"
              onClick={() => setMode("pivot")}
            >
              <span>{mode === "pivot" ? "▼" : "▶"} Pivot Builder</span>
              <span>{valueFields.length} measures</span>
            </button>
            {mode === "pivot" && (
              <div className="builder-accordion-body">
                <BuilderDropZone
                  id="pivot-rows"
                  label="Rows"
                  placeholder="Drop row fields"
                  values={rowFields}
                  onRemove={(field) =>
                    removeFromList(field, rowFields, setRowFields)
                  }
                 accentColor="#1d4ed8"
                />
                <BuilderDropZone
                  id="pivot-columns"
                  label="Columns"
                  placeholder="Drop column fields"
                  values={columnFields}
                  onRemove={(field) =>
                    removeFromList(field, columnFields, setColumnFields)
                  }
                   accentColor="#7c3aed"
                />
                <BuilderDropZone
                  id="pivot-values"
                  label="Values"
                  placeholder="Drop value fields"
                  values={valueFields}
                  onRemove={removeValueField}
                 accentColor="#059669"
                />
                <BuilderDropZone
                  id="pivot-filters"
                  label="Filters"
                  placeholder="Drop filter fields"
                  values={filterFields}
                  onRemove={(field) =>
                    removeFromList(field, filterFields, setFilterFields)
                  }
                  accentColor="#f97316"
                />
                {(rowFields.length > 1 || columnFields.length > 1 || valueFields.length > 1) && (
                  <div className="builder-warning">
                    Multiple row/column/value fields are supported through deep cross-tab mapping vectors.
                  </div>
                )}
                {valueFields.length > 0 && (
                  <div className="builder-agg-list">
                    {valueFields.map((field) => (
                      <label key={fieldKey(field)} className="builder-agg-item">
                        <span>{`${field.table}.${field.column}`}</span>
                        <select
                          value={field.agg || "SUM"}
                          onChange={(e) => setValueAgg(field, e.target.value)}
                        >
                          {AGGREGATIONS.map((agg) => (
                            <option key={agg} value={agg}>
                              {agg}
                            </option>
                          ))}
                        </select>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            )}
          </section>

          <section className="builder-accordion">
            <button
              type="button"
              className="builder-accordion-header"
              onClick={() => setMode("join")}
            >
              <span>{mode === "join" ? "▼" : "▶"} Join Builder</span>
              <span>
                {leftJoinField && rightJoinField ? "Connected" : "Empty"}
              </span>
            </button>
            {mode === "join" && (
              <div className="builder-accordion-body">
                <div className="builder-card__grid">
                  <div className="builder-card__item">
                    <BuilderDropZone
                      id="join-left"
                      label="Left Table"
                      placeholder="Drop left table column here"
                      values={leftJoinField ? [leftJoinField] : []}
                      onRemove={() => setLeftJoinField(null)}
                      accentColor="#3b82f6"
                    />
                  </div>
                  <div className="builder-card__item">
                    <BuilderDropZone
                      id="join-right"
                      label="Right Table"
                      placeholder="Drop right table column here"
                      values={rightJoinField ? [rightJoinField] : []}
                      onRemove={() => setRightJoinField(null)}
                      accentColor="#8b5cf6"
                    />
                  </div>
                </div>
                <div className="builder-card__row">
                  <label htmlFor="join-type">Join Type</label>
                  <select
                    id="join-type"
                    value={joinType}
                    onChange={(e) => setJoinType(e.target.value)}
                  >
                    {JOIN_TYPES.map((type) => (
                      <option key={type} value={type}>
                        {type}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            )}
          </section>

          
        </div>

        <div className="query-builder__preview">
          <div className="builder-card builder-card--sql">
            <div className="builder-card__title">Generated SQL</div>

            <div className="monaco-wrapper">
              <Editor
                height="100%"
                language="sql"
                value={displayedSql}
                onChange={handleSqlChange}
                options={{
                  minimap: { enabled: false },
                  fontSize: 12,
                  lineNumbers: "on",
                  scrollBeyondLastLine: false,
                  automaticLayout: true,
                  wordWrap: "on",
                }}
              />
            </div>

            <div className="sql-action-bar">
              <button
                type="button"
                onClick={handleCopySql}
                disabled={!displayedSql || !displayedSql.trim()}
                className="btn-primary"
                style={{ background: copied ? "#16a34a" : "#111827", transition: "background 0.15s ease" }}
              >
                {copied ? "Copied!" : "Copy SQL"}
              </button>

              <button
                type="button"
                className="btn-secondary"
                onClick={handleResetSql}
                disabled={!sqlEdited}
              >
                Reset SQL
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}