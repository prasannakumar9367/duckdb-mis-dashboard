export const AGGREGATIONS = ["SUM", "COUNT", "AVG", "MIN", "MAX"];

const NULL_KEY = "NULL";

const sanitizeKey = (value) => {
  if (value === null || value === undefined) return NULL_KEY;
  const normalized = String(value).trim();
  return normalized === "" ? NULL_KEY : normalized;
};

const parseNumber = (value) => {
  if (typeof value === "number") return Number.isFinite(value) ? value : NaN;
  if (value === null || value === undefined || String(value).trim() === "") return NaN;
  const cleaned = String(value).trim().replace(/,/g, "");
  const numeric = Number(cleaned);
  return Number.isFinite(numeric) ? numeric : NaN;
};

const initCell = () => ({ sum: 0, count: 0, min: null, max: null });

const getCellValue = (cell, aggFn) => {
  if (!cell || cell.count === 0) return undefined;
  switch (aggFn) {
    case "COUNT":
      return cell.count;
    case "SUM":
      return cell.sum;
    case "AVG":
      return cell.count > 0 ? cell.sum / cell.count : undefined;
    case "MIN":
      return cell.min;
    case "MAX":
      return cell.max;
    default:
      return undefined;
  }
};

export function buildPivot(data = [], rowField, colField, valueField, aggFn = "SUM") {
  if (!rowField || !valueField || !Array.isArray(data) || data.length === 0) {
    return null;
  }

  const rowKeys = [];
  const colKeys = [];
  const rowSeen = new Set();
  const colSeen = new Set();
  const cells = {};

  const getCell = (rowKey, colKey) => {
    if (!cells[rowKey]) cells[rowKey] = {};
    if (!cells[rowKey][colKey]) cells[rowKey][colKey] = initCell();
    return cells[rowKey][colKey];
  };

  for (const row of data) {
    const rowKey = sanitizeKey(row[rowField]);
    const colKey = colField ? sanitizeKey(row[colField]) : valueField;

    if (!rowSeen.has(rowKey)) {
      rowSeen.add(rowKey);
      rowKeys.push(rowKey);
    }
    if (!colSeen.has(colKey)) {
      colSeen.add(colKey);
      colKeys.push(colKey);
    }

    const cell = getCell(rowKey, colKey);
    if (aggFn === "COUNT") {
      cell.count += 1;
      continue;
    }

    const numeric = parseNumber(row[valueField]);
    if (!Number.isFinite(numeric)) continue;

    cell.count += 1;
    cell.sum += numeric;
    cell.min = cell.min === null ? numeric : Math.min(cell.min, numeric);
    cell.max = cell.max === null ? numeric : Math.max(cell.max, numeric);
  }

  const finalCells = {};
  const rowTotals = {};
  const colTotals = {};
  let grandTotal = 0;

  for (const rowKey of rowKeys) {
    const rowGroup = {};
    let rowTotal = 0;
    for (const colKey of colKeys) {
      const value = getCellValue(cells[rowKey]?.[colKey], aggFn);
      if (value !== undefined) rowTotal += value;
      rowGroup[colKey] = value;
    }
    finalCells[rowKey] = rowGroup;
    rowTotals[rowKey] = rowTotal;
    grandTotal += rowTotal;
  }

  for (const colKey of colKeys) {
    let colTotal = 0;
    for (const rowKey of rowKeys) {
      const value = finalCells[rowKey]?.[colKey];
      if (value !== undefined) colTotal += value;
    }
    colTotals[colKey] = colTotal;
  }

  return {
    rowKeys,
    colKeys,
    cells: finalCells,
    rowTotals,
    colTotals,
    grandTotal,
  };
}

export function formatValue(value, aggFn) {
  if (value === undefined || value === null) return "";
  if (aggFn === "COUNT") return String(value);
  if (typeof value === "number") {
    if (Number.isInteger(value)) return value.toLocaleString();
    return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
  }
  return String(value);
}
