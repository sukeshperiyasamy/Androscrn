import { execFileSync } from 'child_process';

/**
 * User PATH management split into pure string functions (fully unit-testable) and a small persistence
 * layer behind the `UserPathStore` interface. Tests inject an in-memory store, so they never touch the
 * developer's real persistent Windows User PATH.
 */

export interface UserPathStore {
  /** Returns the raw User PATH, or null when the variable is not set. Throws if it cannot be read. */
  read(): string | null;
  /** Persists the raw User PATH. Throws if it cannot be written. */
  write(value: string): void;
}

/**
 * Canonical form used only for comparisons: trimmed, unquoted, backslash separators, no trailing
 * separator (except a drive root such as `C:\`), lower-cased (Windows paths are case-insensitive).
 */
export function normalizePathEntry(entry: string): string {
  let p = (entry ?? '').trim();
  if (p.length >= 2 && p.startsWith('"') && p.endsWith('"')) p = p.slice(1, -1).trim();
  p = p.replace(/\//g, '\\');
  p = p.replace(/\\{2,}/g, (m, offset) => (offset === 0 ? m : '\\'));
  if (!/^[a-zA-Z]:\\$/.test(p)) p = p.replace(/\\+$/, '');
  return p.toLowerCase();
}

/**
 * Splits a raw PATH value into entries, dropping empty segments and surrounding whitespace.
 * Entries are otherwise preserved exactly as written.
 */
export function parsePathList(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(';')
    .map(e => e.trim())
    .filter(e => e.length > 0);
}

export function pathListContains(entries: string[], target: string): boolean {
  const wanted = normalizePathEntry(target);
  return wanted.length > 0 && entries.some(e => normalizePathEntry(e) === wanted);
}

export interface PathChange {
  changed: boolean;
  value: string;
  /** Number of entries removed (remove only). */
  removed?: number;
}

/** Appends `target` unless an equivalent entry already exists. Unrelated entries are untouched. */
export function addPathEntry(raw: string | null | undefined, target: string): PathChange {
  const entries = parsePathList(raw);
  if (normalizePathEntry(target).length === 0 || pathListContains(entries, target)) {
    return { changed: false, value: entries.join(';') };
  }
  return { changed: true, value: [...entries, target.trim()].join(';') };
}

/** Removes every entry equivalent to `target` (including duplicates). Unrelated entries are untouched. */
export function removePathEntry(raw: string | null | undefined, target: string): PathChange {
  const entries = parsePathList(raw);
  const wanted = normalizePathEntry(target);
  const kept = wanted.length > 0 ? entries.filter(e => normalizePathEntry(e) !== wanted) : entries;
  const removed = entries.length - kept.length;
  return { changed: removed > 0, value: kept.join(';'), removed };
}

/** In-memory store used by tests and available to embedders. */
export class MemoryUserPathStore implements UserPathStore {
  public writes = 0;
  constructor(public value: string | null = null, private failWrite = false, private failRead = false) {}
  read(): string | null {
    if (this.failRead) throw new Error('simulated read failure');
    return this.value;
  }
  write(value: string): void {
    if (this.failWrite) throw new Error('simulated write failure');
    this.writes++;
    this.value = value;
  }
}

/**
 * Real persistence through Windows PowerShell. The script is passed with -EncodedCommand and the new
 * value through an environment variable, so no shell quoting or `%VAR%` expansion can alter it.
 *
 * Writing a persistent User variable makes Windows broadcast a settings-change message, which was measured
 * at roughly 6.7 s per write on the development machine, hence the generous write timeout.
 */
export class PowerShellUserPathStore implements UserPathStore {
  /**
   * @param variableName Environment variable to manage. Always `Path` in production; tests that exercise the real
   *                     persistence layer use a disposable variable name instead so the real PATH is never touched.
   */
  constructor(private readTimeoutMs = 15000, private writeTimeoutMs = 60000, private variableName = 'Path') {
    if (!/^[A-Za-z0-9_]+$/.test(variableName)) throw new Error('Invalid environment variable name.');
  }

  private run(script: string, timeoutMs: number, extraEnv: NodeJS.ProcessEnv = {}): string {
    const encoded = Buffer.from(script, 'utf16le').toString('base64');
    return execFileSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded],
      { encoding: 'utf8', timeout: timeoutMs, windowsHide: true, env: { ...process.env, ...extraEnv } }
    );
  }

  read(): string | null {
    const out = this.run(
      `$v = [Environment]::GetEnvironmentVariable('${this.variableName}', [EnvironmentVariableTarget]::User); if ($null -eq $v) { 'ANDROSCRN_UNSET' } else { $v }`,
      this.readTimeoutMs
    ).replace(/\r?\n$/, '');
    return out === 'ANDROSCRN_UNSET' ? null : out;
  }

  write(value: string): void {
    this.run(
      `[Environment]::SetEnvironmentVariable('${this.variableName}', $env:ANDROSCRN_NEW_PATH, [EnvironmentVariableTarget]::User)`,
      this.writeTimeoutMs,
      { ANDROSCRN_NEW_PATH: value }
    );
  }

  /** Deletes the managed variable. Intended for disposable test variables only. */
  deleteVariable(): void {
    this.run(
      `[Environment]::SetEnvironmentVariable('${this.variableName}', $null, [EnvironmentVariableTarget]::User)`,
      this.writeTimeoutMs
    );
  }
}
