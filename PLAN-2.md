# SOVEREIGN ENGINE — Institutional-Grade Quantitative Trading System
## Architecture Specification v2.1 | Senior Prop Trading Analysis

---

## 0. PROFESSIONAL AUDIT OF DRAFT PLAN

### What's Strong
- MDP formulation for feature selection is conceptually correct — treating optimization as sequential decision-making is the right paradigm
- Identifying grid search waste (67% compute on suboptimal models) is accurate
- Experience replay + transfer learning across assets is a genuine edge
- The existing codebase already has solid primitives: A3CAgent, DDPGAgent, HiddenMarkovModel (5-state), OnlineDeepLearner with attention, MarkovChainPredictor (3rd-order), Level2FeatureExtractor with VPIN/Kyle's Lambda

### Critical Gaps (Would Fail in Production)

**1. NO RISK MANAGEMENT LAYER**
The draft treats risk as a soft penalty (β·MaxDrawdown) in the reward function. In production prop trading, risk MUST be a hard constraint enforced BEFORE the RL agent acts. A soft penalty means the agent CAN blow through limits if Q-value is high enough. This is how funds blow up.

**2. NO EXECUTION LAYER**
Zero mention of order execution strategy (TWAP, VWAP, iceberg), slippage modeling, or market impact estimation. On BTC with $100K+ positions, slippage eats 30-60% of alpha on sub-minute signals. The existing `DDPGAgent` outputs continuous position sizes but nothing handles HOW to execute.

**3. SINGLE-TIMEFRAME ARCHITECTURE**
The draft operates on one timeframe. Professional systems run multi-timeframe simultaneously (tick → 1s → 1m → 5m → 1h). Each timeframe has its own regime detector. The final decision is ensemble-weighted. The existing `OnlineDeepLearner` has multi-horizon outputs (1ms/10ms/100ms) but these are prediction horizons, not trading timeframes.

**4. MDP STATE MISSING PORTFOLIO CONTEXT**
The state s = (F, H, D, M) has features, hyperparams, data subset, and market regime — but NO portfolio state. Where is current position? Unrealized P&L? Time-in-trade? Available margin? These dramatically affect optimal action. A flat system and a system holding 10x leverage require completely different decisions.

**5. TWO CONFLATED MDPs**
The draft conflates two fundamentally different problems:
- **MDP-1**: Feature selection optimization (which features to use) — slow timescale, updates hourly/daily
- **MDP-2**: Trading decisions (when to buy/sell/hold) — fast timescale, updates per tick
These MUST be separate MDPs with different state spaces, action spaces, and reward horizons.

**6. REGIME-AWARE Q-VALUES**
When market regime changes (trending → volatile), Q-values learned in the old regime become actively harmful. The draft mentions transfer learning but not catastrophic forgetting. Need: separate value functions per regime OR contextual bandits with regime as context.

**7. COMPLEXITY ESTIMATES ARE OPTIMISTIC**
O(d squared) amortized assumes stationary distribution. Markets are non-stationary. In practice, you need periodic full re-optimization when regime detector fires transition, which resets amortized gains. Realistic improvement: 40-55%, not 73%.

**8. DISCONNECTED AGENTS**
Existing `A3CAgent` (discrete Buy/Hold/Sell) and `DDPGAgent` (continuous position sizing) are completely disconnected from each other and from the proposed MDP framework. They share no state, no reward signal, no coordination. This is an ensemble in name only.

---

## 1. MODULE: MARKET REGIME ENGINE (Primary Dashboard)

### Design Philosophy
Terminal-inspired with cyberpunk aesthetic — animated grid background, glowing accents, real-time data visualization. Fonts: Orbitron (headers), JetBrains Mono (data).

### Architecture: Existing to Enhanced

**Current Implementation** (`TechnicalDataPanel.tsx`):
- 4 modules: Order Book, Technical, Flow & Volume, Signals
- Data from `MLContext` + `OrderBookContext`
- Simplified calculations (RSI approximated from momentum, MACD from regime)

**Enhanced Implementation** — 6 interconnected panels:

