// src/components/Dashboard/MetricsGrid.tsx
import React, { useContext } from 'react';
import { Grid, Box, Typography } from '@mui/material';
import { styled } from '@mui/material/styles';
import {
  TrendingUp,
  TrendingDown,
  AttachMoney,
  Speed,
  ShowChart,
  Assessment
} from '@mui/icons-material';
import { useMLEngine } from '../../api/MLContext';
import { OrderBookContext } from '../../api/Page';

interface MetricCardProps {
  title: string;
  value: string | number;
  change?: number;
  icon: React.ReactNode;
  color: string;
  vertical?: boolean;
}

const MetricCard = styled(Box, {
  shouldForwardProp: (prop) => prop !== 'vertical',
})<{ vertical?: boolean }>(({ theme, vertical }) => ({
  background: 'rgba(15, 17, 20, 0.6)',
  backdropFilter: 'blur(20px)',
  borderRadius: 12,
  padding: theme.spacing(vertical ? 1.5 : 1.5),
  border: '1px solid rgba(255, 255, 255, 0.08)',
  transition: 'all 0.4s cubic-bezier(0.4, 0, 0.2, 1)',
  cursor: 'pointer',
  position: 'relative',
  overflow: 'hidden',
  height: '100%',
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'center',
  marginBottom: vertical ? theme.spacing(1) : 0,
  '&:hover': {
    transform: vertical ? 'translateX(4px)' : 'translateY(-6px)',
    background: 'rgba(20, 22, 26, 0.8)',
    borderColor: 'rgba(0, 255, 136, 0.3)',
    boxShadow: '0 20px 40px rgba(0, 0, 0, 0.4)',
    '& .metric-icon-bg': {
      transform: 'scale(1.1) rotate(-5deg)',
    }
  },
  '&::after': {
    content: '""',
    position: 'absolute',
    top: 0,
    left: 0,
    width: '100%',
    height: '100%',
    background: 'linear-gradient(135deg, rgba(255,255,255,0.05) 0%, transparent 100%)',
    pointerEvents: 'none'
  }
}));

const MetricItem: React.FC<MetricCardProps> = ({ title, value, change, icon, color, vertical }) => (
  <MetricCard vertical={vertical}>
    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
      <Box sx={{ flex: 1 }}>
        <Typography variant="caption" sx={{ 
          color: 'rgba(255, 255, 255, 0.4)', 
          fontWeight: 600, 
          textTransform: 'uppercase',
          letterSpacing: '0.05rem',
          fontSize: vertical ? '0.55rem' : '0.65rem'
        }}>
          {title}
        </Typography>
        <Typography variant="h4" sx={{ 
          color: '#fff', 
          fontWeight: 800, 
          mt: 0.25,
          fontFamily: "'Inter', sans-serif",
          fontSize: vertical ? '1rem' : '1.25rem'
        }}>
          {value}
        </Typography>
        {change !== undefined && (
          <Box sx={{ display: 'flex', alignItems: 'center', mt: 0.5 }}>
            <Box sx={{ 
              display: 'flex', 
              alignItems: 'center', 
              bgcolor: change > 0 ? 'rgba(0, 255, 136, 0.1)' : 'rgba(255, 68, 68, 0.1)',
              px: 0.5,
              py: 0.1,
              borderRadius: 0.5,
              mr: 0.5
            }}>
              {change > 0 ? (
                <TrendingUp sx={{ color: '#00ff88', fontSize: 10, mr: 0.25 }} />
              ) : (
                <TrendingDown sx={{ color: '#ff4444', fontSize: 10, mr: 0.25 }} />
              )}
              <Typography 
                variant="caption" 
                sx={{ 
                  color: change > 0 ? '#00ff88' : '#ff4444',
                  fontWeight: 700,
                  fontSize: '0.65rem'
                }}
              >
                {Math.abs(change).toFixed(2)}%
              </Typography>
            </Box>
          </Box>
        )}
      </Box>
      <Box className="metric-icon-bg" sx={{ 
        p: vertical ? 0.75 : 1, 
        borderRadius: '8px',
        background: `linear-gradient(135deg, ${color}33, ${color}11)`,
        transition: 'all 0.4s ease',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        border: `1px solid ${color}22`
      }}>
        {React.cloneElement(icon as React.ReactElement, { 
          sx: { color, fontSize: vertical ? 16 : 20 } 
        })}
      </Box>
    </Box>
  </MetricCard>
);

const MetricsGrid: React.FC<{ vertical?: boolean }> = ({ vertical }) => {
  const { regime, learner, enginePerformance } = useMLEngine();
  const context = useContext(OrderBookContext);
  
  const metricsData = learner.getMetrics();
  const currentPrice = context?.orderBookData?.asks?.[0]?.[0] 
    ? parseFloat(context.orderBookData.asks[0][0]).toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 4 }) 
    : '---';

  const metrics = [
    { 
      title: 'Price', 
      value: `$${currentPrice}`, 
      change: regime?.momentum ? regime.momentum * 10 : 0, 
      icon: <AttachMoney />, 
      color: '#00ff88' 
    },
    { 
      title: 'Accuracy', 
      value: `${(metricsData.accuracy * 100).toFixed(4)}%`, 
      change: (metricsData.accuracy - 0.5) * 10, 
      icon: <Assessment />, 
      color: '#00aaff' 
    },
    { 
      title: 'Latency', 
      value: `${enginePerformance.latency.toFixed(4)}ms`, 
      icon: <ShowChart />, 
      color: '#00ff88' 
    },
    { 
      title: 'Volatility', 
      value: `${(regime?.volatility ? regime.volatility * 100 : 0).toFixed(4)}%`, 
      change: regime?.volatility ? (regime.volatility - 0.02) * 100 : 0, 
      icon: <Speed />, 
      color: '#ffaa00' 
    }
  ];

  if (vertical) {
    return (
      <Box sx={{ py: 0.5 }}>
        {metrics.map((metric, index) => (
          <MetricItem key={index} {...metric} vertical />
        ))}
      </Box>
    );
  }

  return (
    <Grid container spacing={2}>
      {metrics.map((metric, index) => (
        <Grid item xs={12} sm={6} md={3} key={index}>
          <MetricItem {...metric} />
        </Grid>
      ))}
    </Grid>
  );
};

export default MetricsGrid;