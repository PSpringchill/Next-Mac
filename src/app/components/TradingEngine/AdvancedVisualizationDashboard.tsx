'use client';

import React, { useContext, useEffect, useState, useMemo } from 'react';
import { Box, Typography } from '@mui/material';
import { OrderBookContext, OrderBookContextType } from '../../api/Page';
import { useMLEngine } from '../../api/MLContext';
import dynamic from 'next/dynamic';
import PlotlyErrorBoundary from './PlotlyErrorBoundary';
import {
  BarChart, Bar, Cell, Tooltip, ResponsiveContainer,
  ComposedChart, XAxis, YAxis, CartesianGrid, Line
} from 'recharts';

const Plot = dynamic(() => import('react-plotly.js'), { 
  ssr: false,
  loading: () => <Box sx={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(255,255,255,0.2)' }}>Loading analytics...</Box>
});

interface OrderFlowEntry {
  price: number;
  bidVolume: number;
  askVolume: number;
  totalVolume: number;
  delta: number;
  cumDelta: number;
}

interface AdvancedVisualizationDashboardProps {
  embedded?: boolean;
  minimal?: boolean;
  distributionOnly?: boolean;
}

const AdvancedVisualizationDashboard: React.FC<AdvancedVisualizationDashboardProps> = ({ 
  embedded = false, 
  minimal = false,
  distributionOnly = false
}) => {
  const context = useContext(OrderBookContext) as OrderBookContextType;
  const { mlPrediction, history, dataStagnant } = useMLEngine();
  
  const [isClient, setIsClient] = useState(false);
  const [orderFlow, setOrderFlow] = useState<OrderFlowEntry[]>([]);

  useEffect(() => { setIsClient(true); }, []);

  const featureNames = useMemo(() => {
    if (mlPrediction?.featureImportance) {
      return Array.from(mlPrediction.featureImportance.keys());
    }
    return [
      'bid_ask_spread', 'order_flow_toxicity', 'price_impact',
      ...Array.from({ length: 10 }, (_, i) => `imbalance_l${i + 1}`),
      ...Array.from({ length: 10 }, (_, i) => `vol_prof_bid_l${i + 1}`),
      ...Array.from({ length: 10 }, (_, i) => `vol_prof_ask_l${i + 1}`),
      ...Array.from({ length: 17 }, (_, i) => `liq_depth_${i + 1}`)
    ];
  }, [mlPrediction]);

  const importanceHistory = history.importanceHistory;
  const historyLabels = history.historyLabels;

  const correlationData = useMemo(() => {
    if (!mlPrediction?.featureCorrelation || mlPrediction.featureCorrelation.size === 0) return [];
    const links: { from: string; weight: number }[] = [];
    mlPrediction.featureCorrelation.forEach((corr, name) => {
      links.push({ 
        from: name.split('_').map(w => w[0].toUpperCase() + w.slice(1, 3)).join(''),
        weight: isNaN(corr) ? 0 : corr 
      });
    });
    return links.sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight)).slice(0, 20);
  }, [mlPrediction]);

  // Order flow data from order book
  useEffect(() => {
    if (!context?.orderBookData) return;
    const bids = context.orderBookData.bids.slice(0, 50);
    const asks = context.orderBookData.asks.slice(0, 50);
    const priceMap = new Map<number, { price: number; bidVolume: number; askVolume: number }>();
    
    bids.forEach(([p, q]) => priceMap.set(parseFloat(p), { price: parseFloat(p), bidVolume: parseFloat(q), askVolume: 0 }));
    asks.forEach(([p, q]) => {
      const price = parseFloat(p);
      const existing = priceMap.get(price);
      if (existing) {
        existing.askVolume = parseFloat(q);
      } else {
        priceMap.set(price, { price, bidVolume: 0, askVolume: parseFloat(q) });
      }
    });
    
    const sortedFlow = Array.from(priceMap.values()).sort((a, b) => a.price - b.price);
    let currentCumDelta = 0;
    const enrichedFlow = sortedFlow.map(d => {
      const delta = d.bidVolume - d.askVolume;
      currentCumDelta += delta;
      return { ...d, delta, cumDelta: currentCumDelta, totalVolume: d.bidVolume + d.askVolume };
    });
    setOrderFlow(enrichedFlow);
  }, [context?.orderBookData]);

  // ─── ORDER FLOW CHART (unique to this component) ───
  const OrderFlowChart = () => {
    const flowData = orderFlow;
    const pocPrice = useMemo(() => {
      if (flowData.length === 0) return 0;
      let maxV = 0, price = 0;
      flowData.forEach(d => { if (d.totalVolume > maxV) { maxV = d.totalVolume; price = d.price; } });
      return price;
    }, [flowData]);

    return (
      <Box sx={{ width: '100%' }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1.5, px: 1 }}>
          <Box>
            <Typography sx={{ color: '#00ff88', fontSize: '0.9rem', fontWeight: 700, letterSpacing: '0.05em' }}>Order Flow Dynamics</Typography>
            <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.35)', fontSize: '0.6rem' }}>
              50 LEVELS • BID/ASK DISTRIBUTION • CUM DELTA • POC: {pocPrice.toFixed(4)}
            </Typography>
          </Box>
          <Box sx={{ display: 'flex', gap: 2 }}>
            {[{ label: 'BIDS', color: '#00ff88' }, { label: 'ASKS', color: '#ff4444' }, { label: 'CUM DELTA', color: '#00aaff' }].map(l => (
              <Box key={l.label} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <Box sx={{ width: l.label === 'CUM DELTA' ? 12 : 8, height: l.label === 'CUM DELTA' ? 2 : 8, bgcolor: l.color, borderRadius: '1px' }} />
                <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.6rem' }}>{l.label}</Typography>
              </Box>
            ))}
          </Box>
        </Box>
        <Box sx={{ height: 350, width: '100%' }}>
          {flowData.length === 0 ? (
            <Box sx={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.2)' }}>Waiting for market flow...</Typography>
            </Box>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={flowData} margin={{ top: 10, right: 30, left: 30, bottom: 30 }}>
                <defs>
                  <linearGradient id="bidGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#00ff88" stopOpacity={0.8}/><stop offset="95%" stopColor="#00ff88" stopOpacity={0.2}/>
                  </linearGradient>
                  <linearGradient id="askGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#ff4444" stopOpacity={0.8}/><stop offset="95%" stopColor="#ff4444" stopOpacity={0.2}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                <XAxis dataKey="price" stroke="rgba(255,255,255,0.3)" fontSize={8} tickFormatter={(val) => parseFloat(val).toFixed(4)} interval={Math.floor(flowData.length / 10)} dy={8} />
                <YAxis yAxisId="left" stroke="rgba(255,255,255,0.3)" fontSize={9} tickFormatter={(val) => val >= 1000 ? (val/1000).toFixed(1) + 'k' : val.toFixed(0)} />
                <YAxis yAxisId="right" orientation="right" stroke="#00aaff" fontSize={9} tickFormatter={(val) => val >= 1000 || val <= -1000 ? (val/1000).toFixed(1) + 'k' : val.toFixed(0)} />
                <Tooltip contentStyle={{ backgroundColor: 'rgba(10,10,10,0.95)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', fontSize: '10px' }} labelStyle={{ color: '#fff', fontWeight: 'bold' }} labelFormatter={(val) => `Price: ${parseFloat(val).toFixed(4)}`} cursor={{ fill: 'rgba(255,255,255,0.03)' }} />
                <Bar yAxisId="left" dataKey="bidVolume" name="Bids" fill="url(#bidGrad)" isAnimationActive={false} barSize={10}>
                  {flowData.map((entry, index) => (<Cell key={`cell-bid-${index}`} stroke={entry.price === pocPrice ? '#00ff88' : 'none'} strokeWidth={2} />))}
                </Bar>
                <Bar yAxisId="left" dataKey="askVolume" name="Asks" fill="url(#askGrad)" isAnimationActive={false} barSize={10}>
                  {flowData.map((entry, index) => (<Cell key={`cell-ask-${index}`} stroke={entry.price === pocPrice ? '#ff4444' : 'none'} strokeWidth={2} />))}
                </Bar>
                <Line yAxisId="right" type="monotone" dataKey="cumDelta" name="Cum Delta" stroke="#00aaff" strokeWidth={2} dot={false} isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </Box>
      </Box>
    );
  };

  if (!isClient) return <Box sx={{ height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: '#0a0a0a', color: 'rgba(255,255,255,0.2)' }}>Initializing Analytics...</Box>;

  // distributionOnly mode: just the order flow chart
  if (distributionOnly) {
    return (
      <Box sx={{ p: 1 }}>
        <OrderFlowChart />
      </Box>
    );
  }

  const heatmapLayout = {
    title: { text: 'Feature Importance Over Time', font: { color: 'rgba(255,255,255,0.6)', size: 11, family: 'Inter' } },
    paper_bgcolor: 'transparent', plot_bgcolor: 'transparent',
    xaxis: { tickfont: { color: 'rgba(255,255,255,0.4)', size: 7 }, tickangle: -45 },
    yaxis: { tickfont: { color: 'rgba(255,255,255,0.4)', size: 8 } },
    margin: { t: 35, b: 40, l: 50, r: 10 }, height: 300, autosize: true
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, p: 1.5 }}>
      {/* Stagnant data warning */}
      {dataStagnant && (
        <Typography sx={{ color: '#ff4444', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.1rem', fontSize: '0.7rem', textAlign: 'center' }}>
          MARKET FEED STAGNANT — SIGNALS PAUSED
        </Typography>
      )}

      {/* 1. Order Flow Dynamics — full width */}
      <Box sx={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 2, p: 2 }}>
        <OrderFlowChart />
      </Box>

      {!minimal && (
        <>
          {/* 2. Feature Importance Heatmap (temporal) — full width */}
          <Box sx={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 2, p: 1.5, minHeight: 300 }}>
            <PlotlyErrorBoundary>
              <Plot
                data={[{
                  z: importanceHistory.length > 0 ? importanceHistory : [new Array(50).fill(0)],
                  x: featureNames,
                  y: historyLabels.length === importanceHistory.length ? historyLabels : new Array(importanceHistory.length).fill(''),
                  type: 'heatmap' as const,
                  colorscale: 'Viridis',
                  showscale: true,
                  colorbar: { thickness: 12, tickfont: { color: 'rgba(255,255,255,0.4)', size: 8 } }
                } as any]}
                layout={heatmapLayout}
                style={{ width: '100%', height: '300px' }}
                useResizeHandler
              />
            </PlotlyErrorBoundary>
          </Box>

          {/* 3. Feature-Price Correlation — full width */}
          <Box sx={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 2, p: 2 }}>
            <Typography sx={{ color: 'rgba(255,255,255,0.6)', fontSize: '0.8rem', fontWeight: 700, letterSpacing: '0.05em', mb: 1, textAlign: 'center' }}>
              Feature-Price Correlation Analysis
            </Typography>
            <Box sx={{ height: 280, width: '100%' }}>
              {correlationData.length === 0 ? (
                <Box sx={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.2)' }}>Analyzing feature correlations...</Typography>
                </Box>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={correlationData} margin={{ top: 10, right: 20, left: 30, bottom: 50 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                    <XAxis dataKey="from" type="category" stroke="rgba(255,255,255,0.4)" fontSize={9} interval={0} angle={-45} textAnchor="end" />
                    <YAxis stroke="rgba(255,255,255,0.3)" fontSize={9} domain={[-1, 1]} />
                    <Tooltip contentStyle={{ backgroundColor: 'rgba(10,10,10,0.95)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', fontSize: '10px' }} itemStyle={{ color: '#fff' }} formatter={(val: any) => [typeof val === 'number' ? val.toFixed(4) : '0.0000', 'Correlation']} />
                    <Bar dataKey="weight" fill="#00aaff" minPointSize={8} isAnimationActive={false}>
                      {correlationData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.weight > 0 ? '#00ff88' : entry.weight < 0 ? '#ff4444' : '#555'} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </Box>
          </Box>
        </>
      )}
    </Box>
  );
};

export default AdvancedVisualizationDashboard;