```
+------------------------------------------------------------------+
|  BTC  $75,860.62  ^ 0.030  v 0.988  |  Last: 2025-02-06         |
+------------------+------------------+----------------------------+
|  ORDER BOOK      |  TECHNICAL       |  FLOW & VOLUME             |
|                  |  INDICATORS      |                            |
|  OBI: -89.3%     |  RSI(14): 35.6   |  CVD 1m: -$340,281.98     |
|  BEARISH         |  MACD: -112,270  |  CVD 3m: +$638,004.92     |
|  Depth 0.1%:     |  Signal: -70,384 |  CVD 5m: -$458,267.88     |
|    $578,751      |  BEARISH         |  Delta 1m: -$78,444.08    |
|  Depth 0.5%:     |  VWAP: $76,095   |  Delta 5m: +$76,099.50    |
|    $578,751      |  BELOW           |                            |
|  Depth 1.5%:     |                  |  [Volume Profile Histo]    |
|    $73,845       |  MOVING AVERAGES |  POC: $75,860              |
|                  |  EMA 5: $75,827  |                            |
|  SELL WALLS      |  EMA 20: $75,967 |                            |
|  $75,860 WALL    |  < EMA 20        |                            |
|  $75,644 3 lvl   |                  |                            |
|                  |  Heikin Ashi     |                            |
|                  |  vvv^ Trend down |                            |
+------------------+------------------+----------------------------+
|  ACTIVE SIGNALS                                                   |
|  ! OBI -> BEARISH (-89.3%)                                        |
|  CVD 5m -> sell pressure (-$458,267.88)                           |
|  MACD hist -> bearish divergence                                  |
|  Price below VWAP ($76,095)                                       |
|  EMA -> death cross (5 < 20)                                     |
|  SELL wall -> 3 levels resistance                                 |
+------------------------------------------------------------------+
|  MARKET REGIME                                                    |
|  ████████████████████░░░░░░░░░░  BEARISH  -7                     |
|  -10 (Max Bear)        0 (Neutral)       +10 (Max Bull)          |
|  CURRENT: High Volatility Downtrend                               |
+------------------------------------------------------------------+
|  * RISK OVERLAY (NEW)                                             |
|  Position: FLAT | Max Drawdown Today: -$2,340 | VaR(95%): $8,200 |
|  Margin Used: 0% | Kill Switch: ARMED | Exposure Limit: $50,000  |
+------------------------------------------------------------------+
```

### Data Pipeline (maps to existing code)

| Panel | Data Source | Existing Code | Enhancement Needed |
|-------|-----------|---------------|-------------------|
| Order Book | `OrderBookContext` -> Binance L2 | `Level2FeatureExtractor.ts` | Add wall detection at 2-sigma volume |
| Technical | `useMLEngine()` -> regime + predictions | `HiddenMarkovModel.ts` | Real RSI/MACD from price history |
| Flow & Volume | `OrderBookContext` + computed deltas | `FeatureProcessor.ts` | CVD accumulation buffer |
| Active Signals | Composite from all panels | `TechnicalDataPanel.tsx` | Signal scoring + priority ranking |
| Market Regime | `HiddenMarkovModel` 5-state | `HiddenMarkovModel.ts` | Expose transition probabilities |
| Risk Overlay | **NEW** — `RiskManager` class | None exists | Full implementation needed |

### Interactive Elements
- Hover tooltips on all data points showing historical context
- Click-to-drill on signals (expands signal reasoning)
- Real-time price tick animation with micro-trend arrows
- Scanline CRT effect on regime transitions
- Responsive grid: 3-col desktop, 2-col tablet, 1-col mobile

---

## 2. MODULE: STRATEGY ENGINE (MDP Framework)

### Critical Redesign: Two Separate MDPs

The draft conflates feature selection with trading decisions. These operate on fundamentally different timescales and MUST be separate:

### MDP-1: Feature Selection (Slow — hourly/daily)

```
State:  s1 = (F_active, performance_history, regime_distribution, compute_budget)
Action: a1 in {ADD_FEATURE, REMOVE_FEATURE, SWAP_FEATURE, TUNE_HYPERPARAM}
Reward: R1 = alpha * delta_Sharpe(window=1h) - beta * |F| - gamma * delta_Latency
gamma:  0.99 (long horizon — feature changes have persistent effects)
```

### MDP-2: Trading Decisions (Fast — per tick/500ms)

```
State:  s2 = (microstructure, regime, portfolio_state, risk_state, signal_vector)
Action: a2 = (direction in {-1,0,+1}, size in [0,1], urgency in [0,1])
Reward: R2 = risk_adjusted_pnl - lambda * |slippage| - mu * max(0, drawdown - limit)
gamma:  0.95 (shorter horizon — trade outcomes resolve quickly)
```

### State Vector Design (MDP-2 — Trading)

```
s2 in R^78 composed of:

MICROSTRUCTURE (50-dim) — from Level2FeatureExtractor:
  [0-2]   bid_ask_spread, order_flow_toxicity, price_impact (Kyle's lambda)
  [3-12]  multi-level order imbalance (10 levels)
  [13-32] volume profile (10 bid + 10 ask, normalized)
  [33-49] liquidity depth at levels (17 dims)

REGIME (8-dim) — from HiddenMarkovModel:
  [50]    regime_id (one-hot encoded: trending_up/down, ranging, volatile, breakout)
  [51-55] transition_probabilities (current -> each state)
  [56]    rolling_momentum
  [57]    rolling_volatility

PORTFOLIO (8-dim) — NEW from RiskManager:
  [58]    current_position (normalized: -1 to +1)
  [59]    unrealized_pnl (normalized by daily VaR)
  [60]    time_in_trade (seconds, log-scaled)
  [61]    margin_utilization (0 to 1)
  [62]    trades_today (normalized)
  [63]    daily_pnl (normalized by daily target)
  [64]    max_drawdown_today (normalized)
  [65]    available_risk_budget (0 to 1)

SIGNALS (8-dim) — from OnlineDeepLearner + MarkovChainPredictor:
  [66-68] multi_horizon_direction (1ms, 10ms, 100ms confidence)
  [69]    markov_expected_move
  [70]    markov_confidence
  [71]    a3c_signal (actor output)
  [72]    ddpg_signal (continuous action)
  [73]    ensemble_agreement (correlation of all signals)

TEMPORAL (4-dim) — context:
  [74]    seconds_since_last_trade
  [75]    volatility_ratio (current / 1h average)
  [76]    spread_z_score
  [77]    hour_of_day (cyclical encoded)
```

