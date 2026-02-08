import { EventEmitter } from 'events';
import {
  MarketData,
  Trade,
  TradingSignal,
  PortfolioState
} from '@tradingEngine/types';
import TradingEngine from './MLTradingCore';
import ExecutionEngine from './ExecutionEngine';
import RiskManager from './RiskManager';
import RewardCalculator, { ExecutionReport } from './RewardCalculator';
import MarketCharacteristor, { type ATISReport } from './MarketCharacteristor';
import CandleAggregator from './CandleAggregator';
import ParetoAnalyzer, { type ParetoState, AlphaRiskState } from './ParetoAnalyzer';
import DynamicThresholds, { type RegimeResult } from './DynamicThresholds';
import GradientSurpriseMonitor, { type SurpriseState } from './GradientSurpriseMonitor';
import Level2FeatureExtractor from './Level2FeatureExtractor';
import HiddenMarkovModel from './HiddenMarkovModel';
import EnsembleSignalGenerator, {
  type EnsembleResult,
  type EnsembleConfig,
  type ComponentCheck,
  type ExitSignal,
} from './EnsembleSignalGenerator';
import type { KalmanState } from './KalmanTrendFilter';
import type { LinRegState } from './LinearRegressionTarget';
import type { NaiveBayesState } from './NaiveBayesRegime';
import type { MarketRegime } from '@tradingEngine/types';

export interface SignalFilterState {
  hmmRegime: string;               // Current HMM regime name
  hmmMomentum: number;             // HMM regime momentum
  hmmIsTransition: boolean;        // Whether regime just changed
  hmmConfidenceAdj: number;        // Confidence multiplier from HMM (0-1)
  gradientSurprise: SurpriseState; // Gradient surprise monitor state
  originalConfidence: number;      // Signal confidence before filtering
  filteredConfidence: number;      // Signal confidence after HMM + gradient filtering
  filterReason: string | null;     // Why signal was modified/blocked
  blocked: boolean;                // Whether the signal was blocked
  // Kalman + LinReg + NaiveBayes enrichment
  kalman?: KalmanState;
  linReg?: LinRegState;
  naiveBayes?: NaiveBayesState;
  // Ensemble signal generator state
  ensemble?: EnsembleResult;
  exitSignal?: ExitSignal;
}

export interface PaperTradeResult {
  signal: TradingSignal;
  execution?: ExecutionReport;
  reward?: number;
  portfolio: PortfolioState;
  trades: Trade[];
  atis?: ATISReport;
  pareto?: ParetoState;
  regime?: RegimeResult;
  signalFilter?: SignalFilterState;
  ensemble?: EnsembleResult;
  exitSignal?: ExitSignal;
}

class PaperTradingEngine extends EventEmitter {
  private engine: { processMarketData: TradingEngine['processMarketData'] };
  private executionEngine: ExecutionEngine;
  private riskManager: RiskManager;
  private rewardCalculator: RewardCalculator;
  private portfolio: number;
  private position: number;
  private avgEntryPrice: number;
  private equityPeak: number;
  private trades: Trade[];
  private portfolioState: PortfolioState;
  private characteristor: MarketCharacteristor;
  private candleAggregator: CandleAggregator;
  private lastATIS: ATISReport | null = null;
  private paretoAnalyzer: ParetoAnalyzer;
  private dynamicThresholds: DynamicThresholds;
  private lastParetoState: ParetoState | null = null;
  private lastRegime: RegimeResult | null = null;
  private paretoTickCounter: number = 49;  // Fire first analysis on first tick
  private readonly paretoAnalysisInterval: number = 50;  // Then analyze every 50 ticks

  // MCML: Gradient Surprise Monitor + HMM Signal Filter
  private gradientMonitor: GradientSurpriseMonitor;
  private featureExtractor: Level2FeatureExtractor;
  private hmmRegimeDetector: HiddenMarkovModel;
  private lastHmmRegime: (MarketRegime & { isTransition: boolean }) | null = null;
  private lastSignalFilter: SignalFilterState | null = null;
  private prevPrice: number = 0;
  private hmmTickCounter: number = 9;      // Fire first HMM on first tick
  private readonly hmmAnalysisInterval: number = 10;  // HMM every 10 ticks (lighter than Pareto)

