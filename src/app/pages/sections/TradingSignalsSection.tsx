import React, { useMemo } from 'react';
import { Box, Typography, List, ListItem, ListItemText, Chip } from '@mui/material';
import { DashboardCard } from './DashboardCard';
import { useMLEngine } from '../../api/MLContext';

const TradingSignalsSection: React.FC = () => {
  const { mlPrediction, regime } = useMLEngine();

  const signals = useMemo(() => {
    if (!mlPrediction || !regime) return [];

    type HorizonKey = 'horizon1ms' | 'horizon10ms' | 'horizon100ms';
    const horizons: { key: HorizonKey; label: string }[] = [
      { key: 'horizon1ms', label: '1ms Horizon' },
      { key: 'horizon10ms', label: '10ms Horizon' },
      { key: 'horizon100ms', label: '100ms Horizon' }
    ];

    return horizons.map(h => {
      const pred = mlPrediction[h.key];
      const direction = pred?.direction || 'hold';
      const confidence = pred?.confidence || 0;
      
      let strength = 'Weak';
      if (confidence > 0.8) strength = 'Strong';
      else if (confidence > 0.6) strength = 'Moderate';

      return {
        pair: h.label,
        type: direction.toUpperCase(),
        price: regime.name.replace('_', ' '),
        strength,
        time: 'LIVE',
        confidence
      };
    });
  }, [mlPrediction, regime]);

  return (
    <Box>
      <DashboardCard title="Real-time ML Signals" height="400px" gradient>
        <List>
          {signals.length === 0 ? (
            <Box sx={{ p: 4, textAlign: 'center' }}>
              <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.3)' }}>
                Analyzing market patterns for signals...
              </Typography>
            </Box>
          ) : (
            signals.map((signal, index) => (
              <ListItem 
                key={index}
                sx={{ 
                  borderBottom: '1px solid rgba(255, 255, 255, 0.04)',
                  py: 2.5,
                  px: 3,
                  transition: 'all 0.2s',
                  '&:hover': {
                    bgcolor: 'rgba(255, 255, 255, 0.02)',
                  }
                }}
              >
                <ListItemText 
                  primary={
                    <Box display="flex" justifyContent="space-between" alignItems="center">
                      <Typography variant="subtitle1" sx={{ color: '#fff', fontWeight: 700 }}>
                        {signal.pair}
                      </Typography>
                      <Chip 
                        label={signal.type} 
                        size="small" 
                        sx={{ 
                          fontWeight: 800,
                          fontSize: '0.65rem',
                          bgcolor: signal.type === 'BUY' ? 'rgba(0, 255, 136, 0.1)' : signal.type === 'SELL' ? 'rgba(255, 68, 68, 0.1)' : 'rgba(255, 255, 255, 0.05)',
                          color: signal.type === 'BUY' ? '#00ff88' : signal.type === 'SELL' ? '#ff4444' : 'rgba(255, 255, 255, 0.5)',
                          border: `1px solid ${signal.type === 'BUY' ? 'rgba(0, 255, 136, 0.2)' : signal.type === 'SELL' ? 'rgba(255, 68, 68, 0.2)' : 'rgba(255, 255, 255, 0.1)'}`,
                          borderRadius: '6px',
                          height: 20
                        }} 
                      />
                    </Box>
                  }
                  secondary={
                    <Box display="flex" justifyContent="space-between" alignItems="center" mt={1}>
                      <Box display="flex" alignItems="center" gap={2}>
                        <Typography variant="caption" sx={{ color: 'rgba(255, 255, 255, 0.4)', fontWeight: 500 }}>
                          REGIME: <span style={{ color: '#fff', textTransform: 'capitalize' }}>{signal.price}</span>
                        </Typography>
                        <Typography variant="caption" sx={{ 
                          color: signal.strength === 'Strong' ? '#00ff88' : signal.strength === 'Moderate' ? '#ffaa00' : '#ff4444',
                          fontWeight: 600,
                          textTransform: 'uppercase',
                          fontSize: '0.6rem'
                        }}>
                          {signal.strength} ({(signal.confidence * 100).toFixed(0)}%)
                        </Typography>
                      </Box>
                      <Typography variant="caption" sx={{ color: 'rgba(255, 255, 255, 0.3)', fontFamily: 'monospace' }}>
                        {signal.time}
                      </Typography>
                    </Box>
                  }
                />
              </ListItem>
            ))
          )}
        </List>
      </DashboardCard>
    </Box>
  );
};

export default TradingSignalsSection;