### Action Space (MDP-2)

```
Composite action decoded from DQN output:

TradingAction:
    direction: int      # -1 (sell), 0 (hold), +1 (buy)
    size: float         # 0.0 to 1.0 (fraction of max position)
    urgency: float      # 0.0 (passive/limit) to 1.0 (aggressive/market)

Discrete action space for DQN: 15 actions
3 directions x 5 sizes = 15 base actions
Urgency determined by regime volatility (not learned)

ACTIONS = [
    (SELL, 1.0), (SELL, 0.5), (SELL, 0.25), (SELL, 0.1), (SELL, 0.05),
    (HOLD, 0.0),  # Single hold action
    (BUY, 0.05), (BUY, 0.1), (BUY, 0.25), (BUY, 0.5), (BUY, 1.0),
    # Special actions:
    (FLATTEN, 1.0),    # Close all positions immediately
    (SCALE_IN, 0.25),  # Add to winning position
    (SCALE_OUT, 0.5),  # Reduce losing position
    (REVERSE, 1.0),    # Flip position direction
]
```

### Reward Function (Enhanced)

```
R(s, a, s') = w1 * PnL_realized(s')            # Actual P&L from closed trades
            + w2 * PnL_unrealized(delta_s')     # Change in mark-to-market
            - w3 * |slippage(a)|                # Execution cost
            - w4 * max(0, DD(s') - DD_limit)^2  # Quadratic drawdown penalty (HARD)
            - w5 * |position(s')| * holding_cost # Carry cost
            + w6 * I(regime_correct(s'))         # Bonus for regime-aligned trades

where:
  w1 = 0.40  (realized P&L — primary objective)
  w2 = 0.20  (unrealized — encourages holding winners)
  w3 = 0.15  (slippage — penalizes overtrading)
  w4 = 5.00  (drawdown — SEVERE penalty, quadratic growth)
  w5 = 0.05  (holding cost — slight bias toward flat)
  w6 = 0.10  (regime bonus — rewards understanding market state)
  I() = indicator function
```

### Strategy Engine UI Layout

```
+------------------------------------------------------------------+
|  STRATEGY ENGINE — MARKOV DECISION PROCESS FRAMEWORK              |
|  EXPECTED RETURN: +12.4%  SHARPE: 2.87  STATE VALUE: $8,942      |
+---------------------------------+--------------------------------+
|  Current Trading State: S123    |  STATE VECTOR COMPONENTS        |
|  Refresh / Down / Settings      |  t = 1,247 | epoch = 89        |
|                                 |                                |
|  MDP-1 (Feature Selection)     |  MARKET REGIME    0.73  ^ 0.08 |
|  Active Features: 5/9          |  VOLATILITY S     0.42  v 0.03 |
|  Last Optimization: 2m ago     |  MOMENTUM         0.68  ^ 0.12 |
|                                 |  LIQUIDITY        0.91  ^ 0.05 |
|  MDP-2 (Trading)               |  CORRELATION P    0.34  v 0.09 |
|  Position: LONG 0.25x          |  SENTIMENT        0.56  ^ 0.04 |
|  Signal: BUY (conf: 87.3%)     |  VOL SKEW        -0.18  v 0.06 |
|  Risk Budget: 72% remaining    |  ALPHA SIGNAL     0.82  ^ 0.15 |
+---------------------------------+--------------------------------+
|  FEATURE SELECTION SPACE (MDP-1)                                  |
|  +---------+ +---------+ +---------+ +---------+ +---------+     |
|  | RSI(14) | |  MACD   | |Bollinger| |   OBV   | |   ATR   |     |
|  | +0.087  | | +0.124  | | +0.043  | | +0.091  | | -0.012  |     |
|  | ACTIVE  | | ACTIVE  | | ACTIVE  | | ACTIVE  | |INACTIVE |     |
|  +---------+ +---------+ +---------+ +---------+ +---------+     |
|  +---------+ +---------+ +---------+ +---------+                 |
|  |Stochast.| |   ADX   | |Vol Surf.| |Greeks D |                 |
|  | +0.068  | | +0.029  | | +0.156  | | +0.073  |                 |
|  | ACTIVE  | |INACTIVE | |INACTIVE | |INACTIVE |                 |
|  +---------+ +---------+ +---------+ +---------+                 |
+------------------------------------------------------------------+
|  REWARD FUNCTION R(S,A,S')                                        |
|  R = 0.4*PnL + 0.2*dMtM - 0.15*Slip - 5.0*DD^2 - 0.05*Carry   |
|      + 0.1*RegimeBonus                                            |
+---------------------------------+--------------------------------+
|  PERFORMANCE METRICS            |  Q(S,A) TABLE                  |
|  EXPECTED VALUE V(S): $8,942   |  Add Vol Surface    -> 8,942   |
|  ^ 12%                          |  Remove Stochastic  -> 8,123   |
|  POLICY CONVERGENCE: 94.7%     |  Swap MACD <-> ADX  -> 7,856   |
|  ^ 3.2%                         |  Add Greeks D       -> 8,734   |
|  BELLMAN ERROR d: 0.0034       |  No Change (Hold)   -> 8,421   |
|  v 0.001                        |  * Optimal: Add Vol Surface    |
+---------------------------------+--------------------------------+
|  OPTIMAL POLICY pi*                                               |
|  Given regime (0.73) and momentum (0.68):                         |
|  pi*(s123) = ADD_FEATURE(Vol Surface)                             |
|  Expected improvement: +$521 | P(success): 87.3%                 |
+------------------------------------------------------------------+
```

