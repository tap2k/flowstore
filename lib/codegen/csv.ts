// Minimal CSV primitives shared by every spec-side round-trip (scripts,
// glossary, FAQ, table rows). RFC 4180-ish: comma-separated, CRLF line
// breaks, fields containing comma/quote/newline are quoted with "" escape.
// Excel-friendly BOM is stripped on read.

export function csvEscape(val: string): string {
  if (!/[",\r\n]/.test(val)) return val;
  return `"${val.replace(/"/g, '""')}"`;
}

export function csvSerialize(rows: string[][]): string {
  return rows.map((r) => r.map(csvEscape).join(",")).join("\r\n");
}

export function parseCsv(text: string): string[][] {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (ch === ",") {
      row.push(field);
      field = "";
      i++;
      continue;
    }
    if (ch === "\r") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i++;
      if (text[i] === "\n") i++;
      continue;
    }
    if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i++;
      continue;
    }
    field += ch;
    i++;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}
