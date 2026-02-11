// ─── Online Linear Regression Price Target ──────────────────────────────────
// Rolling window OLS regression on price series.
// Computes slope, intercept, R², and projects a price target
// with upper/lower confidence bands based on standard error.

export interface LinRegState {
  slope: number;         // Price change per tick
  intercept: number;     // Y-intercept of the regression line
  rSquared: number;      // Coefficient of determination (goodness of fit)
  priceTarget: number;   // Projected price N ticks forward
  upperBand: number;     // Upper confidence band (target + 2*SE)
  lowerBand: number;     // Lower confidence band (target - 2*SE)
  stdError: number;      // Standard error of the regression
  direction: 1 | -1 | 0; // Slope direction
  strength: number;      // Normalized slope magnitude [0, 1]
  // ILS Acceleration Guard (MFC Phase 2, Layer 4)
  acceleration: number;  // 2nd derivative of slope (d²price/dt²)
  glideSlopeStable: boolean; // false when acceleration reverses slope direction
}

class LinearRegressionTarget {
  private prices: number[] = [];
  private readonly windowSize: number;
  private readonly forecastHorizon: number;

  // Slope history for acceleration (2nd derivative)
  private slopeHistory: number[] = [];
  private readonly slopeHistorySize: number = 10;

  constructor(windowSize: number = 30, forecastHorizon: number = 10) {
    this.windowSize = windowSize;
    this.forecastHorizon = forecastHorizon;
  }

  update(price: number): LinRegState {
    this.prices.push(price);
    if (this.prices.length > this.windowSize) {
      this.prices.shift();
    }

    return this.compute();
  }

  private compute(): LinRegState {
    const n = this.prices.length;

    if (n < 3) {
      return {
        slope: 0, intercept: this.prices[n - 1] ?? 0, rSquared: 0,
        priceTarget: this.prices[n - 1] ?? 0,
        upperBand: this.prices[n - 1] ?? 0,
        lowerBand: this.prices[n - 1] ?? 0,
        stdError: 0, direction: 0, strength: 0,
        acceleration: 0, glideSlopeStable: true,
      };
    }

    // x = [0, 1, 2, ..., n-1], y = prices
    // OLS: slope = (n*Σxy - Σx*Σy) / (n*Σx² - (Σx)²)
    let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
    for (let i = 0; i < n; i++) {
      sumX += i;
      sumY += this.prices[i];
      sumXY += i * this.prices[i];
      sumX2 += i * i;
    }

    const denom = n * sumX2 - sumX * sumX;
    if (denom === 0) {
      const p = this.prices[n - 1];
      return {
        slope: 0, intercept: p, rSquared: 0,
        priceTarget: p, upperBand: p, lowerBand: p,
        stdError: 0, direction: 0, strength: 0,
        acceleration: 0, glideSlopeStable: true,
      };
    }

    const slope = (n * sumXY - sumX * sumY) / denom;
    const intercept = (sumY - slope * sumX) / n;

    // R² = 1 - SS_res / SS_tot
    const meanY = sumY / n;
    let ssRes = 0, ssTot = 0;
    for (let i = 0; i < n; i++) {
      const predicted = intercept + slope * i;
      const residual = this.prices[i] - predicted;
      ssRes += residual * residual;
      ssTot += (this.prices[i] - meanY) * (this.prices[i] - meanY);
    }

    const rSquared = ssTot > 0 ? Math.max(0, 1 - ssRes / ssTot) : 0;

    // Standard error of the estimate
    const stdError = n > 2 ? Math.sqrt(ssRes / (n - 2)) : 0;

    // Project price target: y = intercept + slope * (n - 1 + forecastHorizon)
    const targetX = n - 1 + this.forecastHorizon;
    const priceTarget = intercept + slope * targetX;

    // Confidence bands: ±2 * SE * sqrt(1 + 1/n + (x - mean_x)² / Σ(x - mean_x)²)
    const meanX = sumX / n;
    const ssX = sumX2 - n * meanX * meanX;
    const leverageTerm = 1 + 1 / n + ((targetX - meanX) ** 2) / (ssX + 1e-10);
    const bandWidth = 2 * stdError * Math.sqrt(leverageTerm);

    const upperBand = priceTarget + bandWidth;
    const lowerBand = priceTarget - bandWidth;

    // Normalized slope strength: how steep relative to price level
    const currentPrice = this.prices[n - 1];
    const normalizedSlope = currentPrice > 0 ? Math.abs(slope) / currentPrice : 0;
    const strength = Math.min(1, normalizedSlope * 1000); // Scale to [0, 1]

    const direction: 1 | -1 | 0 = Math.abs(slope) < 1e-10 ? 0 : slope > 0 ? 1 : -1;

    // ILS Acceleration Guard: 2nd derivative of slope
    this.slopeHistory.push(slope);
    if (this.slopeHistory.length > this.slopeHistorySize) {
      this.slopeHistory.shift();
    }
    let acceleration = 0;
    if (this.slopeHistory.length >= 2) {
      const prev = this.slopeHistory[this.slopeHistory.length - 2];
      acceleration = slope - prev;
    }
    // Glide slope is unstable when acceleration opposes slope direction
    // (slope positive but decelerating, or slope negative but accelerating upward)
    const glideSlopeStable = !(Math.abs(slope) > 1e-10 && Math.sign(acceleration) !== Math.sign(slope));

    return {
      slope,
      intercept,
      rSquared,
      priceTarget,
      upperBand,
      lowerBand,
      stdError,
      direction,
      strength,
      acceleration,
      glideSlopeStable,
    };
  }

  getState(): LinRegState {
    return this.compute();
  }

  reset(): void {
    this.prices = [];
    this.slopeHistory = [];
  }
}

export default LinearRegressionTarget;