### Font Stack
- **Playfair Display** (serif) — section headers, institutional feel
- **IBM Plex Mono** — data values, state vectors
- **DM Sans** — labels, descriptions

---

## 3. MODULE: RL CORE ENGINE (GBFS to MDP Migration)

### Migration Strategy: Incremental, Not Big-Bang

The draft proposes replacing GBFS entirely. This is high-risk. Instead:

**Phase 1**: Run MDP alongside GBFS, compare outputs
**Phase 2**: MDP takes primary with GBFS as fallback
**Phase 3**: Full MDP once validated on 3+ months live data

### Existing Code Integration Map

```
EXISTING COMPONENT          -> MDP ROLE                -> FILE LOCATION
----------------------------------------------------------------------
AdaptiveMarketLearner       -> MDP-2 Orchestrator      -> AdaptiveMarketLearner.ts
A3CAgent                    -> MDP-2 Policy Network    -> A3CAgent.ts
DDPGAgent                   -> MDP-2 Position Sizing   -> DDPGAgent.ts
HiddenMarkovModel (5-state) -> Regime Context for both -> HiddenMarkovModel.ts
OnlineDeepLearner           -> MDP-2 Value Estimator   -> OnlineDeepLearner.ts
MarkovChainPredictor        -> State Transition Model  -> MarkovChainPredictor.ts
Level2FeatureExtractor      -> State Encoder (micro)   -> Level2FeatureExtractor.ts
FeatureProcessor            -> State Encoder (macro)   -> FeatureProcessor.ts
ReplayBuffer                -> Experience Storage      -> buffers.ts
ShortTermMemory             -> Recent Experience Cache -> buffers.ts
MLReinforcementLogger       -> Training Telemetry      -> MLReinforcementLogger.ts
Backtester                  -> Offline Policy Eval     -> Backtester.ts
```

### What Needs to Be BUILT (New Files)

```
NEW COMPONENT               -> PURPOSE                          -> PRIORITY
--------------------------------------------------------------------------
RiskManager.ts              -> Hard risk limits, position mgmt  -> P0 (CRITICAL)
ExecutionEngine.ts          -> Order routing, slippage model    -> P0 (CRITICAL)
MDPFeatureSelector.ts       -> MDP-1 implementation             -> P1 (HIGH)
UnifiedStateEncoder.ts      -> 78-dim state vector builder     -> P1 (HIGH)
RewardCalculator.ts         -> Multi-objective reward compute  -> P1 (HIGH)
DuelingDQN.ts               -> Replace/enhance A3CAgent        -> P2 (MEDIUM)
PrioritizedReplayBuffer.ts  -> Upgrade ReplayBuffer            -> P2 (MEDIUM)
RegimeAwareQNetwork.ts      -> Separate Q-heads per regime     -> P2 (MEDIUM)
StrategyEngineDashboard.tsx -> Module 2 UI component           -> P2 (MEDIUM)
RLCoreAnalysisDashboard.tsx -> Module 3 UI component           -> P3 (LOWER)
MultiTimeframeEnsemble.ts   -> Aggregate signals across TFs   -> P3 (LOWER)
```

### Computational Complexity (Realistic)

