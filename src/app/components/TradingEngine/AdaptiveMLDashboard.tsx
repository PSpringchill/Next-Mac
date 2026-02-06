import React, { useEffect, useState, useRef, useContext, useMemo } from 'react';
import { useMLEngine } from '../../api/MLContext';
import { OrderBookContext } from '../../api/Page';
import { 
  Box, 
  Typography, 
  Grid, 
  Chip
} from '@mui/material';

const AdaptiveMLDashboard: React.FC = () => {
  const { prediction, mlPrediction, regime, learner, enginePerformance } = useMLEngine();
  const orderBookContext = useContext(OrderBookContext);
  const [learningMetrics, setLearningMetrics] = useState({
    accuracy: 0,
    adaptationSpeed: 0,
    confidence: 0
  });
  const [predictionHistory, setPredictionHistory] = useState<number[]>([]);
  const priceHistory = useRef<number[]>([]);
  
  useEffect(() => {
    const currentPrice = orderBookContext?.orderBookData?.asks?.[0]?.[0] 
      ? parseFloat(orderBookContext.orderBookData.asks[0][0])
      : 0;
    
    if (currentPrice === 0) return;
    
    priceHistory.current.push(currentPrice);
    if (priceHistory.current.length > 100) {
      priceHistory.current.shift();
    }

    if (!prediction) return;

    setPredictionHistory(prev => {
      const updated = [...prev, prediction.expectedPriceMove];
      return updated.slice(-50);
    });
    
    const isAdapting = enginePerformance.throughput > 1.0;
    const metrics = typeof learner?.getMetrics === 'function' ? learner.getMetrics() : { accuracy: 0 };

    setLearningMetrics(prev => ({
      ...prev,
      accuracy: metrics?.accuracy ?? 0,
      confidence: prediction?.confidence ?? 0,
      adaptationSpeed: isAdapting ? 0.05 : -0.01
    }));
  }, [prediction, orderBookContext?.orderBookData, enginePerformance.throughput, learner]);

  // SVG sparkline path from prediction history
  const sparklinePath = useMemo(() => {
    if (predictionHistory.length < 2) return '';
    const w = 200, h = 22;
    const min = Math.min(...predictionHistory);
    const max = Math.max(...predictionHistory);
    const range = max - min || 1;
    const points = predictionHistory.map((v, i) => {
      const x = (i / (predictionHistory.length - 1)) * w;
      const y = h - ((v - min) / range) * h;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });
    return `M${points.join(' L')}`;
  }, [predictionHistory]);

  const sparklineAreaPath = useMemo(() => {
    if (predictionHistory.length < 2) return '';
    const w = 200, h = 22;
    const min = Math.min(...predictionHistory);
    const max = Math.max(...predictionHistory);
    const range = max - min || 1;
    const points = predictionHistory.map((v, i) => {
      const x = (i / (predictionHistory.length - 1)) * w;
      const y = h - ((v - min) / range) * h;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });
    return `M0,${h} L${points.join(' L')} L${w},${h} Z`;
  }, [predictionHistory]);

  return (
    <Box sx={{ p: 0.5, height: '100%', bgcolor: 'transparent', display: 'flex', alignItems: 'center' }}>
      <Grid container spacing={1} alignItems="center" wrap="nowrap">
        {/* Engine Status */}
        <Grid item sx={{ minWidth: '150px' }}>
          <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.4)', fontWeight: 800, letterSpacing: '0.02rem', display: 'block', mb: 0, fontSize: '0.6rem' }}>
            ML ENGINE
          </Typography>
          <Box sx={{ display: 'flex', gap: 0.5, mt: 0.25 }}>
            <Chip 
              label={`ACC: ${(learningMetrics.accuracy * 100).toFixed(2)}%`}
              size="small"
              sx={{ height: 16, fontSize: '0.6rem', bgcolor: 'rgba(0, 255, 136, 0.1)', color: '#00ff88', fontWeight: 800, borderRadius: '3px', px: 0.25 }}
            />
            <Chip 
              label={`RG: ${regime?.name.toUpperCase() || 'STABLE'}`}
              size="small"
              sx={{ height: 16, fontSize: '0.6rem', bgcolor: 'rgba(0, 170, 255, 0.1)', color: '#00aaff', fontWeight: 800, borderRadius: '3px', px: 0.25 }}
            />
          </Box>
        </Grid>

        {/* Core Metrics */}
        <Grid item sx={{ display: 'flex', gap: 1.5, borderLeft: '1px solid rgba(255,255,255,0.1)', pl: 1 }}>
          <Box>
            <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.35)', display: 'block', fontSize: '0.6rem', fontWeight: 700 }}>VOL</Typography>
            <Typography variant="body2" sx={{ color: '#fff', fontWeight: 800, fontSize: '0.75rem', fontFamily: 'monospace' }}>
              {((regime?.volatility ?? 0) * 100).toFixed(2)}%
            </Typography>
          </Box>
          <Box>
            <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.35)', display: 'block', fontSize: '0.6rem', fontWeight: 700 }}>MOM</Typography>
            <Typography variant="body2" sx={{ color: (regime?.momentum ?? 0) > 0 ? '#00ff88' : (regime?.momentum ?? 0) < 0 ? '#ff4444' : '#fff', fontWeight: 800, fontSize: '0.75rem', fontFamily: 'monospace' }}>
              {(regime?.momentum ?? 0) > 0 ? '↑' : (regime?.momentum ?? 0) < 0 ? '↓' : ''}{(regime?.momentum ?? 0).toFixed(2)}
            </Typography>
          </Box>
          <Box>
            <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.35)', display: 'block', fontSize: '0.6rem', fontWeight: 700 }}>CONF</Typography>
            <Typography variant="body2" sx={{ color: learningMetrics.confidence > 0.6 ? '#00ff88' : '#ffaa00', fontWeight: 800, fontSize: '0.75rem', fontFamily: 'monospace' }}>
              {(learningMetrics.confidence * 100).toFixed(1)}%
            </Typography>
          </Box>
        </Grid>

        {/* SVG Sparkline (replaces @mui/x-charts) */}
        <Grid item sx={{ flex: 1, height: 28, borderLeft: '1px solid rgba(255,255,255,0.1)', pl: 1 }}>
          {predictionHistory.length > 1 && (
            <svg width="100%" height="100%" viewBox="0 0 200 22" preserveAspectRatio="none">
              <path d={sparklineAreaPath} fill="rgba(0,255,136,0.1)" />
              <path d={sparklinePath} fill="none" stroke="#00ff88" strokeWidth="1.5" />
            </svg>
          )}
        </Grid>
      </Grid>
    </Box>
  );
};

export default AdaptiveMLDashboard;
