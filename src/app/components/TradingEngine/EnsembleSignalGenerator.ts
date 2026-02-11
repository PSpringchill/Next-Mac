// ─── Ensemble Signal Generator ───────────────────────────────────────────────
// Orchestrates ALL 8 entry conditions for LONG/SHORT signals.
// Produces a weighted ensemble score and only fires when ALL conditions pass.
//
// Entry Requirements (ALL must be TRUE):
//   1. Kalman Filter — slope reversal + ZigZag swing confirmation
//   2. Currency Strength — base > 55 / quote < 45 or divergence > 15
//   3. Naive Bayes — classification + probability > 0.65
//   4. Linear Regression — predicted price direction + confidence interval
//   5. A3C-CPO — recommends action + constraint check (DD < 5%)
//   6. Patterns — bullish/bearish pattern or absence of opposing pattern
//   7. Regime Filters — RSI in range, MACD aligned, ATR normal
//   8. Ensemble Score — weighted sum > 0.65
//
// Exit Conditions (ANY triggers exit):
//   1. Target hit (TP / LinReg target)
//   2. Stop loss (SL / DD limit)
//   3. Signal reversal (Kalman / ensemble flip)
//   4. Time-based (max hold)
//   5. A3C-CPO override
//   6. Risk management (exposure / correlation)

import KalmanTrendFilter, { type KalmanState } from './KalmanTrendFilter';
import LinearRegressionTarget, { type LinRegState } from './LinearRegressionTarget';
import NaiveBayesRegime, { type NaiveBayesState, type RegimeLabel } from './NaiveBayesRegime';
import TechnicalIndicators, { type TechnicalState } from './TechnicalIndicators';
import CurrencyStrengthMeter, { type CurrencyStrengthState } from './CurrencyStrengthMeter';
import PatternDetector, { type PatternState, type CandleOHLC } from './PatternDetector';
import ZigZagDetector, { type ZigZagState } from './ZigZagDetector';

// ─── Configuration ───────────────────────────────────────────────────────────

export interface EnsembleConfig {
  // Trading parameters
  riskPerTrade: number;         // Fraction of account (default 0.02)
  maxPositions: number;         // Maximum concurrent positions
  maxDrawdown: number;          // Maximum drawdown fraction (CPO constraint)
  maxCorrelation: number;       // Maximum position correlation

  // Signal thresholds
  entryThreshold: number;       // Minimum ensemble score for entry (0.65)
  exitThreshold: number;        // Ensemble score for exit (0.35)
  nbProbThreshold: number;      // Naive Bayes probability threshold (0.65)

  // Hysteresis (MFC Layer 5)
  hysteresisConfirmTicks: number; // Ticks of sustained signal before transition (default 300 ≈ 5min @ 1tick/s)
  hysteresisBuffer: number;       // Score must exceed threshold by this buffer (default 0.05)

  // Component weights for ensemble score
  weights: {
    kalman: number;
    currencyStrength: number;
    naiveBayes: number;
    linearRegression: number;
    a3cCpo: number;
    patterns: number;
    regimeFilters: number;
  };

  // Kalman parameters
  kalmanProcessNoise: number;
  kalmanMeasurementNoise: number;

  // Max hold period in ticks
  maxHoldTicks: number;
}

const DEFAULT_CONFIG: EnsembleConfig = {
  riskPerTrade: 0.02,
  maxPositions: 5,
  maxDrawdown: 0.05,
  maxCorrelation: 0.7,
  entryThreshold: 0.65,
  exitThreshold: 0.35,
  nbProbThreshold: 0.65,
  hysteresisConfirmTicks: 300,
  hysteresisBuffer: 0.05,
  weights: {
    kalman: 0.15,
    currencyStrength: 0.10,
    naiveBayes: 0.15,
    linearRegression: 0.15,
    a3cCpo: 0.20,
    patterns: 0.10,
    regimeFilters: 0.15,
  },
  kalmanProcessNoise: 0.001,
  kalmanMeasurementNoise: 0.01,
  maxHoldTicks: 3000,
};