| Operation | Current System | MDP System | Realistic Improvement |
|-----------|---------------|------------|----------------------|
| Feature Selection | O(d*n*t) GBFS | O(d^2*log n) DQN | down 50-65% |
| Hyperparameter Tuning | O(k*m*n) Grid | O(a*log k) UCB | down 70-85% |
| Model Selection | O(3*k*n) Full Grid | O(a*d) Policy | down 80-90% |
| Data Subset Selection | O(n^2*d) GTP | O(n*d) Learned | down 40-50% |
| **Total Pipeline** | **O(n^2*d*k*m)** | **O(d^2*n*log k)** | **down 45-55%** |

> Note: Draft claimed 73% — this is optimistic. Non-stationarity requires periodic re-optimization that resets amortized gains. 45-55% is the honest number.

### DQN Architecture (Replaces Simple Q-Table)

```
                    +---------------------+
                    |   State Input (78)   |
                    +----------+----------+
                               |
                    +----------v----------+
                    |  BatchNorm + Noise   |
                    +----------+----------+
                               |
                    +----------v----------+
                    |  Dense(256, ReLU)    |
                    |  + Dropout(0.1)      |
                    +----------+----------+
                               |
                    +----------v----------+
                    |  Dense(128, ReLU)    |
                    +------+--------+-----+
                           |        |
              +------------v--+  +--v------------+
              |  Value Stream  |  |Advantage Stream|  <-- Dueling Architecture
              |  Dense(64)     |  |  Dense(64)     |
              |  Dense(1)      |  |  Dense(15)     |  <-- 15 actions
              +--------+------+  +------+---------+
                       |                |
                    +--v----------------v--+
                    |  Q(s,a) = V(s) +      |  <-- Dueling aggregation
                    |  A(s,a) - mean(A)     |
                    +----------+-----------+
                               |
                    +----------v----------+
                    |  x 5 Regime Heads    |  <-- Regime-conditional
                    |  (trending_up,       |
                    |   trending_down,     |
                    |   ranging, volatile, |
                    |   breakout)          |
                    +---------------------+
```

Key architectural decisions:
- **Dueling DQN**: Separates state value from action advantage — critical for trading where most states have similar values but very different optimal actions
- **5 Regime Heads**: Each HMM regime gets its own advantage stream. Prevents catastrophic forgetting when regime changes. The value stream is shared (market is always worth something).
- **Double Q-Learning**: Two networks to reduce overestimation bias (the existing `DDPGAgent` already has target networks — reuse this pattern)
- **Prioritized Replay**: Weight rare transitions (regime changes, large moves) higher. Current `ReplayBuffer` samples uniformly — loses critical experiences

### Reward Engineering Detail

```python
class RewardCalculator:
    def compute(self, state, action, next_state, execution_report):
        # 1. Realized P&L (closed trades only)
        realized = execution_report.realized_pnl

        # 2. Unrealized P&L change (mark-to-market)
        unrealized_delta = next_state.unrealized_pnl - state.unrealized_pnl

        # 3. Execution quality (slippage from mid-price)
        slippage = abs(execution_report.fill_price - execution_report.mid_price_at_order)

        # 4. Drawdown penalty (QUADRATIC — severe)
        dd = next_state.max_drawdown_today
        dd_limit = self.risk_manager.daily_drawdown_limit
        dd_penalty = max(0, dd - dd_limit * 0.7) ** 2  # Starts penalizing at 70% of limit

        # 5. Holding cost (slight flat bias)
        holding = abs(next_state.position) * self.funding_rate * self.dt

        # 6. Regime alignment bonus
        regime_bonus = 1.0 if self._trade_aligns_with_regime(action, next_state.regime) else 0.0

        # 7. Sharpe contribution (rolling)
        sharpe_contrib = self._rolling_sharpe_contribution(realized + unrealized_delta)

        return (
            0.35 * realized +
            0.15 * unrealized_delta -
            0.15 * slippage -
            5.00 * dd_penalty -
            0.05 * holding +
            0.10 * regime_bonus +
            0.20 * sharpe_contrib
        )
```

---

## 4. MODULE: RISK MANAGEMENT & EXECUTION (NEW — Critical Addition)

### This module does not exist in the draft. It is the most important module.

### RiskManager Architecture

