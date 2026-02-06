// src/tradingEngine/logging/MLReinforcementLogger.ts
import * as fs from 'fs';
import * as path from 'path';
import { EventEmitter } from 'events';

interface LogEntry {
  timestamp: string;
  epoch: number;
  type: 'TRAINING' | 'PREDICTION' | 'FEATURE' | 'MARKET_EVENT' | 'ERROR' | 'PERFORMANCE';
  data: any;
}

interface FeatureImportanceLog {
  timestamp: string;
  features: Map<string, number>;
  priceMove: number;
  marketRegime: string;
  confidence: number;
}

export class MLReinforcementLogger extends EventEmitter {
  private logFilePath: string;
  private featureLogPath: string;
  private performanceLogPath: string;
  private writeStream: fs.WriteStream | null = null;
  private currentSession: string;
  private logBuffer: string[] = [];
  private flushInterval: NodeJS.Timeout | null = null;
  
  // Feature tracking
  private featureImportanceHistory: FeatureImportanceLog[] = [];
  private bigMoveThreshold: number = 0.005; // 0.5% price move
  private noiseThreshold: number = 0.001; // 0.1% is considered noise
  
  constructor(logDirectory: string = './logs/ml_reinforcement') {
    super();
    
    // Create log directory if it doesn't exist
    if (!fs.existsSync(logDirectory)) {
      fs.mkdirSync(logDirectory, { recursive: true });
    }
    
    // Generate session ID
    this.currentSession = this.generateSessionId();
    
    // Set up log file paths
    const sessionDir = path.join(logDirectory, this.currentSession);
    fs.mkdirSync(sessionDir, { recursive: true });
    
    this.logFilePath = path.join(sessionDir, 'ml_reinforcement_log.txt');
    this.featureLogPath = path.join(sessionDir, 'feature_importance_log.txt');
    this.performanceLogPath = path.join(sessionDir, 'performance_metrics_log.txt');
    
    // Initialize log files with headers
    this.initializeLogFiles();
    
    // Set up auto-flush every 5 seconds
    this.flushInterval = setInterval(() => this.flushLogs(), 5000);
    
    // Handle process termination
    process.on('beforeExit', () => this.close());
    process.on('SIGINT', () => this.close());
    process.on('SIGTERM', () => this.close());
  }
  
  private generateSessionId(): string {
    const date = new Date();
    return `session_${date.getFullYear()}${(date.getMonth() + 1).toString().padStart(2, '0')}${date.getDate().toString().padStart(2, '0')}_${date.getHours().toString().padStart(2, '0')}${date.getMinutes().toString().padStart(2, '0')}${date.getSeconds().toString().padStart(2, '0')}`;
  }
  
  private initializeLogFiles(): void {
    // Main log header
    const mainHeader = `
================================================================================
ML REINFORCEMENT LEARNING LOG
Session: ${this.currentSession}
Started: ${new Date().toISOString()}
================================================================================

Configuration:
- Big Move Threshold: ${this.bigMoveThreshold * 100}%
- Noise Threshold: ${this.noiseThreshold * 100}%
- Learning Algorithm: A3C + DDPG Ensemble
- Feature Extraction: Level 2 Order Book Analysis
- Markov Chain Order: 3
================================================================================

`;
    
    // Feature importance header
    const featureHeader = `
================================================================================
FEATURE IMPORTANCE ANALYSIS LOG
Session: ${this.currentSession}
================================================================================

This log tracks feature importance scores and their correlation with price movements.
Features are ranked by their impact on significant price moves (>${this.bigMoveThreshold * 100}%).
Noise filtering applied for moves <${this.noiseThreshold * 100}%.
================================================================================

`;
    
    // Performance metrics header
    const performanceHeader = `
================================================================================
PERFORMANCE METRICS LOG
Session: ${this.currentSession}
================================================================================

Tracking model performance, accuracy, and trading outcomes.
================================================================================

`;
    
    fs.writeFileSync(this.logFilePath, mainHeader);
    fs.writeFileSync(this.featureLogPath, featureHeader);
    fs.writeFileSync(this.performanceLogPath, performanceHeader);
  }
  
