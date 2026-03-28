/**
 * Hindsight OpenClaw plugin logger.
 *
 * Features:
 *  - Configurable log level: 'silent' | 'errors' | 'normal' | 'verbose'
 *  - Compact single-line format (configurable)
 *  - ANSI-colored [Hindsight] tag with dim timestamp
 *  - Batched retain/recall summaries instead of per-event spam
 */

// ANSI escape helpers (no dependencies)
const RESET = '\x1b[0m';
const DIM = '\x1b[2m';
const CYAN = '\x1b[36m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const GREEN = '\x1b[32m';

export type LogLevel = 'silent' | 'errors' | 'normal' | 'verbose';

export interface LoggerConfig {
  /** Minimum severity to print. Default: 'normal' */
  logLevel?: LogLevel;
  /** Interval in ms to print batched retain/recall summaries. 0 = print every event. Default: 300000 (5 min) */
  logSummaryIntervalMs?: number;
  /** Use short single-line format. Default: true */
  logCompact?: boolean;
}

const LEVEL_RANK: Record<LogLevel, number> = {
  silent: 0,
  errors: 1,
  normal: 2,
  verbose: 3,
};

function timestamp(): string {
  const d = new Date();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

const TAG = `${CYAN}[Hindsight]${RESET}`;

// Batched summary state
let retainCount = 0;
let recallCount = 0;
let recallMemoriesCount = 0;
let lastSummaryTime = Date.now();
let summaryTimer: ReturnType<typeof setInterval> | null = null;

let currentLevel: LogLevel = 'normal';
let currentCompact = true;
let currentSummaryIntervalMs = 300_000; // 5 min

export function configureLogger(cfg: LoggerConfig): void {
  currentLevel = cfg.logLevel ?? 'normal';
  currentCompact = cfg.logCompact ?? true;
  currentSummaryIntervalMs = cfg.logSummaryIntervalMs ?? 300_000;

  // Restart summary timer
  if (summaryTimer) {
    clearInterval(summaryTimer);
    summaryTimer = null;
  }
  if (currentSummaryIntervalMs > 0 && LEVEL_RANK[currentLevel] >= LEVEL_RANK['normal']) {
    summaryTimer = setInterval(flushSummary, currentSummaryIntervalMs);
    summaryTimer.unref?.(); // don't keep process alive
  }
}

function allowed(level: LogLevel): boolean {
  return LEVEL_RANK[currentLevel] >= LEVEL_RANK[level];
}

function fmt(color: string, msg: string): string {
  if (currentCompact) {
    return `${DIM}${timestamp()}${RESET} ${TAG} ${color}${msg}${RESET}`;
  }
  return `${DIM}${timestamp()}${RESET} ${TAG} ${color}${msg}${RESET}`;
}

/** Info-level log (requires 'normal' or higher) */
export function info(msg: string): void {
  if (!allowed('normal')) return;
  console.log(fmt('', msg));
}

/** Verbose/debug log (requires 'verbose') */
export function verbose(msg: string): void {
  if (!allowed('verbose')) return;
  console.log(fmt(DIM, msg));
}

/** Warning (requires 'errors' or higher) */
export function warn(msg: string): void {
  if (!allowed('errors')) return;
  console.warn(fmt(YELLOW, msg));
}

/** Error (requires 'errors' or higher) */
export function error(msg: string, err?: unknown): void {
  if (!allowed('errors')) return;
  const detail = err instanceof Error ? err.message : (err ? String(err) : '');
  console.error(fmt(RED, detail ? `${msg}: ${detail}` : msg));
}

/** Track a retain event for batched summary */
export function trackRetain(bankId: string, messageCount: number): void {
  retainCount++;
  if (currentSummaryIntervalMs === 0 && allowed('normal')) {
    console.log(fmt(GREEN, `retained ${messageCount} msgs → ${bankId}`));
  }
}

/** Track a recall event for batched summary */
export function trackRecall(bankId: string, memoriesFound: number): void {
  recallCount++;
  recallMemoriesCount += memoriesFound;
  if (currentSummaryIntervalMs === 0 && allowed('normal')) {
    console.log(fmt('', `recalled ${memoriesFound} memories ← ${bankId}`));
  }
}

/** Flush the batched summary to console */
export function flushSummary(): void {
  if (!allowed('normal')) return;
  if (retainCount === 0 && recallCount === 0) return;

  const elapsed = Math.round((Date.now() - lastSummaryTime) / 1000);
  const parts: string[] = [];
  if (recallCount > 0) parts.push(`${recallCount} recalls (${recallMemoriesCount} memories)`);
  if (retainCount > 0) parts.push(`${retainCount} retains`);
  console.log(fmt(GREEN, `${parts.join(', ')} in ${elapsed}s`));

  retainCount = 0;
  recallCount = 0;
  recallMemoriesCount = 0;
  lastSummaryTime = Date.now();
}

/** Cleanup (call on plugin stop) */
export function stopLogger(): void {
  flushSummary();
  if (summaryTimer) {
    clearInterval(summaryTimer);
    summaryTimer = null;
  }
}