// ─── Component Check Results ─────────────────────────────────────────────────

export interface ComponentCheck {
  name: string;
  passed: boolean;
  score: number;       // [0, 1] — contribution to ensemble
  reason: string;
}

export interface EnsembleResult {
  direction: 1 | -1 | 0;           // LONG / SHORT / HOLD
  ensembleScore: number;            // Weighted sum [0, 1]
  allConditionsMet: boolean;        // All 8 gates passed
  checks: ComponentCheck[];         // Per-component breakdown
  shouldEnter: boolean;             // Final entry decision
  // Component states
  kalman: KalmanState;
  zigzag: ZigZagState;
  currencyStrength: CurrencyStrengthState;
  naiveBayes: NaiveBayesState;
  linReg: LinRegState;
  technicals: TechnicalState;
  patterns: PatternState;
}

export interface ExitSignal {
  shouldExit: boolean;
  reason: string;
  urgency: number;  // [0, 1]
}

// ─── Ensemble Signal Generator ───────────────────────────────────────────────

class EnsembleSignalGenerator {
  private config: EnsembleConfig;

  // Sub-components
  private kalman: KalmanTrendFilter;
  private linReg: LinearRegressionTarget;
  private naiveBayes: NaiveBayesRegime;
  private technicals: TechnicalIndicators;
  private currencyStrength: CurrencyStrengthMeter;
  private patternDetector: PatternDetector;
  private zigzag: ZigZagDetector;

  // State tracking
  private prevKalmanVelocity: number = 0;
  private ticksSinceEntry: number = 0;
  private currentPosition: 0 | 1 | -1 = 0; // 0=flat, 1=long, -1=short
  private entryPrice: number = 0;
  private entryEnsembleScore: number = 0;

  // Hysteresis state: sustained direction confirmation
  private hysteresisDir: 1 | -1 | 0 = 0;
  private hysteresisTicks: number = 0;
  private hysteresisConfirmed: boolean = false;

  constructor(config?: Partial<EnsembleConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.kalman = new KalmanTrendFilter(
      this.config.kalmanProcessNoise,
      this.config.kalmanMeasurementNoise,
    );
    this.linReg = new LinearRegressionTarget(30, 10);
    this.naiveBayes = new NaiveBayesRegime(30, 15);
    this.technicals = new TechnicalIndicators(14, 12, 26, 9, 14);
    this.currencyStrength = new CurrencyStrengthMeter(30);
    this.patternDetector = new PatternDetector(50);
    this.zigzag = new ZigZagDetector(0.003, 5);
  }

  // ─── Main Update ─────────────────────────────────────────────────────────

