// src/tradingEngine/MarketCharacteristor.ts
// Aviation-Style Market Characteristor with Fibonacci 15-min H/L Scaling
// Universal multi-symbol profiling: ATR-Volume cross-reference with Fib flight levels

// ─── Enums ───────────────────────────────────────────────────────────────────

export enum FlightPhase {
  TAKEOFF = 'TAKEOFF',       // Breakout above ceiling
  CLIMB = 'CLIMB',           // Uptrend, upper range
  CRUISE = 'CRUISE',         // Stable around midpoint
  DESCENT = 'DESCENT',       // Downtrend, lower range
  LANDING = 'LANDING',       // Approaching floor
  GO_AROUND = 'GO_AROUND',   // Bounce from S/R
  HOLDING = 'HOLDING',       // Range-bound consolidation
  TURBULENCE = 'TURBULENCE', // High volatility event
  MAYDAY = 'MAYDAY',         // Emergency — kill switch
}

export enum TurbulenceCategory {
  SMOOTH = 'SMOOTH',       // ATR/Range < 15%, P0-P15
  LIGHT = 'LIGHT',         // 15-30%, P15-P40
  MODERATE = 'MODERATE',   // 30-60%, P40-P70
  SEVERE = 'SEVERE',       // 60-100%, P70-P90
  EXTREME = 'EXTREME',     // > 100%, P90-P100
}

export enum TrafficDensity {
  VACANT = 'VACANT',       // P0-P10
  LIGHT = 'LIGHT',         // P10-P30
  MODERATE = 'MODERATE',   // P30-P60
  HEAVY = 'HEAVY',         // P60-P85
  CONGESTED = 'CONGESTED', // P85-P95
  EMERGENCY = 'EMERGENCY', // P95-P100
}

export enum Visibility {
  VMC = 'VMC',         // StdDev expanding — Visual Met Conditions (confirmed)
  IMC = 'IMC',         // StdDev contracting — Instrument Met Conditions (unconfirmed)
  MARGINAL = 'MARGINAL', // StdDev flat — transitional
}

export enum SquawkCode {
  NORMAL = 7000,     // Standard operations
  COMM_FAIL = 7600,  // Signal conflict
  HIJACK = 7500,     // Manipulation detected
  MAYDAY = 7700,     // Emergency
}

// ─── Fibonacci Constants ─────────────────────────────────────────────────────

export const FIB_LEVELS = {
  0: 0,
  236: 0.236,
  382: 0.382,
  500: 0.500,
  618: 0.618,
  786: 0.786,
  1000: 1.000,
} as const;

export const FIB_EXTENSIONS = {
  EXT_1272: 1.272,
  EXT_1618: 1.618,
  EXT_NEG_272: -0.272,
  EXT_NEG_618: -0.618,
} as const;

// ─── Types ───────────────────────────────────────────────────────────────────

export interface Candle15m {
  high: number;
  low: number;
  open: number;
  close: number;
  volume: number;
  timestamp: number;
}

export interface FibLevel {
  name: string;
  ratio: number;
  price: number;
}

export interface SymbolInput {
  symbol: string;
  price: number;
  candle15m: Candle15m;
  atr: number;
  atrPercentile: number;     // 0-1
  volumePercentile: number;  // 0-1
  stdDev: number;
  prevStdDev: number;
  momentum: number;          // % change
  macdDivergence: boolean;
  rsiDivergence: boolean;
}

export interface ATISReport {
  symbol: string;
  timestamp: string;
  flightPhase: FlightPhase;
  altitude: number;          // price
  ceiling: number;           // 15m high
  floor: number;             // 15m low
  airspace: number;          // range
  airspeed: number;          // momentum %
  turbulence: TurbulenceCategory;
  turbulenceRatio: number;   // ATR / range
  atrPercentile: number;
  traffic: TrafficDensity;
  volumePercentile: number;
  visibility: Visibility;
  windshear: boolean;
  squawk: SquawkCode;
  fibLevels: FibLevel[];
  fibExtensions: FibLevel[];
  tp: FibLevel | null;
  sl: FibLevel | null;
  positionSizePct: number;
  action: 'LONG' | 'SHORT' | 'GRID' | 'HOLD' | 'EXIT';
  metar: string;
}

// ─── Market Characteristor ───────────────────────────────────────────────────

class MarketCharacteristor {

  // ─── Main: Generate ATIS for a symbol ─────────────────────────────────────