  // Ensemble Signal Generator: Kalman + LinReg + NaiveBayes + TechIndicators + Patterns + CurrencyStrength + ZigZag
  private ensembleGenerator: EnsembleSignalGenerator;
  private lastEnsemble: EnsembleResult | null = null;
  private lastExitSignal: ExitSignal | null = null;

  constructor(
    engine: { processMarketData: TradingEngine['processMarketData'] } = new TradingEngine(),
    riskManager: RiskManager = new RiskManager()
  ) {
    super();
    this.engine = engine;
    this.riskManager = riskManager;
    this.executionEngine = new ExecutionEngine(this.riskManager);
    this.rewardCalculator = new RewardCalculator(this.riskManager);
    this.characteristor = new MarketCharacteristor();
    this.candleAggregator = new CandleAggregator('BNBUSDT');
    this.paretoAnalyzer = new ParetoAnalyzer(2000, 500, 0.6);
    this.dynamicThresholds = new DynamicThresholds(1000, 100);
    this.gradientMonitor = new GradientSurpriseMonitor(50, 0.6, 0.85);
    this.featureExtractor = new Level2FeatureExtractor();
    this.hmmRegimeDetector = new HiddenMarkovModel();
    this.ensembleGenerator = new EnsembleSignalGenerator({
      riskPerTrade: 0.02,
      maxDrawdown: 0.05,
      entryThreshold: 0.65,
      exitThreshold: 0.35,
      kalmanProcessNoise: 0.001,
      kalmanMeasurementNoise: 0.01,
    });
    this.portfolio = 100000;
    this.position = 0;
    this.avgEntryPrice = 0;
    this.equityPeak = this.portfolio;
    this.trades = [];
    this.portfolioState = {
      position: 0,
      unrealizedPnl: 0,
      timeInTradeSec: 0,
      marginUtilization: 0,
      tradesToday: 0,
      dailyPnl: 0,
      maxDrawdownToday: 0,
      availableRiskBudget: 1,
      lastTradeTimestamp: null
    };
  }