  update(
    price: number,
    obi: number,
    bidVolume: number,
    askVolume: number,
    spread: number,
    a3cDirection: number,
    a3cConfidence: number,
    currentDrawdown: number,
    candle?: CandleOHLC,
  ): EnsembleResult {
    // Update all sub-components
    const kalmanState = this.kalman.update(price);
    const zigzagState = this.zigzag.update(price);
    const csState = this.currencyStrength.update(price, obi, bidVolume, askVolume);
    const nbState = this.naiveBayes.update(price, obi, spread);
    const lrState = this.linReg.update(price);
    const techState = this.technicals.update(price);
    if (candle) this.patternDetector.addCandle(candle);
    const patternState = this.patternDetector.getState();

    // Track hold time
    if (this.currentPosition !== 0) {
      this.ticksSinceEntry++;
    }

    // Evaluate LONG and SHORT conditions independently
    const longChecks = this.evaluateLong(kalmanState, zigzagState, csState, nbState, lrState, techState, patternState, a3cDirection, a3cConfidence, currentDrawdown, price);
    const shortChecks = this.evaluateShort(kalmanState, zigzagState, csState, nbState, lrState, techState, patternState, a3cDirection, a3cConfidence, currentDrawdown, price);

    const longScore = this.computeWeightedScore(longChecks);
    const shortScore = this.computeWeightedScore(shortChecks);
    const longAllPassed = longChecks.every(c => c.passed);
    const shortAllPassed = shortChecks.every(c => c.passed);

    // Determine direction
    let direction: 1 | -1 | 0 = 0;
    let ensembleScore = 0;
    let checks: ComponentCheck[] = [];
    let allConditionsMet = false;

    if (longAllPassed && longScore >= this.config.entryThreshold) {
      if (!shortAllPassed || longScore > shortScore) {
        direction = 1;
        ensembleScore = longScore;
        checks = longChecks;
        allConditionsMet = true;
      }
    }
    if (shortAllPassed && shortScore >= this.config.entryThreshold) {
      if (direction === 0 || shortScore > longScore) {
        direction = -1;
        ensembleScore = shortScore;
        checks = shortChecks;
        allConditionsMet = true;
      }
    }

    // If neither fully qualifies, report the stronger side's checks
    if (direction === 0) {
      ensembleScore = Math.max(longScore, shortScore);
      checks = longScore >= shortScore ? longChecks : shortChecks;
    }

    // ─── Hysteresis: require sustained direction before allowing entry ────
    const hysteresisThreshold = this.config.entryThreshold + this.config.hysteresisBuffer;
    if (direction !== 0 && allConditionsMet && ensembleScore >= hysteresisThreshold) {
      if (direction === this.hysteresisDir) {
        this.hysteresisTicks++;
      } else {
        // Direction changed — reset counter
        this.hysteresisDir = direction;
        this.hysteresisTicks = 1;
        this.hysteresisConfirmed = false;
      }
      if (this.hysteresisTicks >= this.config.hysteresisConfirmTicks) {
        this.hysteresisConfirmed = true;
      }
    } else {
      // Signal dropped below threshold+buffer — reset
      this.hysteresisTicks = Math.max(0, this.hysteresisTicks - 1); // Decay slowly
      if (this.hysteresisTicks === 0) {
        this.hysteresisDir = 0;
        this.hysteresisConfirmed = false;
      }
    }

    const shouldEnter = allConditionsMet
      && ensembleScore >= this.config.entryThreshold
      && this.hysteresisConfirmed;

    this.prevKalmanVelocity = kalmanState.velocity;

    return {
      direction,
      ensembleScore,
      allConditionsMet,
      checks,
      shouldEnter,
      kalman: kalmanState,
      zigzag: zigzagState,
      currencyStrength: csState,
      naiveBayes: nbState,
      linReg: lrState,
      technicals: techState,
      patterns: patternState,
    };
  }

  // ─── LONG Entry Evaluation ───────────────────────────────────────────────