  generateATIS(input: SymbolInput): ATISReport {
    const { symbol, price, candle15m, atr } = input;
    const ceiling = candle15m.high;
    const floor = candle15m.low;
    const airspace = ceiling - floor;

    // Fib levels
    const fibLevels = this.calculateFibLevels(floor, airspace);
    const fibExtensions = this.calculateFibExtensions(floor, airspace);

    // ATR as ratio of range (symbol-agnostic turbulence)
    const turbulenceRatio = airspace > 0 ? atr / airspace : 0;
    const turbulence = this.classifyTurbulence(turbulenceRatio, input.atrPercentile);
    const traffic = this.classifyTraffic(input.volumePercentile);
    const visibility = this.classifyVisibility(input.stdDev, input.prevStdDev);
    const windshear = input.macdDivergence || input.rsiDivergence;
    const squawk = this.determineSquawk(turbulence, traffic, windshear);

    // Flight phase based on price position within Fib range
    const fibPosition = airspace > 0 ? (price - floor) / airspace : 0.5;
    const flightPhase = this.classifyFlightPhase(
      fibPosition, turbulence, traffic, input.momentum
    );

    // TP/SL based on flight phase and Fib levels
    const { tp, sl } = this.calculateTPSL(flightPhase, fibLevels, fibExtensions, fibPosition);

    // Position size adjustment
    const positionSizePct = this.calculatePositionSize(turbulence, traffic, squawk);

    // Action
    const action = this.determineAction(flightPhase, squawk);

    // METAR string
    const metar = this.generateMETAR(
      symbol, flightPhase, price, ceiling, floor, airspace,
      input.momentum, turbulence, input.atrPercentile,
      traffic, input.volumePercentile, visibility, squawk, tp, sl
    );

    return {
      symbol,
      timestamp: new Date().toISOString(),
      flightPhase,
      altitude: price,
      ceiling,
      floor,
      airspace,
      airspeed: input.momentum,
      turbulence,
      turbulenceRatio,
      atrPercentile: input.atrPercentile,
      traffic,
      volumePercentile: input.volumePercentile,
      visibility,
      windshear,
      squawk,
      fibLevels,
      fibExtensions,
      tp,
      sl,
      positionSizePct,
      action,
      metar,
    };
  }

  // ─── Multi-Symbol Dashboard ───────────────────────────────────────────────

  generateDashboard(inputs: SymbolInput[]): ATISReport[] {
    return inputs.map(input => this.generateATIS(input));
  }

  // ─── Fibonacci Calculations ───────────────────────────────────────────────

  calculateFibLevels(floor: number, range: number): FibLevel[] {
    return Object.entries(FIB_LEVELS).map(([name, ratio]) => ({
      name: `Fib ${name}`,
      ratio,
      price: floor + range * ratio,
    }));
  }

  calculateFibExtensions(floor: number, range: number): FibLevel[] {
    return Object.entries(FIB_EXTENSIONS).map(([name, ratio]) => ({
      name,
      ratio,
      price: floor + range * ratio,
    }));
  }

  getFibPrice(floor: number, range: number, fibRatio: number): number {
    return floor + range * fibRatio;
  }

  // ─── Turbulence Classification ────────────────────────────────────────────

  classifyTurbulence(atrRangeRatio: number, atrPercentile: number): TurbulenceCategory {
    // Primary: ATR / Range ratio. Secondary: ATR percentile for confirmation.
    if (atrRangeRatio > 1.0 || atrPercentile > 0.90) return TurbulenceCategory.EXTREME;
    if (atrRangeRatio > 0.6 || atrPercentile > 0.70) return TurbulenceCategory.SEVERE;
    if (atrRangeRatio > 0.3 || atrPercentile > 0.40) return TurbulenceCategory.MODERATE;
    if (atrRangeRatio > 0.15 || atrPercentile > 0.15) return TurbulenceCategory.LIGHT;
    return TurbulenceCategory.SMOOTH;
  }

  // ─── Traffic Classification ───────────────────────────────────────────────

  classifyTraffic(volumePercentile: number): TrafficDensity {
    if (volumePercentile > 0.95) return TrafficDensity.EMERGENCY;
    if (volumePercentile > 0.85) return TrafficDensity.CONGESTED;
    if (volumePercentile > 0.60) return TrafficDensity.HEAVY;
    if (volumePercentile > 0.30) return TrafficDensity.MODERATE;
    if (volumePercentile > 0.10) return TrafficDensity.LIGHT;
    return TrafficDensity.VACANT;
  }

  // ─── Visibility Classification ────────────────────────────────────────────

  classifyVisibility(stdDev: number, prevStdDev: number): Visibility {
    const change = prevStdDev > 0 ? (stdDev - prevStdDev) / prevStdDev : 0;
    if (change > 0.05) return Visibility.VMC;       // Expanding > 5%
    if (change < -0.05) return Visibility.IMC;      // Contracting > 5%
    return Visibility.MARGINAL;
  }

  // ─── Squawk Code ──────────────────────────────────────────────────────────

