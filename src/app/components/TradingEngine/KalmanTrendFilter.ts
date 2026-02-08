// ─── Kalman Trend Filter ─────────────────────────────────────────────────────
// 1D Kalman filter tracking price level + velocity (trend slope).
// Detects trend reversals when estimated velocity changes sign.
//
// State vector: x = [price, velocity]
// Transition:   x_k = F * x_{k-1} + process_noise
// Observation:  z_k = H * x_k + measurement_noise

export interface KalmanState {
  price: number;       // Filtered price estimate
  velocity: number;    // Trend slope (price change per tick)
  acceleration: number; // Rate of change of velocity
  trendDirection: 1 | -1 | 0; // Current trend direction
  reversalSignal: number;     // Reversal strength [-1, +1] (sign flip = reversal)
  confidence: number;  // Filter confidence based on innovation consistency
  innovationSeq: number; // Normalized innovation (how surprising the latest observation is)
}

class KalmanTrendFilter {
  // State: [price, velocity]
  private x: Float64Array; // state estimate
  private P: Float64Array; // 2x2 covariance matrix (flattened)

  // Model parameters
  private readonly Q: Float64Array; // Process noise covariance 2x2
  private readonly R: number;       // Measurement noise variance
  private readonly H: Float64Array; // Observation matrix [1, 0]

  // Tracking
  private prevVelocity: number = 0;
  private velocityHistory: number[] = [];
  private readonly maxHistory: number = 50;
  private initialized: boolean = false;
  private tickCount: number = 0;
  private innovationVariance: number = 1;
  private readonly innovationAlpha: number = 0.05; // EMA decay for innovation tracking

  constructor(
    processNoise: number = 0.001,
    measurementNoise: number = 0.1,
  ) {
    // Initial state: unknown
    this.x = new Float64Array([0, 0]);

    // Initial covariance: high uncertainty
    this.P = new Float64Array([1, 0, 0, 1]);

    // Process noise: how much we expect the state to change per step
    // Higher = more responsive, lower = smoother
    this.Q = new Float64Array([
      processNoise * 0.1, 0,
      0, processNoise,
    ]);

    // Measurement noise: how noisy the price observations are
    this.R = measurementNoise;

    // Observation matrix: we observe price directly
    this.H = new Float64Array([1, 0]);
  }

  update(observedPrice: number): KalmanState {
    this.tickCount++;

    if (!this.initialized) {
      this.x[0] = observedPrice;
      this.x[1] = 0;
      this.initialized = true;
      return this.buildState(0);
    }

    // ── Predict step ──
    // F = [[1, 1], [0, 1]]  (constant velocity model)
    const xPred0 = this.x[0] + this.x[1]; // price + velocity
    const xPred1 = this.x[1];              // velocity persists

    // P_pred = F * P * F' + Q
    const p00 = this.P[0] + this.P[1] + this.P[2] + this.P[3] + this.Q[0];
    const p01 = this.P[1] + this.P[3] + this.Q[1];
    const p10 = this.P[2] + this.P[3] + this.Q[2];
    const p11 = this.P[3] + this.Q[3];

    // ── Update step ──
    // Innovation: y = z - H * x_pred
    const innovation = observedPrice - xPred0;

    // Innovation covariance: S = H * P_pred * H' + R
    const S = p00 + this.R;

    // Kalman gain: K = P_pred * H' / S
    const K0 = p00 / S;
    const K1 = p10 / S;

    // Updated state: x = x_pred + K * innovation
    this.x[0] = xPred0 + K0 * innovation;
    this.x[1] = xPred1 + K1 * innovation;

    // Updated covariance: P = (I - K * H) * P_pred
    this.P[0] = (1 - K0) * p00;
    this.P[1] = (1 - K0) * p01;
    this.P[2] = p10 - K1 * p00;
    this.P[3] = p11 - K1 * p01;

    // Track innovation variance for confidence estimation
    const normalizedInnovation = innovation / Math.sqrt(S);
    this.innovationVariance = (1 - this.innovationAlpha) * this.innovationVariance
      + this.innovationAlpha * (normalizedInnovation * normalizedInnovation);

    // Track velocity history for acceleration
    this.velocityHistory.push(this.x[1]);
    if (this.velocityHistory.length > this.maxHistory) {
      this.velocityHistory.shift();
    }

    const state = this.buildState(normalizedInnovation);
    this.prevVelocity = this.x[1];
    return state;
  }

  private buildState(normalizedInnovation: number): KalmanState {
    const velocity = this.x[1];
    const price = this.x[0];

    // Acceleration: change in velocity
    const acceleration = velocity - this.prevVelocity;

    // Trend direction from velocity sign
    const trendDirection: 1 | -1 | 0 =
      Math.abs(velocity) < 1e-8 ? 0 : velocity > 0 ? 1 : -1;

    // Reversal signal: detect sign change in velocity
    // Magnitude indicates strength of reversal
    let reversalSignal = 0;
    if (this.prevVelocity !== 0 && this.tickCount > 5) {
      const prevSign = Math.sign(this.prevVelocity);
      const currSign = Math.sign(velocity);
      if (prevSign !== currSign && currSign !== 0) {
        // Reversal detected — magnitude = |velocity change| normalized
        const velocitySwing = Math.abs(velocity - this.prevVelocity);
        const avgVelocity = this.velocityHistory.length > 0
          ? this.velocityHistory.reduce((s, v) => s + Math.abs(v), 0) / this.velocityHistory.length
          : 1;
        reversalSignal = currSign * Math.min(1, velocitySwing / (avgVelocity * 2 + 1e-10));
      }
    }

    // Confidence: based on how well innovations match expected variance
    // If innovationVariance ≈ 1, the filter is well-calibrated
    const confidence = Math.max(0, Math.min(1, 1 / (1 + Math.abs(this.innovationVariance - 1))));

    return {
      price,
      velocity,
      acceleration,
      trendDirection,
      reversalSignal,
      confidence,
      innovationSeq: normalizedInnovation,
    };
  }

  getState(): KalmanState {
    return this.buildState(0);
  }

  reset(): void {
    this.x[0] = 0;
    this.x[1] = 0;
    this.P = new Float64Array([1, 0, 0, 1]);
    this.prevVelocity = 0;
    this.velocityHistory = [];
    this.initialized = false;
    this.tickCount = 0;
    this.innovationVariance = 1;
  }
}

export default KalmanTrendFilter;
