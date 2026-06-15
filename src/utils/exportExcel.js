import * as XLSX from "xlsx";

export function exportExcel(rows, fileName = "result.xlsx") {
  if (!rows || !rows.length) return;

  const worksheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();

  XLSX.utils.book_append_sheet(workbook, worksheet, "Results");
  XLSX.writeFile(workbook, fileName);
}