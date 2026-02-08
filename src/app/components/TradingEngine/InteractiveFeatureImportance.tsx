// src/components/TradingEngine/InteractiveFeatureImportance.tsx
import React, { useState, useEffect } from 'react';
import { Switch, FormControlLabel, Box, Typography } from '@mui/material';
import dynamic from 'next/dynamic';
import { useMLEngine } from '../../api/MLContext';
import PlotlyErrorBoundary from './PlotlyErrorBoundary';

const Plot = dynamic(() => import('react-plotly.js'), { 
  ssr: false,
  loading: () => <Box sx={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(255,255,255,0.2)' }}>Loading analytics...</Box>
});

interface FeatureData {
  name: string;
  importance: number;
  trend: 'up' | 'down';
  correlation: number;
  impact: number;
}

const InteractiveFeatureImportance: React.FC = () => {
  const [showAnimation, setShowAnimation] = useState(true);
  const [features, setFeatures] = useState<FeatureData[]>([]);
  const { learner, mlPrediction } = useMLEngine();

  useEffect(() => {
    const updateFeatures = async () => {
      if (!mlPrediction || !mlPrediction.featureImportance) return;
      
      const importanceMap = mlPrediction.featureImportance;
      const correlationMap = mlPrediction.featureCorrelation;

      const featureData = Array.from(importanceMap.entries()).map(([name, importance]) => {
        const correlation = correlationMap?.get(name) || 0;
        return {
          name,
          importance,
          trend: (correlation > 0 ? 'up' : 'down') as 'up' | 'down', 
          correlation,
          impact: importance * 100
        };
      });
      
      setFeatures(featureData);
    };

    if (showAnimation || features.length === 0) {
      updateFeatures();
    }
  }, [showAnimation, mlPrediction, features.length]);

  const featureScatter3D = {
    data: [{
      type: 'scatter3d' as const,
      mode: 'markers' as const,
      x: features.map(f => f.importance),
      y: features.map(f => f.correlation),
      z: features.map(f => f.impact),
      text: features.map(f => f.name),
      marker: {
        size: features.map(f => f.importance * 15),
        color: features.map(f => f.impact),
        colorscale: 'Viridis',
        showscale: true,
        colorbar: {
          title: {
            text: 'IMPACT',
            font: { color: 'rgba(255,255,255,0.5)', size: 8, family: 'Inter' }
          },
          tickfont: { color: 'rgba(255,255,255,0.5)', size: 7 },
          thickness: 10,
          len: 0.8
        }
      }
    }],
    layout: {
      scene: {
        xaxis: { 
          title: { text: 'IMP', font: { color: 'rgba(255,255,255,0.3)', size: 8 } },
          gridcolor: 'rgba(255,255,255,0.05)',
          zeroline: false
        },
        yaxis: { 
          title: { text: 'CORR', font: { color: 'rgba(255,255,255,0.3)', size: 8 } },
          gridcolor: 'rgba(255,255,255,0.05)',
          zeroline: false
        },
        zaxis: { 
          title: { text: 'IMPACT', font: { color: 'rgba(255,255,255,0.3)', size: 8 } },
          gridcolor: 'rgba(255,255,255,0.05)',
          zeroline: false
        },
        bgcolor: 'transparent',
        camera: {
          eye: { x: 1.8, y: 1.8, z: 1.8 }
        }
      },
      paper_bgcolor: 'transparent',
      font: { color: '#ffffff', family: 'Inter' },
      height: 300,
      margin: { t: 0, b: 0, l: 0, r: 0 },
      title: {
        text: 'FEATURE SPACE DYNAMICS',
        font: { color: 'rgba(255,255,255,0.5)', size: 10, weight: 800 },
        y: 0.98
      },
      autosize: true
    }
  };

  const waterfallChart = {
    data: [{
      type: 'waterfall' as const,
      orientation: 'v' as const,
      measure: features.map(() => 'relative'),
      x: features.map(f => f.name.split('_').map((w: string) => w[0]).join('').toUpperCase()),
      textposition: 'outside' as const,
      text: features.map(f => `+${(f.impact).toFixed(0)}`),
      y: features.map(f => f.impact),
      connector: {
        line: { color: 'rgba(255,255,255,0.1)' }
      },
      decreasing: { marker: { color: '#ff4444' } },
      increasing: { marker: { color: '#00ff88' } },
      totals: { marker: { color: '#00aaff' } }
    }],
    layout: {
      title: {
        text: 'CONTRIBUTION DELTA',
        font: { color: 'rgba(255,255,255,0.5)', size: 10, weight: 800 }
      },
      xaxis: { gridcolor: 'rgba(255,255,255,0.05)', zeroline: false, tickfont: { size: 8 } },
      yaxis: { gridcolor: 'rgba(255,255,255,0.05)', zeroline: false, tickfont: { size: 8 } },
      paper_bgcolor: 'transparent',
      plot_bgcolor: 'transparent',
      font: { color: '#ffffff', family: 'Inter' },
      height: 220,
      margin: { t: 35, b: 25, l: 35, r: 10 },
      autosize: true
    }
  };

  const sunburstChart = React.useMemo(() => {
    const categories = {
      'Base': features.filter(f => ['bid_ask_spread', 'order_flow_toxicity', 'price_impact'].includes(f.name)),
      'Imbalance': features.filter(f => f.name.startsWith('imbalance')),
      'Volume': features.filter(f => f.name.startsWith('vol_prof')),
      'Liquidity': features.filter(f => f.name.startsWith('liq_depth'))
    };

    const catImportance = {
      'Base': categories.Base.reduce((sum, f) => sum + f.importance, 0) * 100,
      'Imbalance': categories.Imbalance.reduce((sum, f) => sum + f.importance, 0) * 100,
      'Volume': categories.Volume.reduce((sum, f) => sum + f.importance, 0) * 100,
      'Liquidity': categories.Liquidity.reduce((sum, f) => sum + f.importance, 0) * 100
    };

    const totalImportance = Object.values(catImportance).reduce((a, b) => a + b, 0);

    return {
      data: [{
        type: 'sunburst' as const,
        labels: ['All', 'Base', 'Imbalance', 'Volume', 'Liquidity', ...features.map(f => f.name)],
        parents: [
          '', 'All', 'All', 'All', 'All',
          ...features.map(f => {
            if (['bid_ask_spread', 'order_flow_toxicity', 'price_impact'].includes(f.name)) return 'Base';
            if (f.name.startsWith('imbalance')) return 'Imbalance';
            if (f.name.startsWith('vol_prof')) return 'Volume';
            if (f.name.startsWith('liq_depth')) return 'Liquidity';
            return 'All';
          })
        ],
        values: [
          totalImportance,
          catImportance.Base,
          catImportance.Imbalance,
          catImportance.Volume,
          catImportance.Liquidity,
          ...features.map(f => f.importance * 100)
        ],
        marker: {
          colors: [
            '#1a1a1a', '#00ff88', '#00aaff', '#ffaa00', '#bb88ff',
            ...features.map(f => f.trend === 'up' ? '#00ff88' : '#ff4444')
          ]
        },
        leaf: { opacity: 0.8 },
        insidetextorientation: 'radial'
      }],
      layout: {
        paper_bgcolor: 'transparent',
        font: { color: '#ffffff', family: 'Inter', size: 8 },
        height: 350,
        margin: { t: 10, b: 10, l: 10, r: 10 },
        title: {
          text: 'HIERARCHICAL FEATURE IMPORTANCE',
          font: { color: 'rgba(255,255,255,0.5)', size: 10, weight: 800 }
        },
        autosize: true
      }
    };
  }, [features]);

  return (
    <Box className="interactive-feature-importance" sx={{ p: 1, height: '100%', display: 'flex', flexDirection: 'column', gap: 2 }}>
      <Box sx={{ 
        background: 'rgba(255, 255, 255, 0.03)',
        padding: '10px 15px',
        borderRadius: '8px',
        marginBottom: '10px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        border: '1px solid rgba(255, 255, 255, 0.05)'
      }}>
        <FormControlLabel
          control={
            <Switch
              checked={showAnimation}
              onChange={(e) => setShowAnimation(e.target.checked)}
              size="small"
              sx={{ '& .MuiSwitch-switchBase.Mui-checked': { color: '#00ff88' } }}
            />
          }
          label={<Typography variant="caption" sx={{ color: '#fff', fontSize: '0.7rem' }}>Auto-Update</Typography>}
        />
      </Box>

      {/* Strictly vertical stack of charts */}
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1 }}>
        {features.length === 0 ? (
          <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '600px', background: 'rgba(255,255,255,0.02)', borderRadius: 2 }}>
            <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.2)' }}>
              Initialising multi-dimensional feature space...
            </Typography>
          </Box>
        ) : (
          <>
            <Box sx={{ 
              background: 'rgba(255, 255, 255, 0.01)',
              border: '1px solid rgba(255, 255, 255, 0.05)',
              borderRadius: 2,
              p: 1
            }}>
              <PlotlyErrorBoundary>
                <Plot {...featureScatter3D} style={{ width: '100%', height: '300px' }} useResizeHandler />
              </PlotlyErrorBoundary>
            </Box>
            <Box sx={{ 
              background: 'rgba(255, 255, 255, 0.01)',
              border: '1px solid rgba(255, 255, 255, 0.05)',
              borderRadius: 2,
              p: 1,
              overflow: 'hidden'
            }}>
              <PlotlyErrorBoundary>
                <Plot {...waterfallChart} style={{ width: '100%', height: '220px' }} useResizeHandler />
              </PlotlyErrorBoundary>
            </Box>
            <Box sx={{ 
              background: 'rgba(255, 255, 255, 0.01)',
              border: '1px solid rgba(255, 255, 255, 0.05)',
              borderRadius: 2,
              p: 1
            }}>
              <PlotlyErrorBoundary>
                <Plot {...sunburstChart} style={{ width: '100%', height: '350px' }} useResizeHandler />
              </PlotlyErrorBoundary>
            </Box>
          </>
        )}
      </Box>
    </Box>
  );
};

export default InteractiveFeatureImportance;
