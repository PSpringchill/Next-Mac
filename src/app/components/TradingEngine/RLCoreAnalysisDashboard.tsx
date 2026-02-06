'use client';

import React from 'react';
import { Box, Typography } from '@mui/material';
import { useMLEngine } from '../../api/MLContext';

const RLCoreAnalysisDashboard: React.FC = () => {
  const { learner, history } = useMLEngine();
  const metrics = learner.getMetrics();

  return (
    <Box sx={{
      display: 'grid',
      gridTemplateColumns: 'repeat(3, 1fr)',
      gap: 2,
      fontFamily: 'IBM Plex Mono, monospace',
      color: '#d8dde5'
    }}>
      <Box sx={{
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 1.5,
        p: 2,
        bgcolor: 'rgba(10,12,18,0.85)'
      }}>
        <Typography sx={{ fontSize: '0.7rem', letterSpacing: '0.2em', color: 'rgba(255,255,255,0.45)' }}>
          TRAINING HEALTH
        </Typography>
        <Box sx={{ mt: 2, display: 'grid', gap: 1 }}>
          <Typography sx={{ fontSize: '0.8rem' }}>Accuracy: {(metrics.accuracy * 100).toFixed(2)}%</Typography>
          <Typography sx={{ fontSize: '0.8rem' }}>Loss: {metrics.loss.toFixed(6)}</Typography>
          <Typography sx={{ fontSize: '0.8rem' }}>Gradient Norm: {metrics.gradientNorm.toFixed(4)}</Typography>
        </Box>
      </Box>

      <Box sx={{
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 1.5,
        p: 2,
        bgcolor: 'rgba(10,12,18,0.85)'
      }}>
        <Typography sx={{ fontSize: '0.7rem', letterSpacing: '0.2em', color: 'rgba(255,255,255,0.45)' }}>
          REGIME TRANSITIONS
        </Typography>
        <Box sx={{ mt: 2, display: 'grid', gap: 0.8 }}>
          {history.regimeTransitions.slice(-4).map((transition, idx) => (
            <Typography key={idx} sx={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.7)' }}>
              {transition[0]} &rarr; {transition[1]}
            </Typography>
          ))}
          {history.regimeTransitions.length === 0 && (
            <Typography sx={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.4)' }}>
              No regime transitions yet
            </Typography>
          )}
        </Box>
      </Box>

      <Box sx={{
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 1.5,
        p: 2,
        bgcolor: 'rgba(10,12,18,0.85)'
      }}>
        <Typography sx={{ fontSize: '0.7rem', letterSpacing: '0.2em', color: 'rgba(255,255,255,0.45)' }}>
          EXPERIENCE BUFFER
        </Typography>
        <Box sx={{ mt: 2, display: 'grid', gap: 1 }}>
          <Typography sx={{ fontSize: '0.8rem' }}>Samples: {metrics.sampleCount}</Typography>
          <Typography sx={{ fontSize: '0.8rem' }}>Policy Steps: {history.trainingMetrics.length}</Typography>
          <Typography sx={{ fontSize: '0.8rem' }}>Bellman Error (proxy): {metrics.gradientNorm.toFixed(4)}</Typography>
        </Box>
      </Box>
    </Box>
  );
};

export default RLCoreAnalysisDashboard;
