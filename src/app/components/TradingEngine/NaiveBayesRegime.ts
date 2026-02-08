// ─── Naive Bayes Market Regime Classifier ────────────────────────────────────
// Classifies the current market into one of four regimes using Gaussian
// Naive Bayes on observable features: returns, volatility, OBI, spread change.
//
// Regimes: trending_up | trending_down | ranging | volatile
//
// The classifier maintains running statistics (mean, variance) for each
// feature conditioned on each regime, and updates online via incremental
// sufficient statistics. No training data required — it self-calibrates
// from the live stream using a soft-label approach.

export type RegimeLabel = 'trending_up' | 'trending_down' | 'ranging' | 'volatile';

export interface NaiveBayesState {
  regime: RegimeLabel;
  probabilities: Record<RegimeLabel, number>;
  confidence: number;        // Max probability
  isTransition: boolean;     // Regime just changed
  features: {
    returnRate: number;
    volatility: number;
    obi: number;
    spreadChange: number;
  };
}

interface FeatureStats {
  mean: number;
  variance: number;
  count: number;
}

const REGIMES: RegimeLabel[] = ['trending_up', 'trending_down', 'ranging', 'volatile'];

const FEATURE_NAMES = ['returnRate', 'volatility', 'obi', 'spreadChange'] as const;
type FeatureName = typeof FEATURE_NAMES[number];

class NaiveBayesRegime {
  // Conditional distributions: P(feature | regime)
  private stats: Record<RegimeLabel, Record<FeatureName, FeatureStats>>;
  // Prior probabilities: P(regime)
  private priors: Record<RegimeLabel, number>;
  private totalSamples: number = 0;

  // Feature buffers
  private priceHistory: number[] = [];
  private spreadHistory: number[] = [];
  private readonly windowSize: number;
  private readonly volatilityWindow: number;

  // State tracking
  private prevRegime: RegimeLabel = 'ranging';
  private readonly minSamples: number = 20;

  constructor(windowSize: number = 30, volatilityWindow: number = 15) {
    this.windowSize = windowSize;
    this.volatilityWindow = volatilityWindow;

    // Initialize uniform priors
    this.priors = { trending_up: 0.25, trending_down: 0.25, ranging: 0.35, volatile: 0.15 };

    // Initialize feature statistics with informative priors
    // These encode domain knowledge about what each regime "looks like"
    this.stats = {} as any;
    for (const regime of REGIMES) {
      this.stats[regime] = {} as any;
      for (const feat of FEATURE_NAMES) {
        this.stats[regime][feat] = { mean: 0, variance: 1, count: 1 };
      }
    }

    // Seed with domain knowledge
    // trending_up: positive returns, moderate vol, positive OBI
    this.stats.trending_up.returnRate = { mean: 0.001, variance: 0.0001, count: 5 };
    this.stats.trending_up.volatility = { mean: 0.005, variance: 0.0001, count: 5 };
    this.stats.trending_up.obi = { mean: 15, variance: 100, count: 5 };
    this.stats.trending_up.spreadChange = { mean: -0.001, variance: 0.0001, count: 5 };

    // trending_down: negative returns, moderate vol, negative OBI
    this.stats.trending_down.returnRate = { mean: -0.001, variance: 0.0001, count: 5 };
    this.stats.trending_down.volatility = { mean: 0.005, variance: 0.0001, count: 5 };
    this.stats.trending_down.obi = { mean: -15, variance: 100, count: 5 };
    this.stats.trending_down.spreadChange = { mean: 0.001, variance: 0.0001, count: 5 };

    // ranging: near-zero returns, low vol, near-zero OBI
    this.stats.ranging.returnRate = { mean: 0, variance: 0.00005, count: 5 };
    this.stats.ranging.volatility = { mean: 0.002, variance: 0.00005, count: 5 };
    this.stats.ranging.obi = { mean: 0, variance: 50, count: 5 };
    this.stats.ranging.spreadChange = { mean: 0, variance: 0.00005, count: 5 };

    // volatile: any return direction, high vol, extreme OBI swings
    this.stats.volatile.returnRate = { mean: 0, variance: 0.001, count: 5 };
    this.stats.volatile.volatility = { mean: 0.015, variance: 0.001, count: 5 };
    this.stats.volatile.obi = { mean: 0, variance: 400, count: 5 };
    this.stats.volatile.spreadChange = { mean: 0.002, variance: 0.001, count: 5 };
  }

