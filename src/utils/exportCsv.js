export function exportCSV(
  rows,
  fileName = "results.csv"
) {
  if (!rows.length) return;

  const headers =
    Object.keys(rows[0]);

  const csv = [
    headers.join(","),
    ...rows.map((row) =>
      headers
        .map((h) => row[h])
        .join(",")
    ),
  ].join("\n");

  const blob =
    new Blob(
      [csv],
      {
        type:
          "text/csv;charset=utf-8;",
      }
    );

  const link =
    document.createElement("a");

  link.href =
    URL.createObjectURL(blob);

  link.download =
    fileName;

  link.click();
}