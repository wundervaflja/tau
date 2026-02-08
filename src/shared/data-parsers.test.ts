import { describe, it, expect } from 'vitest';
import { parseCSV, parseJSON, isNumericColumn, columnStats } from './data-parsers';

describe('parseCSV', () => {
  it('parses simple CSV', () => {
    const result = parseCSV('name,age,city\nAlice,30,NYC\nBob,25,LA');
    expect(result.headers).toEqual(['name', 'age', 'city']);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]).toEqual(['Alice', '30', 'NYC']);
    expect(result.rows[1]).toEqual(['Bob', '25', 'LA']);
  });

  it('handles quoted fields with commas', () => {
    const result = parseCSV('name,desc\nAlice,"hello, world"');
    expect(result.rows[0]).toEqual(['Alice', 'hello, world']);
  });

  it('returns empty for empty input', () => {
    const result = parseCSV('');
    expect(result.headers).toEqual([]);
    expect(result.rows).toEqual([]);
  });

  it('returns empty for whitespace-only input', () => {
    const result = parseCSV('   \n   \n   ');
    expect(result.headers).toEqual([]);
    expect(result.rows).toEqual([]);
  });

  it('handles single column', () => {
    const result = parseCSV('name\nAlice\nBob');
    expect(result.headers).toEqual(['name']);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]).toEqual(['Alice']);
  });

  it('handles TSV with tab delimiter', () => {
    const result = parseCSV('name\tage\nAlice\t30', '\t');
    expect(result.headers).toEqual(['name', 'age']);
    expect(result.rows[0]).toEqual(['Alice', '30']);
  });

  it('handles header-only CSV', () => {
    const result = parseCSV('name,age,city');
    expect(result.headers).toEqual(['name', 'age', 'city']);
    expect(result.rows).toHaveLength(0);
  });

  it('trims whitespace from values', () => {
    const result = parseCSV('name , age\n Alice , 30 ');
    expect(result.headers).toEqual(['name', 'age']);
    expect(result.rows[0]).toEqual(['Alice', '30']);
  });
});

describe('parseJSON', () => {
  it('parses array of objects', () => {
    const result = parseJSON(JSON.stringify([
      { name: 'Alice', age: 30 },
      { name: 'Bob', age: 25 },
    ]));
    expect(result.headers).toContain('name');
    expect(result.headers).toContain('age');
    expect(result.rows).toHaveLength(2);
  });

  it('parses single object as key-value pairs', () => {
    const result = parseJSON(JSON.stringify({ name: 'Alice', age: 30 }));
    expect(result.headers).toEqual(['Key', 'Value']);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]).toEqual(['name', 'Alice']);
    expect(result.rows[1]).toEqual(['age', '30']);
  });

  it('returns raw for primitive values', () => {
    const result = parseJSON('42');
    expect(result.headers).toEqual([]);
    expect(result.rows).toEqual([]);
    expect(result.raw).toBe(42);
  });

  it('returns raw for string', () => {
    const result = parseJSON('"hello"');
    expect(result.raw).toBe('hello');
  });

  it('handles objects with inconsistent keys', () => {
    const result = parseJSON(JSON.stringify([
      { a: 1, b: 2 },
      { a: 3, c: 4 },
    ]));
    expect(result.headers).toContain('a');
    expect(result.headers).toContain('b');
    expect(result.headers).toContain('c');
    expect(result.rows).toHaveLength(2);
  });

  it('throws for invalid JSON', () => {
    expect(() => parseJSON('not json')).toThrow();
  });
});

describe('isNumericColumn', () => {
  it('detects numeric column', () => {
    const rows = [['Alice', '30'], ['Bob', '25']];
    expect(isNumericColumn(rows, 1)).toBe(true);
  });

  it('detects non-numeric column', () => {
    const rows = [['Alice', '30'], ['Bob', 'xyz']];
    expect(isNumericColumn(rows, 1)).toBe(false);
  });

  it('ignores empty values', () => {
    const rows = [['Alice', '30'], ['Bob', ''], ['Carol', '40']];
    expect(isNumericColumn(rows, 1)).toBe(true);
  });

  it('returns false for all-empty column', () => {
    const rows = [['a', ''], ['b', '']];
    expect(isNumericColumn(rows, 1)).toBe(false);
  });

  it('detects text column', () => {
    const rows = [['Alice', 'NYC'], ['Bob', 'LA']];
    expect(isNumericColumn(rows, 0)).toBe(false);
  });
});

describe('columnStats', () => {
  it('computes min, max, mean', () => {
    const rows = [['a', '10'], ['b', '20'], ['c', '30']];
    const stats = columnStats(rows, 1);
    expect(stats.min).toBe(10);
    expect(stats.max).toBe(30);
    expect(stats.mean).toBe(20);
    expect(stats.count).toBe(3);
  });

  it('handles single value', () => {
    const rows = [['a', '42']];
    const stats = columnStats(rows, 1);
    expect(stats.min).toBe(42);
    expect(stats.max).toBe(42);
    expect(stats.mean).toBe(42);
    expect(stats.count).toBe(1);
  });

  it('handles empty column', () => {
    const rows = [['a', ''], ['b', '']];
    const stats = columnStats(rows, 1);
    expect(stats.count).toBe(0);
  });

  it('skips non-numeric values', () => {
    const rows = [['a', '10'], ['b', 'n/a'], ['c', '30']];
    const stats = columnStats(rows, 1);
    expect(stats.min).toBe(10);
    expect(stats.max).toBe(30);
    expect(stats.count).toBe(2);
  });
});
