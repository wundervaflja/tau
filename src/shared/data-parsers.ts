/**
 * Simple CSV parser -- handles quoted fields, no external deps.
 */
export function parseCSV(text: string, delimiter = ','): { headers: string[]; rows: string[][] } {
  const lines = text.split('\n').filter(l => l.trim());
  if (lines.length === 0) return { headers: [], rows: [] };

  const splitRow = (line: string): string[] => {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;
    for (const char of line) {
      if (char === '"') { inQuotes = !inQuotes; continue; }
      if (char === delimiter && !inQuotes) { result.push(current.trim()); current = ''; continue; }
      current += char;
    }
    result.push(current.trim());
    return result;
  };

  const headers = splitRow(lines[0]);
  const rows = lines.slice(1).map(splitRow);
  return { headers, rows };
}

/**
 * Parse JSON text into tabular form if possible.
 */
export function parseJSON(text: string): { headers: string[]; rows: string[][]; raw?: any } {
  const data = JSON.parse(text);
  if (Array.isArray(data) && data.length > 0 && typeof data[0] === 'object') {
    const headers = [...new Set(data.flatMap((item: any) => Object.keys(item)))];
    const rows = data.map((item: any) => headers.map(h => String(item[h] ?? '')));
    return { headers, rows };
  }
  if (typeof data === 'object' && data !== null) {
    const headers = ['Key', 'Value'];
    const rows = Object.entries(data).map(([k, v]) => [k, String(v)]);
    return { headers, rows };
  }
  return { headers: [], rows: [], raw: data };
}

/**
 * Detect if a column is numeric (all non-empty values parse as numbers).
 */
export function isNumericColumn(rows: string[][], colIndex: number): boolean {
  let count = 0;
  for (const row of rows) {
    const val = row[colIndex];
    if (!val || val.trim() === '') continue;
    if (isNaN(Number(val))) return false;
    count++;
  }
  return count > 0;
}

/**
 * Compute basic stats for a numeric column.
 */
export function columnStats(rows: string[][], colIndex: number): { min: number; max: number; mean: number; count: number } {
  const nums: number[] = [];
  for (const row of rows) {
    const val = row[colIndex];
    if (!val || val.trim() === '') continue;
    const n = Number(val);
    if (!isNaN(n)) nums.push(n);
  }
  if (nums.length === 0) return { min: 0, max: 0, mean: 0, count: 0 };
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  const mean = nums.reduce((a, b) => a + b, 0) / nums.length;
  return { min, max, mean: Math.round(mean * 100) / 100, count: nums.length };
}