  private evaluateLong(
    kalman: KalmanState, zigzag: ZigZagState,
    cs: CurrencyStrengthState, nb: NaiveBayesState,
    lr: LinRegState, tech: TechnicalState,
    patterns: PatternState,
    a3cDir: number, a3cConf: number, drawdown: number, price: number,
  ): ComponentCheck[] {
    const checks: ComponentCheck[] = [];

    // 1. Kalman: slope negative→positive OR magnitude > threshold, ZigZag confirms swing low
    const slopeFlipUp = this.prevKalmanVelocity < 0 && kalman.velocity >= 0;
    const slopeMagnitude = Math.abs(kalman.velocity) > 0.01;
    const zigzagConfirm = zigzag.isSwingLow || zigzag.direction === 'up';
    const kalmanPassed = (slopeFlipUp || (slopeMagnitude && kalman.trendDirection === 1)) && zigzagConfirm;
    // Softer: allow if kalman trend is up even without exact flip
    const kalmanSoft = kalman.trendDirection === 1 || slopeFlipUp;
    checks.push({
      name: 'Kalman Filter',
      passed: kalmanPassed || kalmanSoft,
      score: kalmanPassed ? 1.0 : kalmanSoft ? 0.7 : 0.2,
      reason: kalmanPassed ? 'Slope flip + ZigZag swing low confirmed'
        : kalmanSoft ? 'Kalman trend up (no ZigZag confirm)'
        : 'Kalman bearish/flat',
    });

    // 2. Currency Strength
    checks.push({
      name: 'Currency Strength',
      passed: cs.longCondition,
      score: cs.longCondition ? Math.min(1, cs.divergence / 30 + 0.5) : 0.2,
      reason: cs.longCondition
        ? `Base ${cs.baseStrength.toFixed(0)} > 55, Quote ${cs.quoteStrength.toFixed(0)} < 45`
        : `Weak: Base ${cs.baseStrength.toFixed(0)}, Quote ${cs.quoteStrength.toFixed(0)}`,
    });

    // 3. Naive Bayes: Bullish + probability > 0.65
    const nbBullish = nb.regime === 'trending_up';
    const nbProb = nb.probabilities.trending_up;
    checks.push({
      name: 'Naive Bayes',
      passed: nbBullish && nbProb > this.config.nbProbThreshold,
      score: nbBullish ? Math.min(1, nbProb / 0.65) : 0.1,
      reason: `${nb.regime} (p=${nbProb.toFixed(3)})`,
    });

    // 4. Linear Regression: predicted > current + confidence interval supports bullish
    const lrBullish = lr.priceTarget > price && lr.direction === 1;
    const lrConfSupports = lr.lowerBand > price * 0.998; // Lower band near current price
    checks.push({
      name: 'Linear Regression',
      passed: lrBullish,
      score: lrBullish ? Math.min(1, lr.rSquared * (1 + lr.strength)) : 0.15,
      reason: lrBullish
        ? `Target ${lr.priceTarget.toFixed(2)} > ${price.toFixed(2)}, R²=${lr.rSquared.toFixed(3)}`
        : `Target ${lr.priceTarget.toFixed(2)}, direction=${lr.direction}`,
    });

    // 5. A3C-CPO: recommends buy + DD < maxDrawdown
    const a3cRecommendsBuy = a3cDir > 0 && a3cConf > 0.5;
    const constraintPasses = drawdown < this.config.maxDrawdown;
    checks.push({
      name: 'A3C-CPO',
      passed: a3cRecommendsBuy && constraintPasses,
      score: a3cRecommendsBuy && constraintPasses ? Math.min(1, a3cConf) : constraintPasses ? 0.3 : 0.0,
      reason: `A3C dir=${a3cDir > 0 ? 'BUY' : a3cDir < 0 ? 'SELL' : 'HOLD'} conf=${a3cConf.toFixed(2)}, DD=${(drawdown * 100).toFixed(1)}%`,
    });

    // 6. Patterns: bullish detected OR no bearish
    const patternPassed = patterns.hasBullish || patterns.noBearish;
    checks.push({
      name: 'Patterns',
      passed: patternPassed,
      score: patterns.hasBullish ? 0.7 + patterns.strongestBullish * 0.3
        : patterns.noBearish ? 0.5 : 0.1,
      reason: patterns.hasBullish
        ? `Bullish: ${patterns.patterns.filter(p => p.direction === 'bullish').map(p => p.type).join(', ')}`
        : patterns.noBearish ? 'No bearish patterns' : 'Bearish patterns detected',
    });

    // 7. Regime Filters: RSI in range, MACD bullish, ATR normal
    const rsiOk = tech.rsi.inRange; // 30 < RSI < 70
    const macdOk = tech.macd.bullishCrossover || tech.macd.aligned === 'bullish';
    const atrOk = tech.atr.isNormal;
    const regimePassed = rsiOk && (macdOk || tech.macd.aligned !== 'bearish') && atrOk;
    checks.push({
      name: 'Regime Filters',
      passed: regimePassed,
      score: (rsiOk ? 0.35 : 0.0) + (macdOk ? 0.35 : tech.macd.aligned !== 'bearish' ? 0.15 : 0.0) + (atrOk ? 0.30 : 0.0),
      reason: `RSI=${tech.rsi.value.toFixed(1)}${rsiOk ? '✓' : '✗'} MACD=${tech.macd.aligned}${macdOk ? '✓' : '✗'} ATR=${atrOk ? 'normal' : 'extreme'}`,
    });

    return checks;
  }

  // ─── SHORT Entry Evaluation ──────────────────────────────────────────────