  // ─── Feed analyzers only (no trade execution) for always-on monitoring ─────
  async feedMonitoringData(marketData: MarketData): Promise<{ pareto?: ParetoState; regime?: RegimeResult; signalFilter?: SignalFilterState }> {
    // Aggregate into 15m candles
    this.candleAggregator.processTick({
      price: marketData.price,
      volume: parseFloat(marketData.orderBook.bids[0]?.[1] ?? '0'),
      timestamp: marketData.timestamp,
    });

    // Feed Pareto analyzer (log returns from every tick)
    this.paretoAnalyzer.addPrice(marketData.price);

    // Feed dynamic thresholds
    const atrState = this.candleAggregator.getATR();
    if (atrState > 0) {
      this.dynamicThresholds.addATR(atrState);
    }
    this.dynamicThresholds.addPrice(marketData.price);

    // Periodic Pareto analysis
    this.paretoTickCounter++;
    if (this.paretoTickCounter >= this.paretoAnalysisInterval) {
      this.paretoTickCounter = 0;
      this.lastParetoState = this.paretoAnalyzer.analyze();
      this.lastRegime = this.dynamicThresholds.detectRegime(atrState, marketData.price);
    }

    // HMM regime detection (runs more frequently than Pareto) — awaited for immediate use
    this.hmmTickCounter++;
    if (this.hmmTickCounter >= this.hmmAnalysisInterval) {
      this.hmmTickCounter = 0;
      const priceChange = this.prevPrice > 0
        ? (marketData.price - this.prevPrice) / this.prevPrice : 0;
      const microstructure = this.featureExtractor.extractMicrostructure(marketData.orderBook);
      try {
        this.lastHmmRegime = await this.hmmRegimeDetector.detectRegime(microstructure, priceChange);
      } catch {
        /* HMM detection failed — keep last known regime */
      }
    }
    // Feed gradient monitor with price-derived pseudo-signals in monitoring mode
    // so the surprise detector has real data even when execution is disabled
    const priceDir = this.prevPrice > 0
      ? Math.sign(marketData.price - this.prevPrice) : 0;
    const priceVolatility = this.prevPrice > 0
      ? Math.abs(marketData.price - this.prevPrice) / this.prevPrice : 0;
    // Use price direction as pseudo-signal, spread-based confidence proxy
    const spread = parseFloat(marketData.orderBook.asks[0]?.[0] ?? '0')
      - parseFloat(marketData.orderBook.bids[0]?.[0] ?? '0');
    const midPrice = marketData.price;
    const spreadPct = midPrice > 0 ? spread / midPrice : 0;
    const pseudoConfidence = Math.max(0.1, Math.min(0.95, 1 - spreadPct * 100));
    this.gradientMonitor.addSignal(priceDir, pseudoConfidence);
    this.gradientMonitor.addLoss(priceVolatility);

    this.prevPrice = marketData.price;

    // ─── Feed Ensemble Signal Generator ─────────────────────────────────────
    const depth = Math.min(5, marketData.orderBook.bids.length, marketData.orderBook.asks.length);
    let bidVol = 0, askVol = 0;
    for (let d = 0; d < depth; d++) {
      bidVol += parseFloat(marketData.orderBook.bids[d]?.[1] ?? '0');
      askVol += parseFloat(marketData.orderBook.asks[d]?.[1] ?? '0');
    }
    const totalVol = bidVol + askVol;
    const obi = totalVol > 0 ? ((bidVol - askVol) / totalVol) * 100 : 0;

    // Use price direction as A3C proxy in monitoring mode
    const currentDrawdown = this.portfolioState.maxDrawdownToday / (this.portfolio + 1e-10);
    this.lastEnsemble = this.ensembleGenerator.update(
      marketData.price, obi, bidVol, askVol, spread,
      priceDir, pseudoConfidence, currentDrawdown,
    );

    // Compute monitoring surprise and build signalFilter for dashboard
    const monitoringSurprise = this.gradientMonitor.computeSurprise();

    // Apply HMM filter to pseudo-signal for meaningful confidence display
    let monitoringAdj = 1.0;
    let monitoringReason: string | null = null;
    if (this.lastHmmRegime) {
      const pseudoSignal: TradingSignal = { direction: priceDir, confidence: pseudoConfidence, strength: 0, timestamp: Date.now() };
      const hmmResult = this.applyHMMFilter(pseudoSignal);
      monitoringAdj = hmmResult.hmmConfidenceAdj;
      monitoringReason = hmmResult.filterReason;
    }
    const monitoredFiltered = Math.min(1.0, pseudoConfidence * monitoringAdj);

    this.lastSignalFilter = {
      hmmRegime: this.lastHmmRegime?.name ?? 'initializing',
      hmmMomentum: this.lastHmmRegime?.momentum ?? 0,
      hmmIsTransition: this.lastHmmRegime?.isTransition ?? false,
      hmmConfidenceAdj: monitoringAdj,
      gradientSurprise: monitoringSurprise,
      originalConfidence: pseudoConfidence,
      filteredConfidence: monitoredFiltered,
      filterReason: this.lastHmmRegime ? monitoringReason : 'HMM initializing — awaiting first regime detection',
      blocked: monitoringSurprise.shouldBlockTrade,
      kalman: this.lastEnsemble?.kalman ?? undefined,
      linReg: this.lastEnsemble?.linReg ?? undefined,
      naiveBayes: this.lastEnsemble?.naiveBayes ?? undefined,
      ensemble: this.lastEnsemble ?? undefined,
    };

    return {
      pareto: this.lastParetoState ?? undefined,
      regime: this.lastRegime ?? undefined,
      signalFilter: this.lastSignalFilter,
    };
  }

