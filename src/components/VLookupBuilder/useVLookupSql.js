import { useMemo } from "react";

function quoteIdentifier(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function buildAliasName(tableName, existingAliases = new Set()) {
  const words = tableName.split(/[^A-Za-z0-9]+/).filter(Boolean);
  let candidate =
    words.length > 0 ? words.map((w) => w[0].toLowerCase()).join("") : "t";
  if (!candidate) candidate = "t";
  let alias = candidate;
  let index = 1;
  while (existingAliases.has(alias)) {
    alias = `${candidate}${index}`;
    index++;
  }
  return alias;
}

export function useVLookupSql({
  mode,
  joinType,
  lookupField,
  matchField,
  returnField,
  leftJoinField,
  rightJoinField,
  whereSql,
}) {
  return useMemo(() => {
    const lookups = Array.isArray(lookupField) ? lookupField : [];
    const matches = Array.isArray(matchField) ? matchField : [];
    const returns = Array.isArray(returnField) ? returnField : [];

    const sourceTable = lookups[0]?.table || null;
    const targetTable = matches[0]?.table || null;
    const sourceKey = lookups[0]?.column || null;
    const targetKey = matches[0]?.column || null;

    if (mode === "update") {
      if (
        !sourceTable ||
        !targetTable ||
        !sourceKey ||
        !targetKey ||
        returns.length === 0
      ) {
        const missing = [];
        if (!sourceKey) missing.push("SOURCE KEY");
        if (!targetKey) missing.push("TARGET KEY");
        if (returns.length === 0) missing.push("UPDATE COLUMN(S)");
        return `-- Still needed for Update Master: ${missing.join(", ")}`;
      }

      // ── 🎯 FIXED: Removed "target." prefix from the left-hand side column definition ──
      const updateSetSql = returns
        .map((f) => `    ${quoteIdentifier(f.column)} = source.${quoteIdentifier(f.column)}`)
        .join(",\n");

      const insertTargetCols = [targetKey, ...returns.map((f) => f.column)]
        .map(quoteIdentifier)
        .join(", ");

      const selectSourceCols = [sourceKey, ...returns.map((f) => f.column)]
        .map(quoteIdentifier)
        .join(", ");

      // Generates sequential transactional statements separated by semicolons.
      return [
        `UPDATE ${quoteIdentifier(targetTable)} AS target`,
        `SET`,
        updateSetSql,
        `FROM ${quoteIdentifier(sourceTable)} AS source`,
        `WHERE target.${quoteIdentifier(targetKey)} = source.${quoteIdentifier(sourceKey)};`,
        `CREATE TEMP TABLE temp_vlookup_new_records AS `,
        `SELECT source.* FROM ${quoteIdentifier(sourceTable)} AS source`,
        `LEFT JOIN ${quoteIdentifier(targetTable)} AS target`,
        `  ON source.${quoteIdentifier(sourceKey)} = target.${quoteIdentifier(targetKey)}`,
        `WHERE target.${quoteIdentifier(targetKey)} IS NULL;`,
        `INSERT INTO ${quoteIdentifier(targetTable)} (${insertTargetCols})`,
        `SELECT ${selectSourceCols} FROM temp_vlookup_new_records;`,
        `DROP TABLE temp_vlookup_new_records;`
      ].join("\n");
    }

    if (lookups.length > 0 || matches.length > 0 || returns.length > 0) {
      const missing = [];
      if (lookups.length === 0) missing.push("SOURCE KEY(s)");
      if (matches.length === 0) missing.push("TARGET KEY(s)");
      if (returns.length === 0) missing.push("UPDATE COLUMN(s)");
      if (missing.length > 0) {
        return `-- Still needed for Preview Join: ${missing.join(", ")}`;
      }

      const returnColumnsSql = returns
        .map((f) => `  m.${quoteIdentifier(f.column)}`)
        .join(",\n");

      const joinConditionsSql = lookups
        .map((f, i) => {
          const matchF = matches[i] || matches[0];
          const prefix = i === 0 ? "    ON" : "   AND";
          return `${prefix} s.${quoteIdentifier(f.column)} = m.${quoteIdentifier(matchF.column)}`;
        })
        .join("\n");

      return [
        `SELECT`,
        `  s.*,`,
        returnColumnsSql,
        `FROM ${quoteIdentifier(sourceTable)} s`,
        `LEFT JOIN ${quoteIdentifier(targetTable)} m`,
        joinConditionsSql,
        whereSql && whereSql.trim() ? `WHERE ${whereSql}` : "",
      ]
        .filter(Boolean)
        .join("\n") + ";";
    }

    if (leftJoinField && rightJoinField) {
      const used = new Set();
      const la = buildAliasName(leftJoinField.table, used);
      used.add(la);
      const rightTableName =
        leftJoinField.table === rightJoinField.table
          ? `_${rightJoinField.table}_r`
          : rightJoinField.table;
      const ra = buildAliasName(rightTableName, used);

      return [
        `SELECT *`,
        `FROM ${quoteIdentifier(leftJoinField.table)} ${la}`,
        `  ${joinType} ${quoteIdentifier(rightJoinField.table)} ${ra}`,
        `    ON ${la}.${quoteIdentifier(leftJoinField.column)} = ${ra}.${quoteIdentifier(rightJoinField.column)};`,
      ].join("\n");
    }

    return "-- Drag columns into the zones above to generate your query.";
  }, [
    mode,
    joinType,
    lookupField,
    matchField,
    returnField,
    leftJoinField,
    rightJoinField,
    whereSql,
  ]);
}