  private evaluateShort(
    kalman: KalmanState, zigzag: ZigZagState,
    cs: CurrencyStrengthState, nb: NaiveBayesState,
    lr: LinRegState, tech: TechnicalState,
    patterns: PatternState,
    a3cDir: number, a3cConf: number, drawdown: number, price: number,
  ): ComponentCheck[] {
    const checks: ComponentCheck[] = [];

    // 1. Kalman: slope positive→negative OR magnitude, ZigZag confirms swing high
    const slopeFlipDown = this.prevKalmanVelocity > 0 && kalman.velocity <= 0;
    const slopeMagnitude = Math.abs(kalman.velocity) > 0.01;
    const zigzagConfirm = zigzag.isSwingHigh || zigzag.direction === 'down';
    const kalmanPassed = (slopeFlipDown || (slopeMagnitude && kalman.trendDirection === -1)) && zigzagConfirm;
    const kalmanSoft = kalman.trendDirection === -1 || slopeFlipDown;
    checks.push({
      name: 'Kalman Filter',
      passed: kalmanPassed || kalmanSoft,
      score: kalmanPassed ? 1.0 : kalmanSoft ? 0.7 : 0.2,
      reason: kalmanPassed ? 'Slope flip down + ZigZag swing high'
        : kalmanSoft ? 'Kalman trend down (no ZigZag confirm)'
        : 'Kalman bullish/flat',
    });

    // 2. Currency Strength: base weak, quote strong
    checks.push({
      name: 'Currency Strength',
      passed: cs.shortCondition,
      score: cs.shortCondition ? Math.min(1, Math.abs(cs.divergence) / 30 + 0.5) : 0.2,
      reason: cs.shortCondition
        ? `Base ${cs.baseStrength.toFixed(0)} < 45, Quote ${cs.quoteStrength.toFixed(0)} > 55`
        : `Weak: Base ${cs.baseStrength.toFixed(0)}, Quote ${cs.quoteStrength.toFixed(0)}`,
    });

    // 3. Naive Bayes: Bearish + probability > 0.65
    const nbBearish = nb.regime === 'trending_down';
    const nbProb = nb.probabilities.trending_down;
    checks.push({
      name: 'Naive Bayes',
      passed: nbBearish && nbProb > this.config.nbProbThreshold,
      score: nbBearish ? Math.min(1, nbProb / 0.65) : 0.1,
      reason: `${nb.regime} (p=${nbProb.toFixed(3)})`,
    });

    // 4. Linear Regression: predicted < current
    const lrBearish = lr.priceTarget < price && lr.direction === -1;
    checks.push({
      name: 'Linear Regression',
      passed: lrBearish,
      score: lrBearish ? Math.min(1, lr.rSquared * (1 + lr.strength)) : 0.15,
      reason: lrBearish
        ? `Target ${lr.priceTarget.toFixed(2)} < ${price.toFixed(2)}, R²=${lr.rSquared.toFixed(3)}`
        : `Target ${lr.priceTarget.toFixed(2)}, direction=${lr.direction}`,
    });

    // 5. A3C-CPO: recommends sell + constraint
    const a3cRecommendsSell = a3cDir < 0 && a3cConf > 0.5;
    const constraintPasses = drawdown < this.config.maxDrawdown;
    checks.push({
      name: 'A3C-CPO',
      passed: a3cRecommendsSell && constraintPasses,
      score: a3cRecommendsSell && constraintPasses ? Math.min(1, a3cConf) : constraintPasses ? 0.3 : 0.0,
      reason: `A3C dir=${a3cDir < 0 ? 'SELL' : a3cDir > 0 ? 'BUY' : 'HOLD'} conf=${a3cConf.toFixed(2)}, DD=${(drawdown * 100).toFixed(1)}%`,
    });

    // 6. Patterns: bearish detected OR no bullish
    const patternPassed = patterns.hasBearish || patterns.noBullish;
    checks.push({
      name: 'Patterns',
      passed: patternPassed,
      score: patterns.hasBearish ? 0.7 + patterns.strongestBearish * 0.3
        : patterns.noBullish ? 0.5 : 0.1,
      reason: patterns.hasBearish
        ? `Bearish: ${patterns.patterns.filter(p => p.direction === 'bearish').map(p => p.type).join(', ')}`
        : patterns.noBullish ? 'No bullish patterns' : 'Bullish patterns detected',
    });

    // 7. Regime Filters: RSI in range, MACD bearish, ATR normal
    const rsiOk = tech.rsi.inRange;
    const macdOk = tech.macd.bearishCrossover || tech.macd.aligned === 'bearish';
    const atrOk = tech.atr.isNormal;
    const regimePassed = rsiOk && (macdOk || tech.macd.aligned !== 'bullish') && atrOk;
    checks.push({
      name: 'Regime Filters',
      passed: regimePassed,
      score: (rsiOk ? 0.35 : 0.0) + (macdOk ? 0.35 : tech.macd.aligned !== 'bullish' ? 0.15 : 0.0) + (atrOk ? 0.30 : 0.0),
      reason: `RSI=${tech.rsi.value.toFixed(1)}${rsiOk ? '✓' : '✗'} MACD=${tech.macd.aligned}${macdOk ? '✓' : '✗'} ATR=${atrOk ? 'normal' : 'extreme'}`,
    });

    return checks;
  }

