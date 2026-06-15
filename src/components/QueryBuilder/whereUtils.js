export function buildWhereClause(whereConditions = [], aliasMap = new Map(), tables = []) {
  if (!Array.isArray(whereConditions) || whereConditions.length === 0) return "";

  const clauses = [];

  const quoteIdentifier = (value) => `"${String(value).replace(/"/g, '""')}"`;
  const escapeLiteral = (val) => String(val).replace(/'/g, "''");

  const getColumnType = (tableName, columnName) => {
    if (!Array.isArray(tables)) return null;
    const t = tables.find((t) => t.name === tableName || t === tableName);
    if (!t || !t.columns) return null;
    const col = t.columns.find((c) => c.name === columnName || c.name === columnName);
    return col ? (col.type || null) : null;
  };

  whereConditions.forEach((cond) => {
    if (!cond || !cond.table || !cond.column) return;
    const operator = (cond.operator || "=").toUpperCase();
    const alias = aliasMap && aliasMap.get(cond.table) ? aliasMap.get(cond.table) : null;
    const colRef = alias ? `${alias}.${quoteIdentifier(cond.column)}` : `${quoteIdentifier(cond.table)}.${quoteIdentifier(cond.column)}`;

    if (operator === 'IS NULL' || operator === 'IS NOT NULL') {
      clauses.push({ text: `${colRef} ${operator}`, connector: cond.connector || 'AND' });
      return;
    }

    let rawValue = cond.value ?? '';
    if (operator === 'IN' || operator === 'NOT IN') {
      const parts = String(rawValue).split(',').map(p => p.trim()).filter(Boolean);
      if (parts.length === 0) return;
      const tokens = parts.map((p) => {
        if (!isNaN(Number(p))) return String(Number(p));
        return `'${escapeLiteral(p)}'`;
      });
      clauses.push({ text: `${colRef} ${operator} (${tokens.join(',')})`, connector: cond.connector || 'AND' });
      return;
    }

    if (rawValue === '' || rawValue === null || rawValue === undefined) return;

    const colType = getColumnType(cond.table, cond.column);
    const needsQuote = colType ? /char|text|varchar|date|timestamp|uuid/i.test(colType) : isNaN(Number(rawValue));
    const valText = needsQuote ? `'${escapeLiteral(rawValue)}'` : String(Number(rawValue));
    clauses.push({ text: `${colRef} ${operator} ${valText}`, connector: cond.connector || 'AND' });
  });

  if (clauses.length === 0) return "";

  const lines = [];
  clauses.forEach((c, i) => {
    if (i === 0) {
      lines.push(`WHERE ${c.text}`);
    } else {
      lines.push(`  ${c.connector} ${c.text}`);
    }
  });

  return lines.join('\n');
}