```
+------------------------------------------------------------------+
|                    RISK MANAGEMENT LAYER                           |
|        (Sits BETWEEN Strategy Engine and Exchange)                 |
+------------------------------------------------------------------+
|                                                                    |
|  PRE-TRADE CHECKS (Hard Limits — CANNOT be overridden by RL):    |
|  +-----------------------------------------------------------+   |
|  | 1. Position Limit:  |pos| <= MAX_POSITION                  |   |
|  | 2. Daily Loss Limit: DD_today <= MAX_DAILY_LOSS            |   |
|  | 3. Drawdown Limit:  DD_peak <= MAX_DRAWDOWN                |   |
|  | 4. Order Rate Limit: orders/min <= MAX_ORDER_RATE          |   |
|  | 5. Exposure Limit:  notional <= MAX_EXPOSURE               |   |
|  | 6. Correlation Check: new_trade orthogonal existing_port   |   |
|  | 7. Volatility Gate:  vol < 3sigma (pause in extreme vol)   |   |
|  +-----------------------------------------------------------+   |
|                                                                    |
|  POSITION SIZING (Kelly Criterion + Regime Adjustment):           |
|  f* = (p*b - q) / b   where p=win_rate, b=avg_win/avg_loss      |
|  f_adjusted = f* x regime_multiplier x confidence                 |
|  regime_multiplier:                                                |
|    trending_up/down = 1.0                                         |
|    ranging = 0.6                                                   |
|    volatile = 0.3                                                  |
|    breakout = 0.8 (if confirmed) / 0.2 (if unconfirmed)          |
|                                                                    |
|  KILL SWITCH:                                                      |
|  if (daily_loss > MAX_DAILY_LOSS || volatility > 5sigma):         |
|    FLATTEN ALL POSITIONS IMMEDIATELY                               |
|    DISABLE TRADING FOR 30 MINUTES                                  |
|    ALERT OPERATOR                                                  |
|                                                                    |
+------------------------------------------------------------------+
```

### ExecutionEngine Architecture

```
+------------------------------------------------------------------+
|                    EXECUTION ENGINE                                |
+------------------------------------------------------------------+
|                                                                    |
|  ORDER TYPES (selected by urgency parameter):                     |
|                                                                    |
|  urgency = 0.0-0.3 -> PASSIVE (Limit @ best bid/ask)            |
|    - Post-only maker orders                                       |
|    - Cancel-replace if market moves                               |
|    - Timeout: 5 seconds, then escalate urgency                   |
|                                                                    |
|  urgency = 0.3-0.7 -> ADAPTIVE (TWAP over 2-5 seconds)          |
|    - Split into 3-5 child orders                                  |
|    - Adaptive sizing based on book depth                          |
|    - Iceberg hiding for large orders                              |
|                                                                    |
|  urgency = 0.7-1.0 -> AGGRESSIVE (Immediate market order)        |
|    - Cross spread immediately                                     |
|    - Used for: stop losses, regime transitions, kill switch       |
|                                                                    |
|  SLIPPAGE MODEL:                                                   |
|    estimated_slippage(size) = spread/2 + kyle_lambda * size       |
|    where kyle_lambda from Level2FeatureExtractor                  |
|                                                                    |
|  POST-TRADE ANALYSIS:                                              |
|    actual_slippage = fill_price - mid_price_at_signal             |
|    implementation_shortfall = expected_return - actual_return      |
|    This feeds back into reward function as execution quality      |
|                                                                    |
+------------------------------------------------------------------+
```

### Risk Parameters (Default Configuration)

```typescript
interface RiskConfig {
  // Hard limits (never violated)
  maxPositionSize: number;      // e.g., 0.5 BTC
  maxDailyLoss: number;         // e.g., $5,000
  maxDrawdownFromPeak: number;  // e.g., $15,000
  maxOrdersPerMinute: number;   // e.g., 10
  maxNotionalExposure: number;  // e.g., $50,000

  // Soft limits (trigger warnings)
  warningDrawdownPct: number;   // e.g., 0.7 (70% of max)
  warningLossRate: number;      // e.g., 3 consecutive losses

  // Regime adjustments
  volatileRegimeMultiplier: number;  // e.g., 0.3
  trendingRegimeMultiplier: number;  // e.g., 1.0
  rangingRegimeMultiplier: number;   // e.g., 0.6

  // Kill switch
  killSwitchDailyLoss: number;  // e.g., $8,000
  killSwitchCooldown: number;   // e.g., 1800000 (30 min ms)
  killSwitchVolatility: number; // e.g., 5.0 (sigma multiplier)
}
```

---

## 5. UNIFIED SYSTEM ARCHITECTURE

### Data Flow (End-to-End)

