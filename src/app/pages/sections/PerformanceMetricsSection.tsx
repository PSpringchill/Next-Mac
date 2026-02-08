import React, { useMemo, useState } from 'react';
import { Box, Grid, Typography, LinearProgress, Button, Chip } from '@mui/material';
import { DashboardCard } from './DashboardCard';
import { useMLEngine } from '../../api/MLContext';
import { useTradingStore } from '@stores/tradingStore';
import ABEvaluator from '../../components/TradingEngine/ABEvaluator';
import StressTestHarness from '../../components/TradingEngine/StressTestHarness';

import LogMonitor from './LogMonitor';

const PerformanceMetricsSection: React.FC = () => {
  const { enginePerformance, learner } = useMLEngine();
  const {
    recordingEnabled,
    recordedData,
    startRecording,
    stopRecording,
    clearRecordedData,
    evaluationResults,
    stressResults,
    setEvaluationResults,
    setStressResults
  } = useTradingStore((state) => state);
  const [isEvaluating, setIsEvaluating] = useState(false);
  
  const metrics = learner.getMetrics();
  const isWarmingUp = metrics.sampleCount < 32;
  
  const stats = [
    { label: 'ML Latency', value: Math.min(100, enginePerformance.latency), displayValue: `${enginePerformance.latency.toFixed(4)}ms` },
    { label: 'Throughput', value: Math.min(100, enginePerformance.throughput * 10), displayValue: `${enginePerformance.throughput.toFixed(1)} op/s` },
    { 
      label: 'Model Accuracy', 
      value: isWarmingUp ? 0 : metrics.accuracy * 100, 
      displayValue: isWarmingUp ? 'WARMING UP' : `${(metrics.accuracy * 100).toFixed(4)}%` 
    },
    { 
      label: 'Training Loss', 
      value: isWarmingUp ? 0 : Math.max(0, 100 - metrics.loss * 100), 
      displayValue: isWarmingUp ? 'WAITING' : metrics.loss.toFixed(6) 
    },
  ];

  const hasRecordedData = recordedData.length > 0;
  const recordedLabel = hasRecordedData ? `${recordedData.length} ticks` : 'No data';

  const handleDownload = () => {
    if (!hasRecordedData) return;
    const blob = new Blob([JSON.stringify(recordedData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `market-data-${Date.now()}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const runEvaluation = async () => {
    setIsEvaluating(true);
    try {
      const evaluator = new ABEvaluator();
      if (recordedData.length === 0) return;
      // Deep-copy to escape immer draft
      const data = JSON.parse(JSON.stringify(recordedData));
      const result = evaluator.run(data);
      setEvaluationResults({
        bestParams: result.bestParams,
        bestMetrics: result.bestMetrics,
        bestDirectional: result.bestDirectional,
        delta: result.delta,
        top5: result.top5,
        totalCombinations: result.gridSearch.totalCombinations,
        elapsed: result.gridSearch.elapsed,
      });
    } finally {
      setIsEvaluating(false);
    }
  };

  const runStress = async () => {
    setIsEvaluating(true);
    try {
      const harness = new StressTestHarness();
      const scenarios = await Promise.all([
        harness.runFlashCrash(),
        harness.runApiFailure(),
        harness.runStaleFeed()
      ]);
      setStressResults(scenarios);
    } finally {
      setIsEvaluating(false);
    }
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <Grid container spacing={3}>
        <Grid item xs={12}>
          <DashboardCard title="Engine Performance" height="400px" gradient>
            <Box sx={{ p: 3 }}>
              {stats.map((stat, index) => (
                <Box key={index} sx={{ mb: 4 }}>
                  <Box display="flex" justifyContent="space-between" mb={1.5}>
                    <Typography variant="body2" sx={{ 
                      color: 'rgba(255, 255, 255, 0.5)', 
                      fontWeight: 600,
                      textTransform: 'uppercase',
                      letterSpacing: '0.05rem',
                      fontSize: '0.7rem'
                    }}>
                      {stat.label}
                    </Typography>
                    <Typography variant="body2" sx={{ 
                      color: '#00ff88', 
                      fontWeight: 800,
                      fontFamily: 'monospace'
                    }}>
                      {stat.displayValue}
                    </Typography>
                  </Box>
                  <LinearProgress 
                    variant="determinate" 
                    value={stat.value} 
                    sx={{ 
                      height: 6, 
                      borderRadius: 3,
                      bgcolor: 'rgba(255, 255, 255, 0.05)',
                      '& .MuiLinearProgress-bar': {
                        borderRadius: 3,
                        background: 'linear-gradient(90deg, #00ff88, #00aaff)',
                        boxShadow: '0 0 10px rgba(0, 255, 136, 0.3)'
                      }
                    }}
                  />
                </Box>
              ))}
            </Box>
          </DashboardCard>
        </Grid>

        <Grid item xs={12} lg={6}>
          <DashboardCard title="Execution & Recording" height="320px">
            <Box sx={{ p: 3, display: 'flex', flexDirection: 'column', gap: 2 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Chip
                  label={recordingEnabled ? 'RECORDING' : 'IDLE'}
                  sx={{
                    bgcolor: recordingEnabled ? 'rgba(0, 255, 136, 0.1)' : 'rgba(255,255,255,0.05)',
                    color: recordingEnabled ? '#00ff88' : 'rgba(255,255,255,0.6)'
                  }}
                  size="small"
                />
                <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.5)' }}>
                  {recordedLabel}
                </Typography>
              </Box>
              <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                <Button variant="contained" onClick={recordingEnabled ? stopRecording : startRecording}>
                  {recordingEnabled ? 'Stop Recording' : 'Start Recording'}
                </Button>
                <Button variant="outlined" onClick={clearRecordedData} disabled={!hasRecordedData}>
                  Clear
                </Button>
                <Button variant="outlined" onClick={handleDownload} disabled={!hasRecordedData}>
                  Download JSON
                </Button>
              </Box>
              <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.4)' }}>
                Recording captures live market data for A/B evaluation runs.
              </Typography>
            </Box>
          </DashboardCard>
        </Grid>

        <Grid item xs={12} lg={6}>
          <DashboardCard title="Grid Search — TP/SL Optimizer" height="auto">
            <Box sx={{ p: 3, display: 'flex', flexDirection: 'column', gap: 2 }}>
              <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
                <Button variant="contained" onClick={runEvaluation} disabled={isEvaluating || recordedData.length === 0}>
                  {isEvaluating ? 'Searching...' : 'Run Grid Search'}
                </Button>
                <Button variant="outlined" onClick={runStress} disabled={isEvaluating}>
                  Stress Tests
                </Button>
                {evaluationResults && (
                  <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.35)', ml: 1 }}>
                    {evaluationResults.totalCombinations} combos in {evaluationResults.elapsed.toFixed(0)}ms
                  </Typography>
                )}
              </Box>

              {evaluationResults && (
                <>
                  {/* Best Parameters */}
                  <Box sx={{ bgcolor: 'rgba(0,255,136,0.06)', borderRadius: 1, p: 1.5, border: '1px solid rgba(0,255,136,0.15)' }}>
                    <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.5)', letterSpacing: '0.08em', fontWeight: 700 }}>
                      BEST PARAMETERS
                    </Typography>
                    <Box sx={{ display: 'flex', gap: 2, mt: 0.5 }}>
                      <Box>
                        <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.4)' }}>TP</Typography>
                        <Typography sx={{ color: '#00ff88', fontWeight: 800, fontSize: '1.1rem' }}>
                          {evaluationResults.bestParams.tpPct.toFixed(2)}%
                        </Typography>
                      </Box>
                      <Box>
                        <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.4)' }}>SL</Typography>
                        <Typography sx={{ color: '#ff4444', fontWeight: 800, fontSize: '1.1rem' }}>
                          {evaluationResults.bestParams.slPct.toFixed(2)}%
                        </Typography>
                      </Box>
                      <Box>
                        <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.4)' }}>Entry OBI</Typography>
                        <Typography sx={{ color: '#00aaff', fontWeight: 800, fontSize: '1.1rem' }}>
                          ≥{evaluationResults.bestParams.entryObi}%
                        </Typography>
                      </Box>
                      <Box>
                        <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.4)' }}>Score</Typography>
                        <Typography sx={{ color: '#ffaa00', fontWeight: 800, fontSize: '1.1rem' }}>
                          {evaluationResults.bestParams.score.toFixed(1)}
                        </Typography>
                      </Box>
                    </Box>
                  </Box>

                  {/* Best Metrics */}
                  <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 1 }}>
                    <Box>
                      <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.4)' }}>Return</Typography>
                      <Typography sx={{ color: evaluationResults.bestMetrics.totalReturn >= 0 ? '#00ff88' : '#ff4444', fontWeight: 700 }}>
                        {(evaluationResults.bestMetrics.totalReturn * 100).toFixed(3)}%
                      </Typography>
                    </Box>
                    <Box>
                      <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.4)' }}>Sharpe</Typography>
                      <Typography sx={{ color: '#00aaff', fontWeight: 700 }}>
                        {evaluationResults.bestMetrics.sharpeRatio.toFixed(2)}
                      </Typography>
                    </Box>
                    <Box>
                      <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.4)' }}>Drawdown</Typography>
                      <Typography sx={{ color: '#ffaa00', fontWeight: 700 }}>
                        {(evaluationResults.bestMetrics.maxDrawdown * 100).toFixed(3)}%
                      </Typography>
                    </Box>
                    <Box>
                      <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.4)' }}>Win Rate</Typography>
                      <Typography sx={{ color: '#ffffff', fontWeight: 700 }}>
                        {(evaluationResults.bestMetrics.winRate * 100).toFixed(1)}%
                      </Typography>
                    </Box>
                  </Box>

                  {/* Directional Breakdown */}
                  <Box sx={{ display: 'flex', gap: 2, bgcolor: 'rgba(255,255,255,0.02)', borderRadius: 1, p: 1.2 }}>
                    <Box sx={{ flex: 1 }}>
                      <Typography variant="caption" sx={{ color: '#00ff88', fontWeight: 700, letterSpacing: '0.06em' }}>
                        BUY
                      </Typography>
                      <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.5)', display: 'block' }}>
                        {evaluationResults.bestDirectional.buyWins}/{evaluationResults.bestDirectional.buyTrades} wins
                      </Typography>
                      <Typography sx={{ color: '#00ff88', fontWeight: 800, fontSize: '1rem' }}>
                        {(evaluationResults.bestDirectional.buyWinRate * 100).toFixed(0)}%
                      </Typography>
                    </Box>
                    <Box sx={{ flex: 1 }}>
                      <Typography variant="caption" sx={{ color: '#ff4444', fontWeight: 700, letterSpacing: '0.06em' }}>
                        SELL
                      </Typography>
                      <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.5)', display: 'block' }}>
                        {evaluationResults.bestDirectional.sellWins}/{evaluationResults.bestDirectional.sellTrades} wins
                      </Typography>
                      <Typography sx={{ color: '#ff4444', fontWeight: 800, fontSize: '1rem' }}>
                        {(evaluationResults.bestDirectional.sellWinRate * 100).toFixed(0)}%
                      </Typography>
                    </Box>
                  </Box>

                  {/* Top 5 */}
                  <Box>
                    <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.35)', letterSpacing: '0.08em' }}>
                      TOP 5 PARAMETER SETS
                    </Typography>
                    {evaluationResults.top5.map((r, i) => (
                      <Box key={i} sx={{
                        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                        py: 0.3, borderBottom: '1px solid rgba(255,255,255,0.04)',
                        opacity: i === 0 ? 1 : 0.7,
                      }}>
                        <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.5)', fontFamily: 'monospace', minWidth: 20 }}>
                          #{i + 1}
                        </Typography>
                        <Typography variant="caption" sx={{ color: '#00ff88', fontFamily: 'monospace' }}>
                          TP {r.params.tpPct.toFixed(2)}%
                        </Typography>
                        <Typography variant="caption" sx={{ color: '#ff4444', fontFamily: 'monospace' }}>
                          SL {r.params.slPct.toFixed(2)}%
                        </Typography>
                        <Typography variant="caption" sx={{ color: '#00aaff', fontFamily: 'monospace' }}>
                          OBI≥{r.params.entryObi}
                        </Typography>
                        <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.6)', fontFamily: 'monospace' }}>
                          {(r.metrics.totalReturn * 100).toFixed(3)}%
                        </Typography>
                        <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.4)', fontFamily: 'monospace' }}>
                          WR {(r.metrics.winRate * 100).toFixed(0)}%
                        </Typography>
                      </Box>
                    ))}
                  </Box>
                </>
              )}

              {!evaluationResults && (
                <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.3)' }}>
                  Record market data, then run grid search to find optimal TP/SL entry parameters.
                </Typography>
              )}

              <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.3)' }}>
                Stress scenarios: {stressResults ? stressResults.length : 0}
              </Typography>
            </Box>
          </DashboardCard>
        </Grid>
      </Grid>

      <Box sx={{ mt: 2 }}>
        <LogMonitor />
      </Box>
    </Box>
  );
};

export default PerformanceMetricsSection;
