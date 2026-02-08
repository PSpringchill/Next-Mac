import { describe, it, expect, beforeEach, vi } from 'vitest';
import TradingSystemLogger, { getLogger, resetLogger } from '../app/components/TradingEngine/TradingSystemLogger';

describe('TradingSystemLogger', () => {
  let logger: TradingSystemLogger;

  beforeEach(() => {
    logger = new TradingSystemLogger({ enableConsole: false });
  });

  describe('core logging', () => {
    it('logs messages at each level', () => {
      logger.debug('TEST', 'debug message');
      logger.info('TEST', 'info message');
      logger.warn('TEST', 'warn message');
      logger.error('TEST', 'error message');
      logger.fatal('TEST', 'fatal message');

      const logs = logger.getLogs();
      expect(logs.length).toBe(4); // DEBUG filtered by default (minLevel=INFO)
    });

    it('includes DEBUG when minLevel is DEBUG', () => {
      const debugLogger = new TradingSystemLogger({ enableConsole: false, minLevel: 'DEBUG' });
      debugLogger.debug('TEST', 'debug msg');
      debugLogger.info('TEST', 'info msg');
      expect(debugLogger.getLogs().length).toBe(2);
    });

    it('filters by min level', () => {
      const errorLogger = new TradingSystemLogger({ enableConsole: false, minLevel: 'ERROR' });
      errorLogger.info('TEST', 'info');
      errorLogger.warn('TEST', 'warn');
      errorLogger.error('TEST', 'error');
      errorLogger.fatal('TEST', 'fatal');
      expect(errorLogger.getLogs().length).toBe(2);
    });

    it('stores data in log entries', () => {
      logger.info('TEST', 'with data', { key: 'value', num: 42 });
      const logs = logger.getLogs();
      expect(logs[0].data).toEqual({ key: 'value', num: 42 });
    });

    it('respects category filter', () => {
      const filtered = new TradingSystemLogger({
        enableConsole: false,
        categoryFilter: ['TRADE'],
      });
      filtered.info('TRADE', 'trade msg');
      filtered.info('SYSTEM', 'system msg');
      expect(filtered.getLogs().length).toBe(1);
      expect(filtered.getLogs()[0].category).toBe('TRADE');
    });

    it('respects max buffer size', () => {
      const small = new TradingSystemLogger({ enableConsole: false, maxBufferSize: 5 });
      for (let i = 0; i < 10; i++) {
        small.info('TEST', `msg ${i}`);
      }
      expect(small.getBufferSize()).toBe(5);
    });
  });

  describe('getLogs() filtering', () => {
    beforeEach(() => {
      logger.info('CAT_A', 'a1');
      logger.warn('CAT_B', 'b1');
      logger.error('CAT_A', 'a2');
    });

    it('filters by level', () => {
      const errorLogs = logger.getLogs({ level: 'ERROR' });
      expect(errorLogs.length).toBe(1);
    });

    it('filters by category', () => {
      const catA = logger.getLogs({ category: 'CAT_A' });
      expect(catA.length).toBe(2);
    });

    it('limits results', () => {
      const limited = logger.getLogs({ limit: 1 });
      expect(limited.length).toBe(1);
    });
  });

  describe('trade logging', () => {
    it('logs trades', () => {
      logger.logTrade({
        action: 'ENTRY',
        direction: 'BUY',
        price: 100,
        size: 1,
        reason: 'ML signal',
        modelUsed: 'RandomForest',
        confidence: 0.85,
      });

      const trades = logger.getTradeLogs();
      expect(trades.length).toBe(1);
      expect(trades[0].action).toBe('ENTRY');
      expect(trades[0].price).toBe(100);
      expect(trades[0].timestamp).toBeTruthy();
    });

    it('does not log trades when disabled', () => {
      const noTrades = new TradingSystemLogger({ enableConsole: false, tradeLogEnabled: false });
      noTrades.logTrade({ action: 'ENTRY', direction: 'BUY', price: 100, size: 1, reason: 'test' });
      expect(noTrades.getTradeLogs().length).toBe(0);
    });
  });

  describe('performance tracking', () => {
    it('measures execution time', () => {
      const traceId = logger.startTimer('test_op');
      // Simulate some work
      let sum = 0;
      for (let i = 0; i < 1000; i++) sum += i;
      const duration = logger.endTimer(traceId);
      expect(duration).toBeGreaterThanOrEqual(0);
    });

    it('measureSync returns result and duration', () => {
      const { result, durationMs } = logger.measureSync('add', () => 2 + 3);
      expect(result).toBe(5);
      expect(durationMs).toBeGreaterThanOrEqual(0);
    });

    it('measure returns result and duration for async', async () => {
      const { result, durationMs } = await logger.measure('async_op', async () => {
        return 42;
      });
      expect(result).toBe(42);
      expect(durationMs).toBeGreaterThanOrEqual(0);
    });

    it('getPerformanceSummary aggregates metrics', () => {
      for (let i = 0; i < 5; i++) {
        const tid = logger.startTimer('op');
        logger.endTimer(tid);
      }
      const summary = logger.getPerformanceSummary();
      expect(summary['op']).toBeDefined();
      expect(summary['op'].count).toBe(5);
      expect(summary['op'].avgMs).toBeGreaterThanOrEqual(0);
    });

    it('endTimer returns 0 for unknown traceId', () => {
      expect(logger.endTimer('unknown')).toBe(0);
    });
  });

  describe('export', () => {
    it('exports to JSON', () => {
      logger.info('TEST', 'msg');
      const json = logger.exportToJSON();
      const parsed = JSON.parse(json);
      expect(parsed.logs.length).toBe(1);
      expect(parsed.exportedAt).toBeTruthy();
    });

    it('exports to CSV', () => {
      logger.info('TEST', 'hello world');
      const csv = logger.exportToCSV();
      expect(csv).toContain('timestamp,level,category,message');
      expect(csv).toContain('TEST');
      expect(csv).toContain('hello world');
    });
  });

  describe('clear', () => {
    it('clears all data', () => {
      logger.info('TEST', 'msg');
      logger.logTrade({ action: 'ENTRY', direction: 'BUY', price: 100, size: 1, reason: 'test' });
      logger.startTimer('op');

      logger.clear();
      expect(logger.getBufferSize()).toBe(0);
      expect(logger.getTradeLogs().length).toBe(0);
      expect(Object.keys(logger.getPerformanceSummary()).length).toBe(0);
    });
  });

  describe('events', () => {
    it('emits log events', () => {
      const eventLogger = new TradingSystemLogger({ enableConsole: false, enableEvents: true });
      const handler = vi.fn();
      eventLogger.on('log', handler);
      eventLogger.info('TEST', 'event test');
      expect(handler).toHaveBeenCalledOnce();
      expect(handler.mock.calls[0][0].message).toBe('event test');
    });
  });

  describe('singleton', () => {
    it('getLogger returns same instance', () => {
      resetLogger();
      const a = getLogger({ enableConsole: false });
      const b = getLogger();
      expect(a).toBe(b);
    });

    it('resetLogger creates new instance', () => {
      const a = getLogger({ enableConsole: false });
      resetLogger();
      const b = getLogger({ enableConsole: false });
      expect(a).not.toBe(b);
    });
  });
});