```
BINANCE L2 FEED (500ms)
        |
        v
+-------------------+
|  OrderBookContext  | <-- src/app/api/Page.tsx
|  (React Context)  |
+---------+---------+
          |
          v
+-----------------------------------------------------------+
|              ADAPTIVE MARKET LEARNER (Orchestrator)         |
|              AdaptiveMarketLearner.ts                       |
|                                                             |
|  +-----------------+  +------------------+                  |
|  | Level2Feature   |  | FeatureProcessor |                  |
|  | Extractor       |  | (OBI, VWAP, etc) |                  |
|  | (Microstructure)|  |                  |                  |
|  +--------+--------+  +--------+---------+                  |
|           |                     |                           |
|           +--------+------------+                           |
|                    v                                        |
|  +--------------------------+                               |
|  |  UnifiedStateEncoder     | <-- NEW (78-dim state vec)   |
|  |  (micro + regime +       |                               |
|  |   portfolio + signals +  |                               |
|  |   temporal)              |                               |
|  +----------+---------------+                               |
|             |                                               |
|     +-------+-------------------+                           |
|     v                           v                           |
|  +----------------+    +-------------------+                |
|  | HiddenMarkov   |   |  OnlineDeepLearner |                |
|  | Model          |   |  (Multi-horizon)   |                |
|  | (Regime Det.)  |   |  + Attention wts   |                |
|  +-------+--------+   +--------+----------+                |
|          |                      |                           |
|          v                      v                           |
|  +--------------------------------------+                   |
|  |  STRATEGY ENGINE (MDP-2)             |                   |
|  |  +--------+   +--------+            |                   |
|  |  |  A3C   |   |  DDPG  | -> Ensemble|                   |
|  |  | (dir.) |   | (size) |            |                   |
|  |  +---+----+   +---+----+            |                   |
|  |      +------+------+                |                   |
|  |             v                        |                   |
|  |  +---------------------+            |                   |
|  |  |  DuelingDQN         | <-- NEW    |                   |
|  |  |  (15 actions x      |            |                   |
|  |  |   5 regime heads)   |            |                   |
|  |  +----------+----------+            |                   |
|  +-------------+------------------------+                   |
|                |                                            |
+----------------+--------------------------------------------+
                 |
                 v
+-----------------------------------+
|      RISK MANAGER                  | <-- NEW (P0 CRITICAL)
|  Pre-trade checks (HARD limits)   |
|  Position sizing (Kelly + regime) |
|  Kill switch                      |
+----------------+------------------+
                 | (approved + sized order)
                 v
+-----------------------------------+
|      EXECUTION ENGINE              | <-- NEW (P0 CRITICAL)
|  Order routing (passive/adaptive/ |
|  aggressive based on urgency)     |
|  Slippage tracking                |
|  Post-trade analysis              |
+----------------+------------------+
                 | (execution report)
                 v
+-----------------------------------+
|      REWARD CALCULATOR             | <-- NEW
|  Feeds back to MDP-2 replay buffer|
|  Updates training loop            |
+-----------------------------------+
```

### Context/Provider Hierarchy (React)

```tsx
<OrderBookProvider>          {/* Binance L2 feed */}
  <MLEngineProvider>         {/* AdaptiveMarketLearner */}
    <RiskProvider>           {/* NEW — RiskManager state */}
      <StrategyProvider>     {/* NEW — MDP state + actions */}
        <DashboardLayout>
          <MarketRegimePanel />      {/* Module 1 */}
          <StrategyEnginePanel />    {/* Module 2 */}
          <RLCoreAnalysisPanel />    {/* Module 3 */}
        </DashboardLayout>
      </StrategyProvider>
    </RiskProvider>
  </MLEngineProvider>
</OrderBookProvider>
```

---

## 6. IMPLEMENTATION ROADMAP

### Phase 1: Foundation (Week 1-2) — CRITICAL PATH

| Task | File | Depends On | Est. Hours |
|------|------|-----------|------------|
| RiskManager class | `src/app/components/TradingEngine/RiskManager.ts` | None | 8h |
| RiskContext provider | `src/app/api/RiskContext.tsx` | RiskManager | 4h |
| Risk overlay in Market Regime panel | `TechnicalDataPanel.tsx` | RiskContext | 4h |
| UnifiedStateEncoder | `src/app/components/TradingEngine/UnifiedStateEncoder.ts` | Level2FeatureExtractor | 6h |
| Extend MarketRegime type | `src/tradingEngine/types/index.ts` | None | 2h |
| **Subtotal** | | | **24h** |

### Phase 2: Strategy Engine Core (Week 3-4)

| Task | File | Depends On | Est. Hours |
|------|------|-----------|------------|
| RewardCalculator | `src/app/components/TradingEngine/RewardCalculator.ts` | RiskManager | 6h |
| PrioritizedReplayBuffer | `src/tradingEngine/utils/PrioritizedReplayBuffer.ts` | ReplayBuffer | 4h |
| DuelingDQN with regime heads | `src/app/components/TradingEngine/DuelingDQN.ts` | UnifiedStateEncoder | 12h |
| MDPFeatureSelector (MDP-1) | `src/app/components/TradingEngine/MDPFeatureSelector.ts` | OnlineDeepLearner | 8h |
| StrategyContext provider | `src/app/api/StrategyContext.tsx` | DuelingDQN, RiskManager | 4h |
| **Subtotal** | | | **34h** |

### Phase 3: Execution Layer (Week 5-6)

| Task | File | Depends On | Est. Hours |
|------|------|-----------|------------|
| ExecutionEngine | `src/app/components/TradingEngine/ExecutionEngine.ts` | RiskManager | 10h |
| Slippage model integration | ExecutionEngine.ts | Level2FeatureExtractor | 4h |
| Order routing logic | ExecutionEngine.ts | OrderBookContext | 6h |
| Post-trade analysis feedback loop | RewardCalculator.ts | ExecutionEngine | 4h |
| **Subtotal** | | | **24h** |

### Phase 4: UI Dashboards (Week 7-8)