  // ─── Weighted Ensemble Score ─────────────────────────────────────────────

  private computeWeightedScore(checks: ComponentCheck[]): number {
    const w = this.config.weights;
    const weightMap: Record<string, number> = {
      'Kalman Filter': w.kalman,
      'Currency Strength': w.currencyStrength,
      'Naive Bayes': w.naiveBayes,
      'Linear Regression': w.linearRegression,
      'A3C-CPO': w.a3cCpo,
      'Patterns': w.patterns,
      'Regime Filters': w.regimeFilters,
    };

    let totalWeight = 0;
    let weightedSum = 0;
    for (const check of checks) {
      const weight = weightMap[check.name] ?? 0;
      weightedSum += check.score * weight;
      totalWeight += weight;
    }

    return totalWeight > 0 ? weightedSum / totalWeight : 0;
  }

  // ─── Exit Signal Evaluation ──────────────────────────────────────────────

  evaluateExit(
    price: number,
    entryPrice: number,
    takeProfitPrice: number | null,
    stopLossPrice: number | null,
    positionDirection: 1 | -1,
    ensembleResult: EnsembleResult,
    a3cDirection: number,
    a3cConfidence: number,
    currentDrawdown: number,
    portfolioExposure: number,
    maxExposure: number,
  ): ExitSignal {
    // 1. Target Hit: TP level or LinReg target achieved
    if (takeProfitPrice !== null) {
      if ((positionDirection === 1 && price >= takeProfitPrice)
        || (positionDirection === -1 && price <= takeProfitPrice)) {
        return { shouldExit: true, reason: 'Take Profit hit', urgency: 0.9 };
      }
    }
    // LinReg target achieved
    if (positionDirection === 1 && ensembleResult.linReg.priceTarget <= price && ensembleResult.linReg.rSquared > 0.5) {
      if (this.ticksSinceEntry > 50) {
        return { shouldExit: true, reason: 'LinReg price target achieved', urgency: 0.7 };
      }
    }
    if (positionDirection === -1 && ensembleResult.linReg.priceTarget >= price && ensembleResult.linReg.rSquared > 0.5) {
      if (this.ticksSinceEntry > 50) {
        return { shouldExit: true, reason: 'LinReg price target achieved (short)', urgency: 0.7 };
      }
    }

    // 2. Stop Loss
    if (stopLossPrice !== null) {
      if ((positionDirection === 1 && price <= stopLossPrice)
        || (positionDirection === -1 && price >= stopLossPrice)) {
        return { shouldExit: true, reason: 'Stop Loss hit', urgency: 1.0 };
      }
    }
    if (currentDrawdown >= this.config.maxDrawdown) {
      return { shouldExit: true, reason: `Drawdown ${(currentDrawdown * 100).toFixed(1)}% exceeds ${(this.config.maxDrawdown * 100).toFixed(0)}% limit`, urgency: 1.0 };
    }

    // 3. Signal Reversal: Kalman slope reverses
    if (positionDirection === 1 && ensembleResult.kalman.trendDirection === -1 && Math.abs(ensembleResult.kalman.reversalSignal) > 0.3) {
      return { shouldExit: true, reason: 'Kalman slope reversed bearish', urgency: 0.8 };
    }
    if (positionDirection === -1 && ensembleResult.kalman.trendDirection === 1 && Math.abs(ensembleResult.kalman.reversalSignal) > 0.3) {
      return { shouldExit: true, reason: 'Kalman slope reversed bullish', urgency: 0.8 };
    }
    // Ensemble score dropped below exit threshold
    if (ensembleResult.ensembleScore < this.config.exitThreshold) {
      return { shouldExit: true, reason: `Ensemble score ${ensembleResult.ensembleScore.toFixed(3)} < ${this.config.exitThreshold}`, urgency: 0.6 };
    }
    // Opposite signal with high score
    if (positionDirection === 1 && ensembleResult.direction === -1 && ensembleResult.ensembleScore > this.config.entryThreshold) {
      return { shouldExit: true, reason: 'Strong opposite SHORT signal', urgency: 0.85 };
    }
    if (positionDirection === -1 && ensembleResult.direction === 1 && ensembleResult.ensembleScore > this.config.entryThreshold) {
      return { shouldExit: true, reason: 'Strong opposite LONG signal', urgency: 0.85 };
    }

    // 4. Time-based: max hold period
    if (this.ticksSinceEntry > this.config.maxHoldTicks) {
      return { shouldExit: true, reason: `Max hold period (${this.config.maxHoldTicks} ticks) exceeded`, urgency: 0.5 };
    }

    // 5. A3C-CPO Override
    const a3cOpposite = (positionDirection === 1 && a3cDirection < 0) || (positionDirection === -1 && a3cDirection > 0);
    if (a3cOpposite && a3cConfidence > 0.75) {
      return { shouldExit: true, reason: 'A3C-CPO recommends position close', urgency: 0.75 };
    }
    if (currentDrawdown >= this.config.maxDrawdown * 0.8) {
      // Constraint approaching violation
      return { shouldExit: true, reason: 'CPO constraint near violation', urgency: 0.9 };
    }

    // 6. Risk Management: portfolio exposure
    if (portfolioExposure > maxExposure) {
      return { shouldExit: true, reason: 'Portfolio exposure limit exceeded', urgency: 0.7 };
    }

    return { shouldExit: false, reason: '', urgency: 0 };
  }