  update(price: number, obi: number, spread: number): NaiveBayesState {
    // Update price history
    this.priceHistory.push(price);
    this.spreadHistory.push(spread);
    if (this.priceHistory.length > this.windowSize) this.priceHistory.shift();
    if (this.spreadHistory.length > this.windowSize) this.spreadHistory.shift();

    // Extract features
    const features = this.extractFeatures(obi);

    // Classify
    const probabilities = this.classify(features);

    // Find winning regime
    let bestRegime: RegimeLabel = 'ranging';
    let bestProb = 0;
    for (const regime of REGIMES) {
      if (probabilities[regime] > bestProb) {
        bestProb = probabilities[regime];
        bestRegime = regime;
      }
    }

    const isTransition = bestRegime !== this.prevRegime;

    // Online update: reinforce the winning regime's statistics
    this.totalSamples++;
    if (this.totalSamples > this.minSamples) {
      this.updateStats(bestRegime, features);
      this.updatePriors(bestRegime);
    }

    this.prevRegime = bestRegime;

    return {
      regime: bestRegime,
      probabilities,
      confidence: bestProb,
      isTransition,
      features,
    };
  }

  private extractFeatures(obi: number): Record<FeatureName, number> {
    const n = this.priceHistory.length;
    const p = this.priceHistory;

    // Return rate (last tick)
    const returnRate = n >= 2 ? (p[n - 1] - p[n - 2]) / p[n - 2] : 0;

    // Volatility: std of returns over volatilityWindow
    let volatility = 0;
    if (n >= this.volatilityWindow) {
      const returns: number[] = [];
      const start = n - this.volatilityWindow;
      for (let i = start + 1; i < n; i++) {
        returns.push((p[i] - p[i - 1]) / p[i - 1]);
      }
      const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
      volatility = Math.sqrt(returns.reduce((s, r) => s + (r - mean) ** 2, 0) / returns.length);
    }

    // Spread change
    const sn = this.spreadHistory.length;
    const spreadChange = sn >= 2
      ? this.spreadHistory[sn - 1] - this.spreadHistory[sn - 2]
      : 0;

    return { returnRate, volatility, obi, spreadChange };
  }

  private classify(features: Record<FeatureName, number>): Record<RegimeLabel, number> {
    // Log-posterior: log P(regime | features) ∝ log P(regime) + Σ log P(feature | regime)
    const logPosteriors: Record<RegimeLabel, number> = {} as any;

    for (const regime of REGIMES) {
      let logP = Math.log(this.priors[regime] + 1e-10);

      for (const feat of FEATURE_NAMES) {
        const { mean, variance } = this.stats[regime][feat];
        const x = features[feat];
        // Gaussian log-likelihood: -0.5 * (log(2πσ²) + (x-μ)²/σ²)
        const safeVar = Math.max(variance, 1e-10);
        logP += -0.5 * (Math.log(2 * Math.PI * safeVar) + ((x - mean) ** 2) / safeVar);
      }

      logPosteriors[regime] = logP;
    }

    // Convert to probabilities via log-sum-exp
    const maxLog = Math.max(...Object.values(logPosteriors));
    let sumExp = 0;
    const expValues: Record<RegimeLabel, number> = {} as any;

    for (const regime of REGIMES) {
      expValues[regime] = Math.exp(logPosteriors[regime] - maxLog);
      sumExp += expValues[regime];
    }

    const probabilities: Record<RegimeLabel, number> = {} as any;
    for (const regime of REGIMES) {
      probabilities[regime] = expValues[regime] / sumExp;
    }

    return probabilities;
  }

  private updateStats(regime: RegimeLabel, features: Record<FeatureName, number>): void {
    // Welford's online algorithm for updating mean and variance
    for (const feat of FEATURE_NAMES) {
      const s = this.stats[regime][feat];
      const x = features[feat];
      const newCount = s.count + 1;
      const delta = x - s.mean;
      const newMean = s.mean + delta / newCount;
      const delta2 = x - newMean;
      const newVariance = ((s.variance * s.count) + delta * delta2) / newCount;

      this.stats[regime][feat] = {
        mean: newMean,
        variance: Math.max(newVariance, 1e-10),
        count: Math.min(newCount, 500), // Cap to prevent stale statistics
      };
    }
  }

  private updatePriors(winningRegime: RegimeLabel): void {
    // Exponential moving average prior update
    const alpha = 0.01; // Slow adaptation
    for (const regime of REGIMES) {
      if (regime === winningRegime) {
        this.priors[regime] = (1 - alpha) * this.priors[regime] + alpha * 1;
      } else {
        this.priors[regime] = (1 - alpha) * this.priors[regime];
      }
    }

    // Normalize
    const sum = Object.values(this.priors).reduce((s, p) => s + p, 0);
    for (const regime of REGIMES) {
      this.priors[regime] /= sum;
    }
  }

  getState(): NaiveBayesState {
    const features = this.extractFeatures(0);
    const probabilities = this.classify(features);
    let bestRegime: RegimeLabel = 'ranging';
    let bestProb = 0;
    for (const regime of REGIMES) {
      if (probabilities[regime] > bestProb) {
        bestProb = probabilities[regime];
        bestRegime = regime;
      }
    }
    return {
      regime: bestRegime,
      probabilities,
      confidence: bestProb,
      isTransition: false,
      features,
    };
  }

  reset(): void {
    this.priceHistory = [];
    this.spreadHistory = [];
    this.totalSamples = 0;
    this.prevRegime = 'ranging';
  }
}

export default NaiveBayesRegime;