| Task | File | Depends On | Est. Hours |
|------|------|-----------|------------|
| Enhanced TechnicalDataPanel (Module 1) | `TechnicalDataPanel.tsx` | Phase 1 | 8h |
| StrategyEngineDashboard (Module 2) | `StrategyEngineDashboard.tsx` | Phase 2 | 12h |
| RLCoreAnalysisDashboard (Module 3) | `RLCoreAnalysisDashboard.tsx` | Phase 2 | 10h |
| Animation, scanlines, interactivity | All dashboards | Phase 4 base | 6h |
| **Subtotal** | | | **36h** |

### Phase 5: Integration & Validation (Week 9-12)

| Task | Est. Hours |
|------|------------|
| Wire MDP-2 into AdaptiveMarketLearner training loop | 8h |
| A/B: MDP vs current GBFS on historical data | 12h |
| Paper trading (simulated execution, real data) | 20h |
| Performance tuning (latency, memory) | 8h |
| Stress testing (flash crash, API failure, stale data) | 8h |
| **Subtotal** | **56h** |

### Total: ~174 hours (~4-5 weeks full-time)

---

## 7. KEY METRICS TO TRACK

### System Health
- **Latency**: Signal-to-order < 50ms (current: ~8ms for ML inference)
- **Throughput**: Process 2+ order book updates/sec (current: 2Hz throttle)
- **Memory**: TF.js tensor count stable (no leaks)
- **Bellman Error delta**: < 0.01 indicates convergence

### Trading Performance
- **Sharpe Ratio**: Target > 2.0 (institutional grade)
- **Max Drawdown**: < 5% of capital
- **Win Rate**: > 55% (combined with 1.5+ profit factor)
- **Implementation Shortfall**: < 0.02% per trade
- **Regime Detection Accuracy**: > 70% (validated against retrospective labeling)

### RL Training Health
- **Policy Convergence**: Q-value variance decreasing over time
- **Exploration Rate epsilon**: Decaying from 0.1 to 0.01 over 10K episodes
- **Replay Buffer Utilization**: Prioritized weights should have high variance (important transitions weighted more)
- **Regime Head Specialization**: Each head should activate predominantly for its regime

---

## 8. STRATEGIC RECOMMENDATIONS (Priority Ordered)

### 1. Build RiskManager FIRST (Week 1)
Without risk management, the RL agent is a loaded gun. No amount of alpha generation matters if one bad trade wipes the account. Implement hard limits before any MDP work.

### 2. Eliminate Grid Search Immediately (Quick Win)
Current system trains all 3 models for every configuration. MDP-1 learns which model performs best per regime in ~100 episodes. Quick implementation: add `SWITCH_MODEL` action to existing A3CAgent.

### 3. Leverage Existing Attention Weights
`OnlineDeepLearner` already has attention-based feature importance (the `attention_weights` layer). This IS a form of learned feature selection. Feed these weights into MDP-1 as prior knowledge instead of starting from scratch.

### 4. Prioritized Replay is the Highest-ROI Upgrade
Trading data is expensive (years of history). Upgrading `ReplayBuffer` to prioritized sampling means learning 10-20x faster from the same data. Regime transitions and large price moves get sampled more often.

### 5. Start Paper Trading in Week 3
Don't wait for full implementation. Run the existing system with `RiskManager` guardrails on paper. Collect execution data for `RewardCalculator` calibration. Real market data is worth 100x simulated.

### 6. Transfer Learning Across Assets (Post-Launch)
Once BTC policy is validated, fine-tune for ETH/SOL with 10-20% of training episodes. Feature relationships (OBI + toxicity -> price impact) transfer across assets. The `HiddenMarkovModel` states generalize naturally.

---

## 9. EXPECTED OUTCOMES

| Metric | Current System | With Sovereign Engine | Improvement |
|--------|---------------|----------------------|-------------|
| Training Time | ~4.2h/cycle | ~2.0h/cycle | -52% |
| OOS Sharpe Ratio | ~1.4 | ~2.2 | +57% |
| Max Drawdown | Unbounded | Hard-capped 5% | Infinite to bounded |
| Sample Efficiency | 1x (uniform replay) | 10-15x (prioritized) | +1000% |
| Regime Adaptation | Full retrain (hours) | Online update (seconds) | ~1000x faster |
| Execution Quality | None (instant fill assumed) | Slippage-aware | New capability |
| Feature Selection | Manual / GBFS | Learned (MDP-1) | Autonomous |
| Position Sizing | Fixed | Kelly + regime-adjusted | Risk-optimal |

> **Conservative annual edge estimate**: Improved Sharpe (1.4 to 2.2) on $100K capital with 3x leverage = ~$45K additional annual return, minus ~$5K compute costs = **~$40K net improvement**.

---

*Document Version: 2.1 | Author: Sovereign Engine Architecture Team | Classification: PROPRIETARY*
*Last Updated: 2025-02-06 | Next Review: Post-Phase 1 Completion*
