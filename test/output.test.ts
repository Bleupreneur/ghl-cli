import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GhlApiError, UsageError } from '../src/types';

describe('output', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('resolveFormat', () => {
    it('returns "pretty" when opts.pretty is set', async () => {
      const { resolveFormat } = await import('../src/output');
      expect(resolveFormat({ pretty: true })).toBe('pretty');
    });

    it('returns "json" when opts.json is set', async () => {
      const { resolveFormat } = await import('../src/output');
      expect(resolveFormat({ json: true })).toBe('json');
    });

    it('"pretty" takes precedence over "json"', async () => {
      const { resolveFormat } = await import('../src/output');
      expect(resolveFormat({ pretty: true, json: true })).toBe('pretty');
    });

    it('returns "table" when process.stdout.isTTY is true (no flags)', async () => {
      const { resolveFormat } = await import('../src/output');
      const original = process.stdout.isTTY;
      Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
      const fmt = resolveFormat({});
      Object.defineProperty(process.stdout, 'isTTY', { value: original, configurable: true });
      expect(fmt).toBe('table');
    });

    it('returns "json" when process.stdout.isTTY is falsy (piped)', async () => {
      const { resolveFormat } = await import('../src/output');
      const original = process.stdout.isTTY;
      Object.defineProperty(process.stdout, 'isTTY', { value: false, configurable: true });
      const fmt = resolveFormat({});
      Object.defineProperty(process.stdout, 'isTTY', { value: original, configurable: true });
      expect(fmt).toBe('json');
    });
  });

  describe('printResult', () => {
    it('outputs compact JSON when format is json (piped)', async () => {
      const { printResult } = await import('../src/output');
      Object.defineProperty(process.stdout, 'isTTY', { value: false, configurable: true });
      const writes: string[] = [];
      vi.spyOn(process.stdout, 'write').mockImplementation((data) => {
        writes.push(String(data));
        return true;
      });
      printResult({ contacts: [{ id: '1', name: 'Alice' }] }, { json: true });
      const out = writes.join('');
      expect(JSON.parse(out)).toMatchObject({ contacts: [{ id: '1', name: 'Alice' }] });
      // compact: no newlines within the JSON
      expect(out.trim().split('\n').length).toBe(1);
    });

    it('outputs pretty JSON with 2-space indent when format is pretty', async () => {
      const { printResult } = await import('../src/output');
      const writes: string[] = [];
      vi.spyOn(process.stdout, 'write').mockImplementation((data) => {
        writes.push(String(data));
        return true;
      });
      printResult({ id: 'abc', name: 'Test' }, { pretty: true });
      const out = writes.join('');
      expect(out).toContain('  ');
      expect(JSON.parse(out)).toMatchObject({ id: 'abc', name: 'Test' });
    });

    it('prints table for array data in TTY mode', async () => {
      const { printResult } = await import('../src/output');
      Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
      const writes: string[] = [];
      vi.spyOn(process.stdout, 'write').mockImplementation((data) => {
        writes.push(String(data));
        return true;
      });
      const data = {
        contacts: [
          { id: 'c1', name: 'Alice', email: 'a@a.com' },
          { id: 'c2', name: 'Bob', email: 'b@b.com' },
        ],
      };
      printResult(data, {});
      const out = writes.join('');
      expect(out).toContain('id');
      expect(out).toContain('name');
      expect(out).toContain('Alice');
      expect(out).toContain('Bob');
    });

    it('falls back to pretty JSON for non-array data in table mode', async () => {
      const { printResult } = await import('../src/output');
      Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
      const writes: string[] = [];
      vi.spyOn(process.stdout, 'write').mockImplementation((data) => {
        writes.push(String(data));
        return true;
      });
      printResult({ id: 'x', name: 'Single', nested: { foo: 'bar' } }, {});
      const out = writes.join('');
      expect(JSON.parse(out)).toMatchObject({ id: 'x', name: 'Single' });
    });

    it('quiet mode unwraps single-key envelope', async () => {
      const { printResult } = await import('../src/output');
      Object.defineProperty(process.stdout, 'isTTY', { value: false, configurable: true });
      const writes: string[] = [];
      vi.spyOn(process.stdout, 'write').mockImplementation((data) => {
        writes.push(String(data));
        return true;
      });
      const data = { contacts: [{ id: '1' }, { id: '2' }] };
      printResult(data, { quiet: true, json: true });
      const out = writes.join('');
      const parsed = JSON.parse(out);
      // Should be the array, not the envelope
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed[0]).toMatchObject({ id: '1' });
    });

    it('quiet mode unwraps "data" key', async () => {
      const { printResult } = await import('../src/output');
      Object.defineProperty(process.stdout, 'isTTY', { value: false, configurable: true });
      const writes: string[] = [];
      vi.spyOn(process.stdout, 'write').mockImplementation((data) => {
        writes.push(String(data));
        return true;
      });
      printResult({ data: { id: '5' }, meta: { count: 1 } }, { quiet: true, json: true });
      const out = writes.join('');
      const parsed = JSON.parse(out);
      expect(parsed).toMatchObject({ id: '5' });
    });
  });

  describe('printError', () => {
    it('exits 2 for UsageError and writes to stderr', async () => {
      const { printError } = await import('../src/output');
      const stderrWrites: string[] = [];
      vi.spyOn(process.stderr, 'write').mockImplementation((data) => {
        stderrWrites.push(String(data));
        return true;
      });
      const exitSpy = vi
        .spyOn(process, 'exit')
        .mockImplementation((code?: string | number | null) => {
          throw new Error(`process.exit(${code})`);
        });

      expect(() => printError(new UsageError('bad usage msg'))).toThrow('process.exit(2)');
      expect(exitSpy).toHaveBeenCalledWith(2);
      expect(stderrWrites.join('')).toContain('bad usage msg');
    });

    it('exits 1 for GhlApiError and writes status info to stderr', async () => {
      const { printError } = await import('../src/output');
      const stderrWrites: string[] = [];
      vi.spyOn(process.stderr, 'write').mockImplementation((data) => {
        stderrWrites.push(String(data));
        return true;
      });
      const exitSpy = vi
        .spyOn(process, 'exit')
        .mockImplementation((code?: string | number | null) => {
          throw new Error(`process.exit(${code})`);
        });

      const err = new GhlApiError(
        404,
        'Not Found',
        { message: 'Contact not found' },
        'GET',
        'https://example.com/contacts/x',
      );
      expect(() => printError(err)).toThrow('process.exit(1)');
      expect(exitSpy).toHaveBeenCalledWith(1);
      const output = stderrWrites.join('');
      expect(output).toContain('404');
      expect(output).toContain('Not Found');
      expect(output).toContain('GET');
    });

    it('exits 1 for generic Error', async () => {
      const { printError } = await import('../src/output');
      const stderrWrites: string[] = [];
      vi.spyOn(process.stderr, 'write').mockImplementation((data) => {
        stderrWrites.push(String(data));
        return true;
      });
      const exitSpy = vi
        .spyOn(process, 'exit')
        .mockImplementation((code?: string | number | null) => {
          throw new Error(`process.exit(${code})`);
        });

      expect(() => printError(new Error('something went wrong'))).toThrow('process.exit(1)');
      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(stderrWrites.join('')).toContain('something went wrong');
    });

    it('exits 1 for non-Error thrown value', async () => {
      const { printError } = await import('../src/output');
      const stderrWrites: string[] = [];
      vi.spyOn(process.stderr, 'write').mockImplementation((data) => {
        stderrWrites.push(String(data));
        return true;
      });
      const exitSpy = vi
        .spyOn(process, 'exit')
        .mockImplementation((code?: string | number | null) => {
          throw new Error(`process.exit(${code})`);
        });

      expect(() => printError('plain string error')).toThrow('process.exit(1)');
      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(stderrWrites.join('')).toContain('plain string error');
    });
  });
});
