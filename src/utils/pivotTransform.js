export function pivotTransform(data, rowField, columnField, valueField, aggregation = "SUM") {
  if (!Array.isArray(data) || data.length === 0) return [];
  if (!rowField || !columnField || !valueField) return data;

  const rowKey = rowField;
  const colKey = columnField;
  const valKey = valueField;

  const cols = new Set();
  const map = new Map();

  for (const r of data) {
    const rk = r[rowKey];
    const ck = r[colKey];
    const v = r[valKey];

    cols.add(ck);

    if (!map.has(rk)) {
      map.set(rk, { __row: rk, __cells: new Map() });
    }
    const entry = map.get(rk);

    const cell = entry.__cells.get(ck) || { sum: 0, count: 0, min: null, max: null };
    const num = typeof v === "number" ? v : 0;

    if (aggregation === "COUNT") {
      cell.count = (cell.count || 0) + 1;
    } else if (aggregation === "SUM") {
      cell.sum = (cell.sum || 0) + num;
    } else if (aggregation === "AVG") {
      cell.sum = (cell.sum || 0) + num;
      cell.count = (cell.count || 0) + 1;
    } else if (aggregation === "MIN") {
      cell.min = cell.min == null ? num : Math.min(cell.min, num);
    } else if (aggregation === "MAX") {
      cell.max = cell.max == null ? num : Math.max(cell.max, num);
    } else {
      cell.sum = (cell.sum || 0) + num;
    }

    entry.__cells.set(ck, cell);
  }

  const colList = Array.from(cols).sort();
  const out = [];
  for (const [rk, entry] of map.entries()) {
    const rowObj = {};
    rowObj[rowKey] = rk;
    for (const c of colList) {
      const cell = entry.__cells.get(c) || { sum: 0, count: 0, min: null, max: null };
      const val = (aggregation === "COUNT") ? (cell.count || 0)
        : (aggregation === "SUM") ? (cell.sum || 0)
        : (aggregation === "AVG") ? (cell.count ? (cell.sum || 0) / cell.count : 0)
        : (aggregation === "MIN") ? (cell.min == null ? 0 : cell.min)
        : (aggregation === "MAX") ? (cell.max == null ? 0 : cell.max)
        : (cell.sum || 0);
      rowObj[c] = val;
    }
    out.push(rowObj);
  }

  return out;
}

export default pivotTransform;