  // ─── MCML: HMM Signal Quality Filter ─────────────────────────────────────────
  // Adjusts signal confidence based on HMM regime alignment.
  // Reduces False Positives by vetoing signals that contradict the detected regime.
  private applyHMMFilter(signal: TradingSignal): {
    filteredConfidence: number;
    hmmConfidenceAdj: number;
    blocked: boolean;
    filterReason: string | null;
  } {
    if (!this.lastHmmRegime) {
      return { filteredConfidence: signal.confidence, hmmConfidenceAdj: 1.0, blocked: false, filterReason: null };
    }

    const regime = this.lastHmmRegime;
    const dir = signal.direction;
    let adj = 1.0;
    let filterReason: string | null = null;
    let blocked = false;

    switch (regime.name) {
      case 'trending_up':
        if (dir > 0) {
          adj = 1.1; // Boost buy in uptrend
          filterReason = 'BUY aligned with trending_up — boosted';
        } else if (dir < 0) {
          adj = 0.4; // Heavy penalty for sell in uptrend
          filterReason = 'SELL contradicts trending_up — reduced';
        }
        break;

      case 'trending_down':
        if (dir < 0) {
          adj = 1.1; // Boost sell in downtrend
          filterReason = 'SELL aligned with trending_down — boosted';
        } else if (dir > 0) {
          adj = 0.4; // Heavy penalty for buy in downtrend
          filterReason = 'BUY contradicts trending_down — reduced';
        }
        break;

      case 'ranging':
        adj = 0.5; // Reduce all signals in ranging market (high false positive zone)
        filterReason = 'Ranging regime — all signals reduced';
        break;

      case 'volatile':
        adj = 0.3; // Nearly block in volatile regime
        filterReason = 'Volatile regime — signals heavily dampened';
        if (regime.volatility > 0.025) {
          blocked = true;
          filterReason = 'Extreme volatility regime — trades blocked';
        }
        break;

      case 'breakout':
        if (regime.isTransition) {
          adj = 0.7; // Cautious during breakout transition
          filterReason = 'Breakout transition — reduced confidence';
        } else {
          adj = 0.9; // Mild reduction for established breakout
          filterReason = 'Breakout regime — slight caution';
        }
        break;

      default:
        adj = 1.0;
    }

    // During regime transitions, add extra caution
    if (regime.isTransition && !blocked) {
      adj *= 0.8;
      filterReason = (filterReason ?? '') + ' + regime transition penalty';
    }

    const filteredConfidence = Math.min(1.0, signal.confidence * adj);
    return { filteredConfidence, hmmConfidenceAdj: adj, blocked, filterReason };
  }