  determineSquawk(
    turbulence: TurbulenceCategory,
    traffic: TrafficDensity,
    windshear: boolean
  ): SquawkCode {
    // MAYDAY: extreme turbulence + emergency traffic
    if (turbulence === TurbulenceCategory.EXTREME && traffic === TrafficDensity.EMERGENCY) {
      return SquawkCode.MAYDAY;
    }
    // MAYDAY: extreme turbulence alone
    if (turbulence === TurbulenceCategory.EXTREME) {
      return SquawkCode.MAYDAY;
    }
    // COMM_FAIL: signal conflict (windshear = divergence detected)
    if (windshear) {
      return SquawkCode.COMM_FAIL;
    }
    return SquawkCode.NORMAL;
  }

  // ─── Flight Phase Classification ──────────────────────────────────────────

  classifyFlightPhase(
    fibPosition: number,
    turbulence: TurbulenceCategory,
    traffic: TrafficDensity,
    momentum: number
  ): FlightPhase {
    // MAYDAY override
    if (turbulence === TurbulenceCategory.EXTREME &&
        (traffic === TrafficDensity.EMERGENCY || traffic === TrafficDensity.CONGESTED)) {
      return FlightPhase.MAYDAY;
    }

    // TURBULENCE override
    if (turbulence === TurbulenceCategory.SEVERE || turbulence === TurbulenceCategory.EXTREME) {
      return FlightPhase.TURBULENCE;
    }

    // Position-based phases
    if (fibPosition > 1.0) return FlightPhase.TAKEOFF;     // Above ceiling = breakout
    if (fibPosition < 0.0) return FlightPhase.LANDING;      // Below floor

    // Momentum + position
    if (fibPosition > 0.618 && momentum > 0.1) return FlightPhase.CLIMB;
    if (fibPosition < 0.382 && momentum < -0.1) return FlightPhase.DESCENT;

    // Near extremes with weak momentum = approach/landing
    if (fibPosition > 0.786) return FlightPhase.CLIMB;
    if (fibPosition < 0.236) return FlightPhase.DESCENT;

    // Midrange = holding/cruise
    if (fibPosition >= 0.382 && fibPosition <= 0.618) {
      if (Math.abs(momentum) < 0.05) return FlightPhase.HOLDING;
      return FlightPhase.CRUISE;
    }

    return FlightPhase.CRUISE;
  }

  // ─── TP/SL Calculation ────────────────────────────────────────────────────

  calculateTPSL(
    phase: FlightPhase,
    fibLevels: FibLevel[],
    fibExtensions: FibLevel[],
    fibPosition: number
  ): { tp: FibLevel | null; sl: FibLevel | null } {
    const fib = (ratio: number) => fibLevels.find(f => f.ratio === ratio) || null;
    const ext = (name: string) => fibExtensions.find(f => f.name === name) || null;

    switch (phase) {
      case FlightPhase.TAKEOFF:
        return { tp: ext('EXT_1272'), sl: fib(0.786) };

      case FlightPhase.CLIMB:
        return { tp: fib(0.786) || fib(1.0), sl: fib(0.500) };

      case FlightPhase.CRUISE:
      case FlightPhase.HOLDING:
        return { tp: fib(0.618), sl: fib(0.382) };

      case FlightPhase.DESCENT:
        return { tp: fib(0.236) || fib(0), sl: fib(0.500) };

      case FlightPhase.LANDING:
        return { tp: fib(0), sl: ext('EXT_NEG_272') };

      case FlightPhase.GO_AROUND:
        return { tp: fib(0.500), sl: fib(0.236) };

      case FlightPhase.TURBULENCE:
        // Wider levels for turbulence
        return fibPosition > 0.5
          ? { tp: fib(1.0), sl: fib(0) }
          : { tp: fib(0), sl: fib(1.0) };

      case FlightPhase.MAYDAY:
        return { tp: null, sl: null }; // Exit all — no new entries

      default:
        return { tp: fib(0.618), sl: fib(0.382) };
    }
  }

  // ─── Position Sizing ──────────────────────────────────────────────────────

  calculatePositionSize(
    turbulence: TurbulenceCategory,
    traffic: TrafficDensity,
    squawk: SquawkCode
  ): number {
    if (squawk === SquawkCode.MAYDAY) return 0;
    if (squawk === SquawkCode.HIJACK) return 0;
    if (squawk === SquawkCode.COMM_FAIL) return 1; // 1% — half normal

    let basePct = 2; // Standard 2%

    // Turbulence adjustment
    switch (turbulence) {
      case TurbulenceCategory.SMOOTH: basePct *= 0.8; break;   // Less opportunity
      case TurbulenceCategory.LIGHT: basePct *= 1.0; break;
      case TurbulenceCategory.MODERATE: basePct *= 0.8; break;
      case TurbulenceCategory.SEVERE: basePct *= 0.5; break;
      case TurbulenceCategory.EXTREME: basePct = 0; break;
    }

    // Traffic adjustment
    switch (traffic) {
      case TrafficDensity.VACANT: basePct *= 0.5; break;
      case TrafficDensity.LIGHT: basePct *= 0.8; break;
      case TrafficDensity.MODERATE: basePct *= 1.0; break;
      case TrafficDensity.HEAVY: basePct *= 1.2; break;
      case TrafficDensity.CONGESTED: basePct *= 0.7; break;  // Exhaustion risk
      case TrafficDensity.EMERGENCY: basePct *= 0.3; break;
    }

    return Math.round(basePct * 100) / 100;
  }

