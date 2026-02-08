// src/components/TradingEngine/LearningProgressVisualizer.tsx
import React, { useEffect, useState, useRef } from 'react';
import dynamic from 'next/dynamic';
import { Box, Typography } from '@mui/material';
import { useMLEngine } from '../../api/MLContext';
import PlotlyErrorBoundary from './PlotlyErrorBoundary';

const Plot = dynamic(() => import('react-plotly.js'), { 
  ssr: false,
  loading: () => <Box sx={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(255,255,255,0.2)' }}>Loading visualize...</Box>
});

interface LearningMetrics {
  step: number;
  accuracy: number;
  loss: number;
  gradientNorm: number;
  weightsDistribution: number[];
}

const NeuralNetworkViz: React.FC<{ metrics: LearningMetrics | null, layerNodes: number[] }> = ({ metrics, layerNodes }) => {
  const layers = layerNodes.length > 0 ? layerNodes : [50, 128, 64, 5]; 
  const width = 800;
  const height = 300;
  const nodeRadius = 6;
  const layerSpacing = width / (layers.length + 1);

  // Limit nodes for visualization performance while maintaining layout
  const vizLayers = layers.map(count => Math.min(count, 12));

  // Use metrics to drive visualization state
  const globalActivation = metrics ? Math.min(1, metrics.accuracy * 1.2) : 0.5;
  const pulseSpeed = metrics ? Math.max(0.5, 2 - metrics.accuracy) : 2;

  return (
    <Box sx={{ position: 'relative', width: '100%', height: '100%' }}>
      <svg width="100%" height="100%" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid meet">
      <defs>
        <filter id="glow">
          <feGaussianBlur stdDeviation="2" result="coloredBlur" />
          <feMerge>
            <feMergeNode in="coloredBlur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      
      {/* Layer Labels in SVG for perfect alignment */}
      {layers.map((count, i) => (
        <text
          key={`text-${i}`}
          x={(i + 1) * layerSpacing}
          y={20}
          textAnchor="middle"
          fill="rgba(255,255,255,0.4)"
          style={{ fontSize: '10px', fontWeight: 600, textTransform: 'uppercase' }}
        >
          {i === 0 ? 'Input' : i === layers.length - 1 ? 'Output' : `H${i}`} ({count})
        </text>
      ))}
      
      {/* Connections */}
      {vizLayers.map((count, i) => {
        if (i === vizLayers.length - 1) return null;
        const nextCount = vizLayers[i + 1];
        return Array.from({ length: count }).map((_, j) => {
          const x1 = (i + 1) * layerSpacing;
          const y1 = (j + 1) * (height / (count + 1));
          return Array.from({ length: nextCount }).map((_, k) => {
            const x2 = (i + 2) * layerSpacing;
            const y2 = (k + 1) * (height / (nextCount + 1));
            // Use deterministic mapping from metrics if possible, otherwise pseudo-random based on indices
            const seed = (i * 100 + j * 10 + k) / 1000;
            const opacity = 0.05 + (globalActivation * 0.4) * (0.5 + Math.sin(seed * Math.PI) * 0.5);
            return (
              <line
                key={`l-${i}-${j}-${k}`}
                x1={x1} y1={y1} x2={x2} y2={y2}
                stroke={seed > 0.5 ? '#00ff88' : '#00aaff'}
                strokeWidth="0.5"
                strokeOpacity={opacity}
              />
            );
          });
        });
      })}

      {/* Nodes */}
      {vizLayers.map((count, i) => (
        Array.from({ length: count }).map((_, j) => {
          const x = (i + 1) * layerSpacing;
          const y = (j + 1) * (height / (count + 1));
          const seed = (i * 50 + j) / 500;
          const isActive = globalActivation > (0.3 + seed * 0.4);
          return (
            <g key={`n-${i}-${j}`}>
              <circle
                cx={x} cy={y} r={nodeRadius}
                fill={isActive ? (i === 0 ? '#ffaa00' : i === vizLayers.length - 1 ? '#00ff88' : '#00aaff') : '#1a1a1a'}
                filter={isActive ? "url(#glow)" : ""}
                stroke="rgba(255,255,255,0.05)"
                strokeWidth="1"
              />
              {isActive && (
                <circle
                  cx={x} cy={y} r={nodeRadius + 2}
                  fill="none"
                  stroke={i === 0 ? '#ffaa00' : i === vizLayers.length - 1 ? '#00ff88' : '#00aaff'}
                  strokeWidth="0.5"
                  strokeOpacity="0.3"
                >
                  <animate attributeName="r" from={nodeRadius} to={nodeRadius + 4} dur={`${pulseSpeed}s`} repeatCount="indefinite" />
                  <animate attributeName="stroke-opacity" from="0.3" to="0" dur={`${pulseSpeed}s`} repeatCount="indefinite" />
                </circle>
              )}
            </g>
          );
        })
      ))}
    </svg>
  </Box>
  );
};

const LearningProgressVisualizer: React.FC = () => {
  const { learner, enginePerformance, history } = useMLEngine();
  const info = learner.getModelInfo();
  const [modelInfo, setModelInfo] = useState<{ totalNodes: number; layerNodes: number[] }>(info);

  const metrics = history.trainingMetrics;

  const weightsHistogram = {
    data: [{
      x: metrics[metrics.length - 1]?.weightsDistribution || [],
      type: 'histogram' as const,
      marker: {
        color: 'rgba(0, 255, 136, 0.7)',
        line: {
          color: 'rgba(0, 255, 136, 1)',
          width: 1
        }
      },
      nbinsx: 30
    }],
    layout: {
      title: {
        text: 'WEIGHTS DISTRIBUTION',
        font: { color: 'rgba(255,255,255,0.5)', size: 10, family: 'Inter' }
      },
      xaxis: { gridcolor: 'rgba(255,255,255,0.05)', zeroline: false, tickfont: { size: 8 } },
      yaxis: { gridcolor: 'rgba(255,255,255,0.05)', zeroline: false, tickfont: { size: 8 } },
      paper_bgcolor: 'transparent',
      plot_bgcolor: 'transparent',
      font: { color: '#ffffff' },
      height: 220,
      margin: { t: 35, b: 25, l: 35, r: 10 },
      autosize: true
    }
  };

  const gradientFlow = {
    data: [{
      y: metrics.map(m => m.gradientNorm),
      type: 'scatter' as const,
      mode: 'lines' as const,
      line: { color: '#00aaff', width: 2, shape: 'spline' as const },
      fill: 'tozeroy' as const,
      fillcolor: 'rgba(0, 170, 255, 0.1)'
    }],
    layout: {
      title: {
        text: 'GRADIENT NORM STABILITY',
        font: { color: 'rgba(255,255,255,0.5)', size: 10, family: 'Inter' }
      },
      xaxis: { gridcolor: 'rgba(255,255,255,0.05)', zeroline: false, tickfont: { size: 8 } },
      yaxis: { gridcolor: 'rgba(255,255,255,0.05)', zeroline: false, tickfont: { size: 8 } },
      paper_bgcolor: 'transparent',
      plot_bgcolor: 'transparent',
      font: { color: '#ffffff' },
      height: 220,
      margin: { t: 35, b: 25, l: 35, r: 10 },
      autosize: true
    }
  };

  return (
    <Box sx={{ p: 1, height: '100%', display: 'flex', flexDirection: 'column', gap: 3 }}>
      {/* Top Section: NN Viz and Stats side-by-side */}
      <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 180px', gap: 2, height: 300 }}>
        <Box sx={{ 
          background: 'rgba(255, 255, 255, 0.01)', 
          border: '1px solid rgba(255, 255, 255, 0.05)', 
          borderRadius: 3, 
          p: 1, 
          position: 'relative',
          overflow: 'hidden'
        }}>
          <Typography variant="caption" sx={{ 
            position: 'absolute', top: 10, left: 15, 
            fontSize: '0.65rem', fontWeight: 800, color: 'rgba(255,255,255,0.3)', letterSpacing: '0.05rem',
            zIndex: 1
          }}>
            NEURAL NETWORK ARCHITECTURE & ACTIVATIONS
          </Typography>
          <NeuralNetworkViz metrics={metrics[metrics.length - 1] || null} layerNodes={modelInfo.layerNodes} />
        </Box>
        
        <Box sx={{ 
          display: 'flex', flexDirection: 'column', gap: 2, justifyContent: 'center',
          background: 'rgba(255, 255, 255, 0.02)', border: '1px solid rgba(255, 255, 255, 0.05)', 
          borderRadius: 3, p: 2.5 
        }}>
          <Box>
            <Typography variant="caption" sx={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.3)', fontWeight: 800, textTransform: 'uppercase', display: 'block', mb: 0.5 }}>Active Nodes</Typography>
            <Typography variant="h6" sx={{ fontSize: '1.1rem', color: '#fff', fontWeight: 800 }}>
              {modelInfo.totalNodes} / {modelInfo.totalNodes}
            </Typography>
          </Box>
          <Box>
            <Typography variant="caption" sx={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.3)', fontWeight: 800, textTransform: 'uppercase', display: 'block', mb: 0.5 }}>Latency</Typography>
            <Typography variant="h6" sx={{ fontSize: '1.1rem', color: '#fff', fontWeight: 800 }}>
              {enginePerformance.latency.toFixed(4)}ms
            </Typography>
          </Box>
          <Box>
            <Typography variant="caption" sx={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.3)', fontWeight: 800, textTransform: 'uppercase', display: 'block', mb: 0.5 }}>Loss Delta</Typography>
            <Typography variant="h6" sx={{ fontSize: '1.1rem', color: '#00ff88', fontWeight: 800 }}>
              {metrics.length > 1 ? (metrics[metrics.length-1].loss - metrics[metrics.length-2].loss).toFixed(6) : '0.000000'}
            </Typography>
          </Box>
          <Box>
            <Typography variant="caption" sx={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.3)', fontWeight: 800, textTransform: 'uppercase', display: 'block', mb: 0.5 }}>Throughput</Typography>
            <Typography variant="h6" sx={{ fontSize: '1.1rem', color: '#fff', fontWeight: 800 }}>
              {enginePerformance.throughput.toFixed(4)} op/s
            </Typography>
          </Box>
        </Box>
      </Box>

      {/* Bottom Section: Charts stacked vertically (strictly 2 rows) */}
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3, flex: 1 }}>
        <Box sx={{ background: 'rgba(255, 255, 255, 0.02)', border: '1px solid rgba(255, 255, 255, 0.05)', borderRadius: 3, p: 1, minHeight: '230px', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {metrics.length === 0 ? (
            <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.2)' }}>
              Calculating weight distributions...
            </Typography>
          ) : (
            <PlotlyErrorBoundary>
              <Plot {...weightsHistogram} style={{ width: '100%', height: '220px' }} useResizeHandler />
            </PlotlyErrorBoundary>
          )}
        </Box>
        <Box sx={{ background: 'rgba(255, 255, 255, 0.02)', border: '1px solid rgba(255, 255, 255, 0.05)', borderRadius: 3, p: 1, minHeight: '230px', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {metrics.length === 0 ? (
            <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.2)' }}>
              Monitoring gradient flow...
            </Typography>
          ) : (
            <PlotlyErrorBoundary>
              <Plot {...gradientFlow} style={{ width: '100%', height: '220px' }} useResizeHandler />
            </PlotlyErrorBoundary>
          )}
        </Box>
      </Box>
    </Box>
  );
};

export default LearningProgressVisualizer;