  async processTick(marketData: MarketData): Promise<PaperTradeResult> {
    let signal = await this.engine.processMarketData(
      marketData.orderBook,
      marketData.openInterest,
      marketData.fundingRate
    );

    let execution: ExecutionReport | undefined;
    let reward: number | undefined;

    // ATIS generation (analyzers already fed by feedMonitoringData)
    const symbolInput = this.candleAggregator.buildSymbolInput(marketData.price);
    if (symbolInput) {
      this.lastATIS = this.characteristor.generateATIS(symbolInput);
    }

    // Emit pareto events for monitoring
    if (this.lastParetoState) {
      this.emit('pareto_update', this.lastParetoState);
      if (this.lastParetoState.shouldLiquidate) {
        this.emit('liquidation_warning', this.lastParetoState);
      }
    }

    // ─── MCML Gate 1: Gradient Surprise Monitor ───────────────────────────
    this.gradientMonitor.addSignal(signal.direction, signal.confidence);
    const lossProxy = signal.metadata?.volatility != null
      ? (signal.metadata.volatility as number)
      : (1 - signal.confidence);
    this.gradientMonitor.addLoss(lossProxy);
    const surpriseState = this.gradientMonitor.computeSurprise();

    // ─── MCML Gate 2: HMM Signal Quality Filter ──────────────────────────
    const hmmFilter = this.applyHMMFilter(signal);

    // ─── MCML Gate 3: Ensemble Signal Generator (8-condition gate) ────────
    // Extract order book features for ensemble
    const obDepth = Math.min(5, marketData.orderBook.bids.length, marketData.orderBook.asks.length);
    let bidVol = 0, askVol = 0;
    for (let d = 0; d < obDepth; d++) {
      bidVol += parseFloat(marketData.orderBook.bids[d]?.[1] ?? '0');
      askVol += parseFloat(marketData.orderBook.asks[d]?.[1] ?? '0');
    }
    const totalVol = bidVol + askVol;
    const obi = totalVol > 0 ? ((bidVol - askVol) / totalVol) * 100 : 0;
    const spread = parseFloat(marketData.orderBook.asks[0]?.[0] ?? '0')
      - parseFloat(marketData.orderBook.bids[0]?.[0] ?? '0');

    // Compute drawdown fraction for CPO constraint
    const equity = this.portfolio + this.position * marketData.price;
    const currentDrawdown = this.equityPeak > 0 ? Math.max(0, (this.equityPeak - equity) / this.equityPeak) : 0;

    // Feed ensemble with A3C signal from MLTradingCore + all market features
    // Optional candle from the aggregator
    const lastCandle = this.candleAggregator.getCurrentOrLastCandle();
    const candleForPattern = lastCandle ? {
      open: lastCandle.open, high: lastCandle.high,
      low: lastCandle.low, close: lastCandle.close,
      volume: lastCandle.volume,
    } : undefined;

    this.lastEnsemble = this.ensembleGenerator.update(
      marketData.price, obi, bidVol, askVol, spread,
      signal.direction, signal.confidence, currentDrawdown,
      candleForPattern,
    );

    // Combine HMM + Gradient + Ensemble into final decision
    const ensembleConfidence = this.lastEnsemble.ensembleScore;
    const filteredConfidence = Math.min(1.0, ensembleConfidence * hmmFilter.hmmConfidenceAdj);

    // Build signal filter state for dashboard
    this.lastSignalFilter = {
      hmmRegime: this.lastHmmRegime?.name ?? 'unknown',
      hmmMomentum: this.lastHmmRegime?.momentum ?? 0,
      hmmIsTransition: this.lastHmmRegime?.isTransition ?? false,
      hmmConfidenceAdj: hmmFilter.hmmConfidenceAdj,
      gradientSurprise: surpriseState,
      originalConfidence: signal.confidence,
      filteredConfidence,
      filterReason: hmmFilter.filterReason ?? surpriseState.blockReason,
      blocked: hmmFilter.blocked || surpriseState.shouldBlockTrade,
      kalman: this.lastEnsemble.kalman,
      linReg: this.lastEnsemble.linReg,
      naiveBayes: this.lastEnsemble.naiveBayes,
      ensemble: this.lastEnsemble,
      exitSignal: this.lastExitSignal ?? undefined,
    };

    // ─── Exit Evaluation (if we have an open position) ────────────────────
    if (this.position !== 0 && this.lastEnsemble) {
      const posDir: 1 | -1 = this.position > 0 ? 1 : -1;
      const tpPrice = this.lastATIS?.tp?.price ?? null;
      const slPrice = this.lastATIS?.sl?.price ?? null;
      const maxExposure = this.portfolio * 0.5; // 50% max exposure
      const portfolioExposure = Math.abs(this.position * marketData.price);

      this.lastExitSignal = this.ensembleGenerator.evaluateExit(
        marketData.price, this.avgEntryPrice,
        tpPrice !== null ? Number(tpPrice) : null,
        slPrice !== null ? Number(slPrice) : null,
        posDir, this.lastEnsemble,
        signal.direction, signal.confidence,
        currentDrawdown, portfolioExposure, maxExposure,
      );

      // Force exit if exit signal fires
      if (this.lastExitSignal.shouldExit) {
        const exitDir: -1 | 1 = posDir === 1 ? -1 : 1; // Close in opposite direction
        const exitSize = Math.abs(this.position);
        const exitResult = this.executionEngine.executeOrder(
          { direction: exitDir, size: exitSize, urgency: this.lastExitSignal.urgency },
          marketData.orderBook, { volatility: 0 },
        );
        if (exitResult.status === 'filled' && exitResult.filledSize > 0) {
          const realizedPnl = exitResult.filledSize * (exitResult.fillPrice - this.avgEntryPrice) * posDir;
          execution = { realizedPnl, fillPrice: exitResult.fillPrice, midPriceAtOrder: exitResult.midPriceAtOrder };
          // Close position: for long, sell proceeds; for short, buy-to-cover
          this.portfolio += exitResult.fillPrice * exitResult.filledSize;
          this.position = 0;
          this.avgEntryPrice = 0;
          this.ensembleGenerator.onExitFilled();
          this.trades.push({
            type: posDir === 1 ? 'SELL' : 'BUY',
            price: exitResult.fillPrice,
            size: exitResult.filledSize,
            timestamp: marketData.timestamp,
            pnl: realizedPnl,
          });
          this.emit('trade_exit', { reason: this.lastExitSignal.reason, pnl: realizedPnl });
        }
      }
    } else {
      this.lastExitSignal = null;
    }

    // ─── Entry Decision: Ensemble 8-condition gate ────────────────────────
    const alphaBlocked = this.lastParetoState
      && this.lastParetoState.alphaState === AlphaRiskState.LOCKOUT;
    const gradientBlocked = surpriseState.shouldBlockTrade;
    const hmmBlocked = hmmFilter.blocked;

    const ensembleShouldEnter = this.lastEnsemble.shouldEnter && this.lastEnsemble.direction !== 0;
    const noBlockers = !alphaBlocked && !gradientBlocked && !hmmBlocked;

    if (noBlockers && ensembleShouldEnter && this.position === 0) {
      const direction = this.lastEnsemble.direction as 1 | -1;
      // Position size: riskPerTrade * account / price, scaled by Pareto + ensemble confidence
      const paretoMultiplier = this.lastParetoState
        ? this.lastParetoState.positionSizeMultiplier : 1.0;
      const riskPerTrade = 0.02; // 2% of account
      const baseSize = Math.abs((this.portfolio * riskPerTrade * ensembleConfidence) / marketData.price);
      const size = baseSize * paretoMultiplier;

      const executionResult = this.executionEngine.executeOrder(
        { direction, size, urgency: ensembleConfidence },
        marketData.orderBook, { volatility: 0 },
      );

      if (executionResult.status === 'filled' && executionResult.filledSize > 0) {
        execution = {
          realizedPnl: 0,
          fillPrice: executionResult.fillPrice,
          midPriceAtOrder: executionResult.midPriceAtOrder,
        };

        if (direction > 0) {
          const cost = executionResult.fillPrice * executionResult.filledSize;
          this.portfolio -= cost;
          const totalPositionCost = this.position * this.avgEntryPrice + cost;
          this.position += executionResult.filledSize;
          this.avgEntryPrice = this.position > 0 ? totalPositionCost / this.position : 0;
          this.trades.push({
            type: 'BUY', price: executionResult.fillPrice,
            size: executionResult.filledSize, timestamp: marketData.timestamp, pnl: 0,
          });
        } else {
          const exitSize = Math.min(this.position, executionResult.filledSize);
          const realizedPnl = exitSize * (executionResult.fillPrice - this.avgEntryPrice);
          this.portfolio += executionResult.fillPrice * executionResult.filledSize;
          this.position = Math.max(0, this.position - executionResult.filledSize);
          if (this.position === 0) this.avgEntryPrice = 0;
          this.trades.push({
            type: 'SELL', price: executionResult.fillPrice,
            size: executionResult.filledSize, timestamp: marketData.timestamp, pnl: realizedPnl,
          });
          execution.realizedPnl = realizedPnl;
        }

        // Notify ensemble of entry fill
        this.ensembleGenerator.onEntryFilled(direction, executionResult.fillPrice, ensembleConfidence);

        const newEquity = this.portfolio + this.position * marketData.price;
        this.equityPeak = Math.max(this.equityPeak, newEquity);
        const drawdown = this.equityPeak - newEquity;

        const nextState: PortfolioState = {
          ...this.portfolioState,
          position: this.position,
          unrealizedPnl: this.position * (marketData.price - this.avgEntryPrice),
          dailyPnl: newEquity - 100000,
          tradesToday: this.portfolioState.tradesToday + 1,
          maxDrawdownToday: Math.max(this.portfolioState.maxDrawdownToday, drawdown),
          lastTradeTimestamp: marketData.timestamp,
        };

        reward = this.rewardCalculator.computeReward(
          { portfolio: this.portfolioState },
          { portfolio: nextState },
          execution, direction,
        );

        this.portfolioState = nextState;
        this.riskManager.updatePortfolioState(nextState);
        this.emit('trade', { signal, execution: executionResult, reward });
      }
    }

    // Enrich signal metadata with ATIS + ensemble
    if (this.lastATIS) {
      signal = {
        ...signal,
        metadata: {
          ...signal.metadata,
          atis: {
            flightPhase: this.lastATIS.flightPhase,
            turbulence: this.lastATIS.turbulence,
            traffic: this.lastATIS.traffic,
            squawk: this.lastATIS.squawk,
            action: this.lastATIS.action,
            metar: this.lastATIS.metar,
            tp: this.lastATIS.tp?.price ?? null,
            sl: this.lastATIS.sl?.price ?? null,
          },
        },
      };
    }

    const result: PaperTradeResult = {
      signal,
      execution,
      reward,
      portfolio: { ...this.portfolioState },
      trades: [...this.trades],
      atis: this.lastATIS ?? undefined,
      pareto: this.lastParetoState ?? undefined,
      regime: this.lastRegime ?? undefined,
      signalFilter: this.lastSignalFilter ?? undefined,
      ensemble: this.lastEnsemble ?? undefined,
      exitSignal: this.lastExitSignal ?? undefined,
    };

    this.emit('portfolio_update', result);

    return result;
  }
}

export default PaperTradingEngine;