  // ─── Action Determination ─────────────────────────────────────────────────

  determineAction(
    phase: FlightPhase,
    squawk: SquawkCode
  ): 'LONG' | 'SHORT' | 'GRID' | 'HOLD' | 'EXIT' {
    if (squawk === SquawkCode.MAYDAY || squawk === SquawkCode.HIJACK) return 'EXIT';
    if (squawk === SquawkCode.COMM_FAIL) return 'HOLD';

    switch (phase) {
      case FlightPhase.TAKEOFF:
      case FlightPhase.CLIMB:
      case FlightPhase.GO_AROUND:
        return 'LONG';
      case FlightPhase.DESCENT:
      case FlightPhase.LANDING:
        return 'SHORT';
      case FlightPhase.HOLDING:
      case FlightPhase.TURBULENCE:
        return 'GRID';
      case FlightPhase.CRUISE:
        return 'HOLD';
      case FlightPhase.MAYDAY:
        return 'EXIT';
      default:
        return 'HOLD';
    }
  }

  // ─── METAR String Generator ───────────────────────────────────────────────

  generateMETAR(
    symbol: string,
    phase: FlightPhase,
    price: number,
    ceiling: number,
    floor: number,
    range: number,
    momentum: number,
    turbulence: TurbulenceCategory,
    atrPercentile: number,
    traffic: TrafficDensity,
    volumePercentile: number,
    visibility: Visibility,
    squawk: SquawkCode,
    tp: FibLevel | null,
    sl: FibLevel | null
  ): string {
    const now = new Date();
    const day = now.getUTCDate().toString().padStart(2, '0');
    const hour = now.getUTCHours().toString().padStart(2, '0');
    const min = now.getUTCMinutes().toString().padStart(2, '0');
    const zulu = `${day}${hour}${min}Z`;

    const fl = Math.round(price / this.getFlightLevelDivisor(price));
    const cFL = Math.round(ceiling);
    const fFL = Math.round(floor);
    const rng = Math.round(range);

    const momSign = momentum >= 0 ? '+' : '';
    const momStr = `${momSign}${(momentum * 100).toFixed(0)}`;

    const turbShort = this.turbulenceShort(turbulence);
    const atrP = `P${Math.round(atrPercentile * 100)}`;
    const tfcShort = this.trafficShort(traffic);
    const volP = `P${Math.round(volumePercentile * 100)}`;

    const tpStr = tp ? `TP${Math.round(tp.ratio * 1000)}/${Math.round(tp.price)}` : 'TP-NONE';
    const slStr = sl ? `SL${Math.round(sl.ratio * 1000)}/${Math.round(sl.price)}` : 'SL-NONE';

    return `METAR ${symbol} ${zulu} ${phase} FL${fl} C${cFL}/F${fFL} R${rng} A${momStr} TURB-${turbShort}/${atrP} TFC-${tfcShort}/${volP} VIS-${visibility} SQ${squawk} ${tpStr} ${slStr}`;
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private getFlightLevelDivisor(price: number): number {
    if (price >= 10000) return 100;
    if (price >= 1000) return 10;
    if (price >= 100) return 1;
    return 0.01;
  }

  private turbulenceShort(t: TurbulenceCategory): string {
    switch (t) {
      case TurbulenceCategory.SMOOTH: return 'SMH';
      case TurbulenceCategory.LIGHT: return 'LGT';
      case TurbulenceCategory.MODERATE: return 'MOD';
      case TurbulenceCategory.SEVERE: return 'SEV';
      case TurbulenceCategory.EXTREME: return 'EXT';
    }
  }

  private trafficShort(t: TrafficDensity): string {
    switch (t) {
      case TrafficDensity.VACANT: return 'VAC';
      case TrafficDensity.LIGHT: return 'LGT';
      case TrafficDensity.MODERATE: return 'MOD';
      case TrafficDensity.HEAVY: return 'HVY';
      case TrafficDensity.CONGESTED: return 'CNG';
      case TrafficDensity.EMERGENCY: return 'EMG';
    }
  }
}

export default MarketCharacteristor;