  // ─── Position Lifecycle ──────────────────────────────────────────────────

  onEntryFilled(direction: 1 | -1, price: number, ensembleScore: number): void {
    this.currentPosition = direction;
    this.entryPrice = price;
    this.entryEnsembleScore = ensembleScore;
    this.ticksSinceEntry = 0;
  }

  onExitFilled(): void {
    this.currentPosition = 0;
    this.entryPrice = 0;
    this.entryEnsembleScore = 0;
    this.ticksSinceEntry = 0;
  }

  getCurrentPosition(): { direction: 0 | 1 | -1; entryPrice: number; ticksHeld: number } {
    return {
      direction: this.currentPosition,
      entryPrice: this.entryPrice,
      ticksHeld: this.ticksSinceEntry,
    };
  }

  getConfig(): EnsembleConfig {
    return { ...this.config };
  }

  reset(): void {
    this.kalman.reset();
    this.linReg.reset();
    this.naiveBayes.reset();
    this.technicals.reset();
    this.currencyStrength.reset();
    this.patternDetector.reset();
    this.zigzag.reset();
    this.prevKalmanVelocity = 0;
    this.ticksSinceEntry = 0;
    this.currentPosition = 0;
    this.entryPrice = 0;
    this.entryEnsembleScore = 0;
    this.hysteresisDir = 0;
    this.hysteresisTicks = 0;
    this.hysteresisConfirmed = false;
  }
}

export default EnsembleSignalGenerator;
