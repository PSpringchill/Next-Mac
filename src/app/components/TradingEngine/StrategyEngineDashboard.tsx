'use client';

import React from 'react';
import { Box, Typography } from '@mui/material';
import { useRiskManager } from '../../api/RiskContext';
import { useMLEngine } from '../../api/MLContext';

const StrategyEngineDashboard: React.FC = () => {
  const { portfolioState } = useRiskManager();
  const { regime, mlPrediction, learner, history } = useMLEngine();

  const regimeScore = regime ? Math.min(1, Math.max(0, (regime.momentum + 1) / 2)) : 0;
  const signalConfidence = mlPrediction?.horizon1ms?.confidence ?? 0;
  const metrics = learner.getMetrics();

  const MetricRow = ({ label, value, color }: { label: string; value: string; color?: string }) => (
    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <Typography sx={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.72rem' }}>{label}</Typography>
      <Typography sx={{ color: color || '#fff', fontSize: '0.72rem', fontWeight: 600, fontFamily: 'monospace' }}>{value}</Typography>
    </Box>
  );

  return (
    <Box sx={{
      display: 'grid',
      gridTemplateColumns: { xs: '1fr', md: '1fr 1fr 1fr' },
      gap: 1.5,
      fontFamily: 'IBM Plex Mono, monospace',
      color: '#d8dde5'
    }}>
      {/* Strategy Engine */}
      <Box sx={{ border: '1px solid rgba(255,255,255,0.08)', borderRadius: 1.5, p: 1.5, bgcolor: 'rgba(10,12,18,0.85)' }}>
        <Typography sx={{ fontSize: '0.65rem', letterSpacing: '0.15em', color: 'rgba(255,255,255,0.4)', mb: 1 }}>
          STRATEGY ENGINE
        </Typography>
        <Box sx={{ display: 'grid', gap: 0.8 }}>
          <MetricRow label="Position" value={portfolioState.position.toFixed(3)} color="#00ff88" />
          <MetricRow label="Risk Budget" value={`${(portfolioState.availableRiskBudget * 100).toFixed(0)}%`} color={portfolioState.availableRiskBudget > 0.5 ? '#00ff88' : '#ffaa00'} />
          <MetricRow label="Signal Conf." value={`${(signalConfidence * 100).toFixed(1)}%`} color={signalConfidence > 0.6 ? '#00ff88' : '#ffaa00'} />
          <MetricRow label="Exec Mode" value={signalConfidence > 0.7 ? 'AGGRESSIVE' : signalConfidence > 0.3 ? 'ADAPTIVE' : 'PASSIVE'} color="#00aaff" />
        </Box>
        <Box sx={{ mt: 1 }}>
          <Typography sx={{ fontSize: '0.6rem', color: 'rgba(255,255,255,0.35)', mb: 0.3 }}>Regime Alignment</Typography>
          <Box sx={{ height: 6, borderRadius: 3, bgcolor: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
            <Box sx={{ height: '100%', width: `${regimeScore * 100}%`, bgcolor: '#00aaff', transition: 'width 0.3s' }} />
          </Box>
        </Box>
      </Box>

      {/* RL Core Training Health */}
      <Box sx={{ border: '1px solid rgba(255,255,255,0.08)', borderRadius: 1.5, p: 1.5, bgcolor: 'rgba(10,12,18,0.85)' }}>
        <Typography sx={{ fontSize: '0.65rem', letterSpacing: '0.15em', color: 'rgba(255,255,255,0.4)', mb: 1 }}>
          RL CORE HEALTH
        </Typography>
        <Box sx={{ display: 'grid', gap: 0.8 }}>
          <MetricRow label="Accuracy" value={`${(metrics.accuracy * 100).toFixed(2)}%`} color={metrics.accuracy > 0.7 ? '#00ff88' : '#ffaa00'} />
          <MetricRow label="Loss" value={metrics.loss.toFixed(6)} color={metrics.loss < 0.01 ? '#00ff88' : '#fff'} />
          <MetricRow label="Grad Norm" value={metrics.gradientNorm.toFixed(4)} color="#00aaff" />
          <MetricRow label="Samples" value={`${metrics.sampleCount}`} color={metrics.sampleCount >= 50 ? '#00ff88' : '#ffaa00'} />
          <MetricRow label="Policy Steps" value={`${history.trainingMetrics.length}`} />
        </Box>
      </Box>

      {/* Regime Transitions + Action Signals */}
      <Box sx={{ border: '1px solid rgba(255,255,255,0.08)', borderRadius: 1.5, p: 1.5, bgcolor: 'rgba(10,12,18,0.85)' }}>
        <Typography sx={{ fontSize: '0.65rem', letterSpacing: '0.15em', color: 'rgba(255,255,255,0.4)', mb: 1 }}>
          REGIME & SIGNALS
        </Typography>
        <Box sx={{ display: 'grid', gap: 0.8, mb: 1 }}>
          <MetricRow label="MDP-1" value="Monitoring" color="#00ff88" />
          <MetricRow label="MDP-2" value={(() => { const dir = mlPrediction?.horizon1ms?.direction ?? 'hold'; return dir === 'buy' ? 'BUY BIAS' : dir === 'sell' ? 'SELL BIAS' : 'HOLD'; })()} color={(() => { const dir = mlPrediction?.horizon1ms?.direction ?? 'hold'; return dir === 'buy' ? '#00ff88' : dir === 'sell' ? '#ff2222' : '#ffaa00'; })()} />
        </Box>
        <Typography sx={{ fontSize: '0.6rem', color: 'rgba(255,255,255,0.35)', mb: 0.5 }}>Recent Transitions</Typography>
        <Box sx={{ display: 'grid', gap: 0.4, maxHeight: 80, overflow: 'auto' }}>
          {history.regimeTransitions.length === 0 ? (
            <Typography sx={{ fontSize: '0.65rem', color: 'rgba(255,255,255,0.3)' }}>No transitions yet</Typography>
          ) : (
            history.regimeTransitions.slice(-3).reverse().map((t, i) => (
              <Box key={i} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <Typography sx={{ color: '#ffaa00', fontSize: '0.65rem' }}>{t[0].replace('_', ' ')}</Typography>
                <Typography sx={{ color: 'rgba(255,255,255,0.2)', fontSize: '0.65rem' }}>&rarr;</Typography>
                <Typography sx={{ color: '#00ff88', fontSize: '0.65rem' }}>{t[1].replace('_', ' ')}</Typography>
              </Box>
            ))
          )}
        </Box>
      </Box>
    </Box>
  );
};

export default StrategyEngineDashboard;
