// src/tradingEngine/TradingSystemLogger.ts
// Robust structured logging system for the trading framework
// Supports: log levels, structured data, performance tracking, trade logging

import { EventEmitter } from 'events';

// ─── Types ───────────────────────────────────────────────────────────────────

export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'FATAL';

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  category: string;
  message: string;
  data?: Record<string, unknown>;
  duration?: number;
  traceId?: string;
}

export interface PerformanceMetric {
  name: string;
  startTime: number;
  endTime?: number;
  durationMs?: number;
  metadata?: Record<string, unknown>;
}

export interface TradeLog {
  timestamp: string;
  action: 'ENTRY' | 'EXIT' | 'STOP_LOSS' | 'TAKE_PROFIT' | 'CANCEL';
  direction: 'BUY' | 'SELL';
  price: number;
  size: number;
  pnl?: number;
  reason: string;
  modelUsed?: string;
  confidence?: number;
}

export interface LoggerConfig {
  minLevel: LogLevel;
  maxBufferSize: number;
  enableConsole: boolean;
  enableEvents: boolean;
  enablePerformanceTracking: boolean;
  tradeLogEnabled: boolean;
  categoryFilter?: string[];
}

const LOG_LEVEL_ORDER: Record<LogLevel, number> = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
  FATAL: 4,
};

const DEFAULT_CONFIG: LoggerConfig = {
  minLevel: 'INFO',
  maxBufferSize: 10_000,
  enableConsole: true,
  enableEvents: true,
  enablePerformanceTracking: true,
  tradeLogEnabled: true,
};

// ─── Trading System Logger ───────────────────────────────────────────────────

class TradingSystemLogger extends EventEmitter {
  private config: LoggerConfig;
  private logBuffer: LogEntry[] = [];
  private tradeLog: TradeLog[] = [];
  private performanceMetrics: Map<string, PerformanceMetric> = new Map();
  private traceIdCounter: number = 0;

  constructor(config: Partial<LoggerConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // ─── Core Logging ─────────────────────────────────────────────────────────

  debug(category: string, message: string, data?: Record<string, unknown>): void {
    this.log('DEBUG', category, message, data);
  }

  info(category: string, message: string, data?: Record<string, unknown>): void {
    this.log('INFO', category, message, data);
  }

  warn(category: string, message: string, data?: Record<string, unknown>): void {
    this.log('WARN', category, message, data);
  }

  error(category: string, message: string, data?: Record<string, unknown>): void {
    this.log('ERROR', category, message, data);
  }

  fatal(category: string, message: string, data?: Record<string, unknown>): void {
    this.log('FATAL', category, message, data);
  }

  private log(level: LogLevel, category: string, message: string, data?: Record<string, unknown>): void {
    if (LOG_LEVEL_ORDER[level] < LOG_LEVEL_ORDER[this.config.minLevel]) return;
    if (this.config.categoryFilter && !this.config.categoryFilter.includes(category)) return;

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      category,
      message,
      data,
    };

    this.logBuffer.push(entry);
    if (this.logBuffer.length > this.config.maxBufferSize) {
      this.logBuffer.shift();
    }

    if (this.config.enableConsole) {
      this.consoleOutput(entry);
    }

    if (this.config.enableEvents) {
      this.emit('log', entry);
    }
  }

  // ─── Trade Logging ────────────────────────────────────────────────────────

  logTrade(trade: Omit<TradeLog, 'timestamp'>): void {
    if (!this.config.tradeLogEnabled) return;

    const entry: TradeLog = {
      ...trade,
      timestamp: new Date().toISOString(),
    };

    this.tradeLog.push(entry);

    this.log('INFO', 'TRADE', `${trade.action} ${trade.direction} @ ${trade.price}`, {
      size: trade.size,
      pnl: trade.pnl,
      reason: trade.reason,
      model: trade.modelUsed,
      confidence: trade.confidence,
    });
  }

  // ─── Performance Tracking ─────────────────────────────────────────────────

  startTimer(name: string, metadata?: Record<string, unknown>): string {
    const traceId = `${name}_${++this.traceIdCounter}`;
    this.performanceMetrics.set(traceId, {
      name,
      startTime: performance.now(),
      metadata,
    });
    return traceId;
  }

  endTimer(traceId: string): number {
    const metric = this.performanceMetrics.get(traceId);
    if (!metric) return 0;

    metric.endTime = performance.now();
    metric.durationMs = metric.endTime - metric.startTime;

    if (this.config.enablePerformanceTracking) {
      this.log('DEBUG', 'PERF', `${metric.name}: ${metric.durationMs.toFixed(2)}ms`, {
        traceId,
        durationMs: metric.durationMs,
        ...metric.metadata,
      });
    }

    return metric.durationMs;
  }

