/**
 * TradingEngine barrel exports — grouped by domain.
 *
 * RL Agents        – Reinforcement learning models
 * ML Models        – Online learning, feature extraction, prediction
 * Risk & Analysis  – Risk management, tail risk, thresholds
 * Execution        – Paper trading, execution, backtesting
 * Visualization    – Dashboard components
 * Infrastructure   – Logging, security, utilities
 */

// ─── RL AGENTS ───────────────────────────────────────────────────────────────
export { default as A3CAgent } from './A3CAgent';
export { default as DDPGAgent } from './DDPGAgent';
export { default as DuelingDQN } from './DuelingDQN';
export { default as RewardCalculator } from './RewardCalculator';
export { default as UnifiedStateEncoder } from './UnifiedStateEncoder';

// ─── ML MODELS & LEARNING ────────────────────────────────────────────────────
export { default as AdaptiveMarketLearner } from './AdaptiveMarketLearner';
export { default as OnlineDeepLearner } from './OnlineDeepLearner';
export { default as FeatureProcessor } from './FeatureProcessor';
export { default as MLTradingCore } from './MLTradingCore';
export { default as MarkovChainPredictor } from './MarkovChainPredictor';
export { default as MLEnsembleTrainer } from './MLEnsembleTrainer';
export { default as HiddenMarkovModel } from './HiddenMarkovModel';
export { default as Level2FeatureExtractor } from './Level2FeatureExtractor';
export { default as LOBFeatureExtractor } from './LOBFeatureExtractor';

// ─── RISK & ANALYSIS ─────────────────────────────────────────────────────────
export { default as RiskManager } from './RiskManager';
export { default as ParetoAnalyzer } from './ParetoAnalyzer';
export { RollingBuffer } from './RollingBuffer';
export { default as DynamicThresholds } from './DynamicThresholds';
export { default as GradientSurpriseMonitor } from './GradientSurpriseMonitor';
export { default as VolatilityEstimator } from './VolatilityEstimator';

// ─── EXECUTION & TRADING ─────────────────────────────────────────────────────
export { default as PaperTradingEngine } from './PaperTradingEngine';
export { default as ExecutionEngine } from './ExecutionEngine';
export { default as LOBBacktester } from './LOBBacktester';
export { default as Backtester } from './Backtester';
export { default as CandleAggregator } from './CandleAggregator';
export { default as ABEvaluator } from './ABEvaluator';
export { default as StressTestHarness } from './StressTestHarness';
export { default as MarketCharacteristor } from './MarketCharacteristor';
export { default as MarketStateConfig } from './MarketStateConfig';

// ─── INFRASTRUCTURE ──────────────────────────────────────────────────────────
export { default as SecureKeyManager } from './SecureKeyManager';
export { default as TradingSystemLogger } from './TradingSystemLogger';