  // Main logging method
  public log(message: string, data?: any, type: string = 'INFO'): void {
    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] [${type}] ${message}`;
    
    let formattedEntry = logEntry;
    if (data) {
      formattedEntry += '\n' + this.formatData(data);
    }
    formattedEntry += '\n';
    
    this.logBuffer.push(formattedEntry);
    
    // Emit for real-time monitoring
    this.emit('log', { timestamp, type, message, data });
    
    // Auto-flush if buffer is large
    if (this.logBuffer.length > 100) {
      this.flushLogs();
    }
  }
  
  // Log training epoch
  public logTrainingEpoch(
    epoch: number,
    loss: number,
    accuracy: number,
    learningRate: number,
    gradientNorm: number,
    rewards: number[]
  ): void {
    const entry = `
--------------------------------------------------------------------------------
TRAINING EPOCH ${epoch}
--------------------------------------------------------------------------------
Timestamp: ${new Date().toISOString()}
Loss: ${loss.toFixed(6)}
Accuracy: ${(accuracy * 100).toFixed(2)}%
Learning Rate: ${learningRate.toFixed(6)}
Gradient Norm: ${gradientNorm.toFixed(6)}
Average Reward: ${(rewards.reduce((a, b) => a + b, 0) / rewards.length).toFixed(4)}
Max Reward: ${Math.max(...rewards).toFixed(4)}
Min Reward: ${Math.min(...rewards).toFixed(4)}
Reward Std Dev: ${this.calculateStdDev(rewards).toFixed(4)}
--------------------------------------------------------------------------------
`;
    
    this.logBuffer.push(entry);
  }
  
  // Log feature importance with market context
  public logFeatureImportance(
    features: Map<string, number>,
    priceMove: number,
    prediction: number,
    marketRegime: string,
    orderBookState: any
  ): void {
    const isBigMove = Math.abs(priceMove) > this.bigMoveThreshold;
    const isNoise = Math.abs(priceMove) < this.noiseThreshold;
    
    // Sort features by importance
    const sortedFeatures = Array.from(features.entries())
      .sort((a, b) => b[1] - a[1]);
    
    const entry = `
================================================================================
FEATURE IMPORTANCE ANALYSIS
================================================================================
Timestamp: ${new Date().toISOString()}
Market Regime: ${marketRegime}
Price Move: ${(priceMove * 100).toFixed(4)}% ${isBigMove ? '*** BIG MOVE ***' : isNoise ? '(noise)' : ''}
Prediction: ${(prediction * 100).toFixed(4)}%
Prediction Error: ${((prediction - priceMove) * 100).toFixed(4)}%

Top Features Affecting Decision:
${sortedFeatures.slice(0, 10).map(([name, importance], index) => 
  `${(index + 1).toString().padStart(2)}. ${name.padEnd(25)} ${(importance * 100).toFixed(2)}%`
).join('\n')}

Order Book Context:
- Bid/Ask Spread: ${orderBookState.spread?.toFixed(4) || 'N/A'}
- Order Imbalance: ${orderBookState.imbalance?.toFixed(4) || 'N/A'}
- Liquidity Depth: ${orderBookState.liquidityDepth || 'N/A'}
- Volume Profile Skew: ${orderBookState.volumeSkew?.toFixed(4) || 'N/A'}

${isBigMove ? this.analyzeBigMoveFeatures(sortedFeatures, priceMove) : ''}
================================================================================
`;
    
    // Write to feature log
    fs.appendFileSync(this.featureLogPath, entry);
    
    // Store for pattern analysis
    this.featureImportanceHistory.push({
      timestamp: new Date().toISOString(),
      features,
      priceMove,
      marketRegime,
      confidence: Math.abs(prediction - priceMove) < 0.001 ? 1 : 0
    });
    
    // Analyze patterns if we have enough history
    if (this.featureImportanceHistory.length > 100 && this.featureImportanceHistory.length % 100 === 0) {
      this.analyzeFeaturePatterns();
    }
  }
  
  // Analyze features that correlate with big moves
  private analyzeBigMoveFeatures(
    features: Array<[string, number]>,
    priceMove: number
  ): string {
    return `
>>> BIG MOVE ANALYSIS <
Direction: ${priceMove > 0 ? 'UPWARD' : 'DOWNWARD'}
Magnitude: ${Math.abs(priceMove * 100).toFixed(3)}%

Critical Features for This Move:
${features.slice(0, 5).map(([name, importance]) => {
  const impact = importance > 0.5 ? 'HIGH IMPACT' : 
                 importance > 0.3 ? 'MEDIUM IMPACT' : 'LOW IMPACT';
  return `- ${name}: ${(importance * 100).toFixed(2)}% [${impact}]`;
}).join('\n')}

Feature Correlation with Move Direction:
${this.calculateFeatureDirectionCorrelation(features, priceMove)}
`;
  }
  
  // Calculate correlation between features and price direction
  private calculateFeatureDirectionCorrelation(
    features: Array<[string, number]>,
    priceMove: number
  ): string {
    const direction = priceMove > 0 ? 1 : -1;
    const correlations: string[] = [];
    
    features.slice(0, 5).forEach(([name, importance]) => {
      // Simple correlation estimate
      const correlation = importance * direction;
      const strength = Math.abs(correlation) > 0.5 ? 'STRONG' :
                      Math.abs(correlation) > 0.3 ? 'MODERATE' : 'WEAK';
      
      correlations.push(`- ${name}: ${correlation > 0 ? 'POSITIVE' : 'NEGATIVE'} (${strength})`);
    });
    
    return correlations.join('\n');
  }
  
  // Analyze historical patterns
  private analyzeFeaturePatterns(): void {
    const analysis = this.performPatternAnalysis();
    
    const patternEntry = `
********************************************************************************
PATTERN ANALYSIS REPORT - ${new Date().toISOString()}
********************************************************************************

Sample Size: ${this.featureImportanceHistory.length} events

BIG MOVES ANALYSIS:
${analysis.bigMoves}

NOISE FILTERING:
${analysis.noiseAnalysis}

FEATURE CONSISTENCY:
${analysis.featureConsistency}

REGIME-SPECIFIC PATTERNS:
${analysis.regimePatterns}

RECOMMENDATIONS:
${analysis.recommendations}

********************************************************************************
`;
    
    fs.appendFileSync(this.featureLogPath, patternEntry);
  }
  
  // Perform detailed pattern analysis
  private performPatternAnalysis(): any {
    const bigMoves = this.featureImportanceHistory.filter(
      log => Math.abs(log.priceMove) > this.bigMoveThreshold
    );
    
    const noise = this.featureImportanceHistory.filter(
      log => Math.abs(log.priceMove) < this.noiseThreshold
    );
    
    // Aggregate feature importance for big moves
    const bigMoveFeatures = new Map<string, { total: number; count: number }>();
    bigMoves.forEach(log => {
      log.features.forEach((importance, feature) => {
        const current = bigMoveFeatures.get(feature) || { total: 0, count: 0 };
        bigMoveFeatures.set(feature, {
          total: current.total + importance,
          count: current.count + 1
        });
      });
    });
    
    // Calculate average importance for big moves
    const avgBigMoveImportance = new Map<string, number>();
    bigMoveFeatures.forEach((value, key) => {
      avgBigMoveImportance.set(key, value.total / value.count);
    });
    
    // Sort by average importance
    const topBigMoveFeatures = Array.from(avgBigMoveImportance.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);
    
    return {
      bigMoves: `
Total Big Moves: ${bigMoves.length}
Percentage of Total: ${(bigMoves.length / this.featureImportanceHistory.length * 100).toFixed(2)}%

Top Features for Big Moves:
${topBigMoveFeatures.map(([feature, importance], i) => 
  `${i + 1}. ${feature}: ${(importance * 100).toFixed(2)}% average importance`
).join('\n')}
`,
      noiseAnalysis: `
Noise Events: ${noise.length}
Percentage of Total: ${(noise.length / this.featureImportanceHistory.length * 100).toFixed(2)}%
Successfully Filtered: ${noise.filter(n => n.confidence < 0.5).length}
`,
      featureConsistency: this.analyzeFeatureConsistency(topBigMoveFeatures),
      regimePatterns: this.analyzeRegimePatterns(),
      recommendations: this.generateRecommendations(topBigMoveFeatures)
    };
  }
  
  // Analyze feature consistency
  private analyzeFeatureConsistency(topFeatures: Array<[string, number]>): string {
    const consistency: string[] = [];
    
    topFeatures.forEach(([feature, avgImportance]) => {
      // Calculate variance in importance
      const values = this.featureImportanceHistory
        .map(log => log.features.get(feature) || 0);
      
      const variance = this.calculateVariance(values);
      const consistency_score = 1 / (1 + variance);
      
      consistency.push(
        `${feature}: Consistency ${(consistency_score * 100).toFixed(1)}% (Variance: ${variance.toFixed(4)})`
      );
    });
    
    return consistency.join('\n');
  }
  
  // Analyze patterns by market regime
  private analyzeRegimePatterns(): string {
    const regimeGroups = new Map<string, FeatureImportanceLog[]>();
    
    this.featureImportanceHistory.forEach(log => {
      const group = regimeGroups.get(log.marketRegime) || [];
      group.push(log);
      regimeGroups.set(log.marketRegime, group);
    });
    
    const patterns: string[] = [];
    regimeGroups.forEach((logs, regime) => {
      const avgPriceMove = logs.reduce((sum, log) => sum + Math.abs(log.priceMove), 0) / logs.length;
      const bigMoveRatio = logs.filter(log => Math.abs(log.priceMove) > this.bigMoveThreshold).length / logs.length;
      
      patterns.push(
        `${regime}: Avg Move ${(avgPriceMove * 100).toFixed(3)}% | Big Move Ratio ${(bigMoveRatio * 100).toFixed(1)}%`
      );
    });
    
    return patterns.join('\n');
  }
  
  // Generate recommendations based on analysis
  private generateRecommendations(topFeatures: Array<[string, number]>): string {
    const recommendations: string[] = [];
    
    // Check if certain features dominate
    if (topFeatures[0][1] > 0.5) {
      recommendations.push(
        `⚠️ Feature "${topFeatures[0][0]}" shows very high importance (${(topFeatures[0][1] * 100).toFixed(1)}%). Consider:
   - Validating this feature's calculation
   - Ensuring it's not overfitting
   - Adding regularization if needed`
      );
    }
    
    // Check for low-importance features
    const lowImportanceFeatures = topFeatures.filter(([_, imp]) => imp < 0.1);
    if (lowImportanceFeatures.length > 0) {
      recommendations.push(
        `💡 Consider removing low-importance features: ${lowImportanceFeatures.map(f => f[0]).join(', ')}`
      );
    }
    
    // Check noise ratio
    const noiseRatio = this.featureImportanceHistory.filter(
      log => Math.abs(log.priceMove) < this.noiseThreshold
    ).length / this.featureImportanceHistory.length;
    
    if (noiseRatio > 0.5) {
      recommendations.push(
        `📊 High noise ratio detected (${(noiseRatio * 100).toFixed(1)}%). Consider:
   - Increasing position thresholds
   - Adding more aggressive filtering
   - Focusing on larger timeframes`
      );
    }
    
    return recommendations.join('\n\n');
  }
  
  // Log model predictions vs actual
  public logPrediction(
    prediction: any,
    actual: any,
    features: any,
    confidence: number
  ): void {
    const entry = `
[PREDICTION] ${new Date().toISOString()}
Predicted: ${JSON.stringify(prediction)}
Actual: ${JSON.stringify(actual)}
Confidence: ${(confidence * 100).toFixed(2)}%
Error: ${JSON.stringify(this.calculatePredictionError(prediction, actual))}
Features: ${JSON.stringify(features, null, 2)}
`;
    
    this.logBuffer.push(entry);
  }
  
  // Log performance metrics
  public logPerformance(metrics: {
    winRate: number;
    sharpeRatio: number;
    maxDrawdown: number;
    totalReturn: number;
    trades: number;
  }): void {
    const entry = `
################################################################################
PERFORMANCE UPDATE - ${new Date().toISOString()}
################################################################################
Win Rate: ${(metrics.winRate * 100).toFixed(2)}%
Sharpe Ratio: ${metrics.sharpeRatio.toFixed(3)}
Max Drawdown: ${(metrics.maxDrawdown * 100).toFixed(2)}%
Total Return: ${(metrics.totalReturn * 100).toFixed(2)}%
Total Trades: ${metrics.trades}
################################################################################
`;
    
    fs.appendFileSync(this.performanceLogPath, entry);
  }
  
  // Helper methods
  private formatData(data: any): string {
    if (typeof data === 'object') {
      return JSON.stringify(data, null, 2)
        .split('\n')
        .map(line => '  ' + line)
        .join('\n');
    }
    return '  ' + String(data);
  }
  
  private calculateStdDev(values: number[]): number {
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / values.length;
    return Math.sqrt(variance);
  }
  
  private calculateVariance(values: number[]): number {
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    return values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / values.length;
  }
  
  private calculatePredictionError(prediction: any, actual: any): any {
    if (typeof prediction === 'number' && typeof actual === 'number') {
      return {
        absolute: Math.abs(prediction - actual),
        relative: Math.abs((prediction - actual) / actual),
        direction: Math.sign(prediction) === Math.sign(actual)
      };
    }
    return { raw: `${prediction} vs ${actual}` };
  }
  
  // Flush logs to file
  private flushLogs(): void {
    if (this.logBuffer.length === 0) return;
    
    const content = this.logBuffer.join('\n');
    fs.appendFileSync(this.logFilePath, content);
    this.logBuffer = [];
  }
  
  // Generate summary report
  public generateSummaryReport(): string {
    const report = `
================================================================================
SESSION SUMMARY REPORT
================================================================================
Session: ${this.currentSession}
Generated: ${new Date().toISOString()}

FEATURE IMPORTANCE SUMMARY:
${this.generateFeatureImportanceSummary()}

BIG MOVES CAPTURED:
${this.generateBigMovesSummary()}

NOISE FILTERING EFFECTIVENESS:
${this.generateNoiseFilteringSummary()}

MODEL PERFORMANCE:
${this.generatePerformanceSummary()}

RECOMMENDATIONS:
${this.generateFinalRecommendations()}

================================================================================
END OF REPORT
================================================================================
`;
    
    const reportPath = path.join(path.dirname(this.logFilePath), 'summary_report.txt');
    fs.writeFileSync(reportPath, report);
    
    return report;
  }
  
  private generateFeatureImportanceSummary(): string {
    if (this.featureImportanceHistory.length === 0) {
      return 'No feature importance data collected yet.';
    }
    
    // Aggregate all features
    const featureStats = new Map<string, { sum: number; count: number; maxImpact: number }>();
    
    this.featureImportanceHistory.forEach(log => {
      log.features.forEach((importance, feature) => {
        const current = featureStats.get(feature) || { sum: 0, count: 0, maxImpact: 0 };
        featureStats.set(feature, {
          sum: current.sum + importance,
          count: current.count + 1,
          maxImpact: Math.max(current.maxImpact, importance * Math.abs(log.priceMove))
        });
      });
    });
    
    // Calculate averages and sort
    const featureSummary = Array.from(featureStats.entries())
      .map(([feature, stats]) => ({
        feature,
        avgImportance: stats.sum / stats.count,
        maxImpact: stats.maxImpact,
        frequency: stats.count / this.featureImportanceHistory.length
      }))
      .sort((a, b) => b.avgImportance - a.avgImportance);
    
    return featureSummary.slice(0, 10)
      .map((f, i) => 
        `${i + 1}. ${f.feature}:\n` +
        `   Avg Importance: ${(f.avgImportance * 100).toFixed(2)}%\n` +
        `   Max Impact: ${(f.maxImpact * 100).toFixed(3)}%\n` +
        `   Frequency: ${(f.frequency * 100).toFixed(1)}%`
      ).join('\n\n');
  }
  
  private generateBigMovesSummary(): string {
    const bigMoves = this.featureImportanceHistory.filter(
      log => Math.abs(log.priceMove) > this.bigMoveThreshold
    );
    
    if (bigMoves.length === 0) {
      return 'No big moves detected in this session.';
    }
    
    const upMoves = bigMoves.filter(m => m.priceMove > 0);
    const downMoves = bigMoves.filter(m => m.priceMove < 0);
    
    return `
Total Big Moves: ${bigMoves.length}
Upward Moves: ${upMoves.length} (${(upMoves.length / bigMoves.length * 100).toFixed(1)}%)
Downward Moves: ${downMoves.length} (${(downMoves.length / bigMoves.length * 100).toFixed(1)}%)
Average Magnitude: ${(bigMoves.reduce((sum, m) => sum + Math.abs(m.priceMove), 0) / bigMoves.length * 100).toFixed(3)}%
Largest Move: ${(Math.max(...bigMoves.map(m => Math.abs(m.priceMove))) * 100).toFixed(3)}%
`;
  }
  
  private generateNoiseFilteringSummary(): string {
    const totalEvents = this.featureImportanceHistory.length;
    const noiseEvents = this.featureImportanceHistory.filter(
      log => Math.abs(log.priceMove) < this.noiseThreshold
    );
    
    return `
Total Events: ${totalEvents}
Noise Events: ${noiseEvents.length} (${(noiseEvents.length / totalEvents * 100).toFixed(1)}%)
Signal Events: ${totalEvents - noiseEvents.length} (${((totalEvents - noiseEvents.length) / totalEvents * 100).toFixed(1)}%)
Noise Successfully Filtered: ${noiseEvents.filter(n => n.confidence < 0.3).length}
Signal-to-Noise Ratio: ${((totalEvents - noiseEvents.length) / noiseEvents.length).toFixed(2)}:1
`;
  }
  
  private generatePerformanceSummary(): string {
    // Collect stats from history
    const accuracy = this.featureImportanceHistory.length > 0 
      ? this.featureImportanceHistory.filter(h => h.confidence > 0.5).length / this.featureImportanceHistory.length 
      : 0;
    
    return `
Model Accuracy (Confidence > 50%): ${(accuracy * 100).toFixed(2)}%
Total Prediction Samples: ${this.featureImportanceHistory.length}
Big Moves Captured: ${this.featureImportanceHistory.filter(h => Math.abs(h.priceMove) > this.bigMoveThreshold).length}
`;
  }
  
  private generateFinalRecommendations(): string {
    const recommendations: string[] = [];
    
    // Analyze feature effectiveness
    const topFeatures = this.getTopFeaturesForBigMoves();
    if (topFeatures.length > 0) {
      recommendations.push(
        `1. Focus on these features for big moves: ${topFeatures.slice(0, 5).join(', ')}`
      );
    }
    
    // Check noise levels
    const noiseRatio = this.featureImportanceHistory.filter(
      log => Math.abs(log.priceMove) < this.noiseThreshold
    ).length / this.featureImportanceHistory.length;
    
    if (noiseRatio > 0.6) {
      recommendations.push(
        `2. High noise detected (${(noiseRatio * 100).toFixed(1)}%). Consider:\n` +
        `   - Increasing minimum position size\n` +
        `   - Using longer timeframes\n` +
        `   - Implementing additional filters`
      );
    }
    
    // Feature reduction
    const lowValueFeatures = this.getLowValueFeatures();
    if (lowValueFeatures.length > 0) {
      recommendations.push(
        `3. Consider removing these low-value features: ${lowValueFeatures.join(', ')}`
      );
    }
    
    return recommendations.join('\n\n');
  }
  
  private getTopFeaturesForBigMoves(): string[] {
    const bigMoves = this.featureImportanceHistory.filter(
      log => Math.abs(log.priceMove) > this.bigMoveThreshold
    );
    
    const featureScores = new Map<string, number>();
    bigMoves.forEach(log => {
      log.features.forEach((importance, feature) => {
        featureScores.set(feature, (featureScores.get(feature) || 0) + importance);
      });
    });
    
    return Array.from(featureScores.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([feature]) => feature);
  }
  
  private getLowValueFeatures(): string[] {
    const featureScores = new Map<string, number>();
    
    this.featureImportanceHistory.forEach(log => {
      log.features.forEach((importance, feature) => {
        featureScores.set(feature, (featureScores.get(feature) || 0) + importance);
      });
    });
    
    const avgScores = Array.from(featureScores.entries())
      .map(([feature, total]) => ({
        feature,
        avg: total / this.featureImportanceHistory.length
      }))
      .sort((a, b) => a.avg - b.avg);
    
    return avgScores
      .filter(s => s.avg < 0.05)
      .map(s => s.feature);
  }
  
  // Clean up and close
  public close(): void {
    this.flushLogs();
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
    }
    
    // Generate final summary
    this.generateSummaryReport();
    
    if (this.writeStream) {
      this.writeStream.end();
    }
    
    console.log(`Logs saved to: ${path.dirname(this.logFilePath)}`);
  }
}