  // Measure an async function's execution time
  async measure<T>(name: string, fn: () => Promise<T>): Promise<{ result: T; durationMs: number }> {
    const traceId = this.startTimer(name);
    const result = await fn();
    const durationMs = this.endTimer(traceId);
    return { result, durationMs };
  }

  // Measure a sync function's execution time
  measureSync<T>(name: string, fn: () => T): { result: T; durationMs: number } {
    const traceId = this.startTimer(name);
    const result = fn();
    const durationMs = this.endTimer(traceId);
    return { result, durationMs };
  }

  // ─── Query Logs ───────────────────────────────────────────────────────────

  getLogs(filter?: { level?: LogLevel; category?: string; limit?: number }): LogEntry[] {
    let logs = [...this.logBuffer];

    if (filter?.level) {
      const minOrder = LOG_LEVEL_ORDER[filter.level];
      logs = logs.filter(l => LOG_LEVEL_ORDER[l.level] >= minOrder);
    }

    if (filter?.category) {
      logs = logs.filter(l => l.category === filter.category);
    }

    if (filter?.limit) {
      logs = logs.slice(-filter.limit);
    }

    return logs;
  }

  getTradeLogs(): TradeLog[] {
    return [...this.tradeLog];
  }

  getPerformanceSummary(): Record<string, { count: number; avgMs: number; maxMs: number; minMs: number }> {
    const summary: Record<string, { count: number; totalMs: number; maxMs: number; minMs: number }> = {};

    for (const metric of this.performanceMetrics.values()) {
      if (!metric.durationMs) continue;
      if (!summary[metric.name]) {
        summary[metric.name] = { count: 0, totalMs: 0, maxMs: 0, minMs: Infinity };
      }
      const s = summary[metric.name];
      s.count++;
      s.totalMs += metric.durationMs;
      s.maxMs = Math.max(s.maxMs, metric.durationMs);
      s.minMs = Math.min(s.minMs, metric.durationMs);
    }

    const result: Record<string, { count: number; avgMs: number; maxMs: number; minMs: number }> = {};
    for (const [name, s] of Object.entries(summary)) {
      result[name] = {
        count: s.count,
        avgMs: s.totalMs / s.count,
        maxMs: s.maxMs,
        minMs: s.minMs === Infinity ? 0 : s.minMs,
      };
    }

    return result;
  }

  // ─── Export ───────────────────────────────────────────────────────────────

  exportToJSON(): string {
    return JSON.stringify({
      logs: this.logBuffer,
      trades: this.tradeLog,
      performance: this.getPerformanceSummary(),
      exportedAt: new Date().toISOString(),
    }, null, 2);
  }

  exportToCSV(): string {
    const header = 'timestamp,level,category,message\n';
    const rows = this.logBuffer.map(l =>
      `${l.timestamp},${l.level},${l.category},"${l.message.replace(/"/g, '""')}"`
    ).join('\n');
    return header + rows;
  }

  // ─── Clear ────────────────────────────────────────────────────────────────

  clear(): void {
    this.logBuffer = [];
    this.tradeLog = [];
    this.performanceMetrics.clear();
  }

  getBufferSize(): number {
    return this.logBuffer.length;
  }

  // ─── Console Output ───────────────────────────────────────────────────────

  private consoleOutput(entry: LogEntry): void {
    const prefix = `[${entry.timestamp}] [${entry.level}] [${entry.category}]`;
    const msg = `${prefix} ${entry.message}`;

    switch (entry.level) {
      case 'DEBUG': console.debug(msg, entry.data || ''); break;
      case 'INFO': console.info(msg, entry.data || ''); break;
      case 'WARN': console.warn(msg, entry.data || ''); break;
      case 'ERROR': console.error(msg, entry.data || ''); break;
      case 'FATAL': console.error(`🔴 FATAL: ${msg}`, entry.data || ''); break;
    }
  }
}

// Singleton instance for app-wide logging
let _instance: TradingSystemLogger | null = null;

export function getLogger(config?: Partial<LoggerConfig>): TradingSystemLogger {
  if (!_instance) {
    _instance = new TradingSystemLogger(config);
  }
  return _instance;
}

export function resetLogger(): void {
  _instance = null;
}

export default TradingSystemLogger;
