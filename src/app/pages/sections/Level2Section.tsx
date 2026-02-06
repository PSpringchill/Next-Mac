import React, { useContext, useMemo, useState, useEffect } from 'react';
import { Box, Typography, Chip } from '@mui/material';
import { OrderBookContext } from '../../api/Page';
import { useMLEngine } from '../../api/MLContext';
import { 
  LineChart, Line, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell 
} from 'recharts';

interface OrderFlowMetrics {
  bidAskSpread: number;
  spreadPercentage: number;
  orderFlowImbalance: number;
  volumeWeightedBidAsk: number;
  largeOrdersDetected: number;
  bookPressure: number;
  bookVelocity: number;
  depthImbalance: number;
  liquidityScore: number;
}

interface SizeBucket {
  range: string;
  count: number;
}

const Level2Section: React.FC = () => {
  const context = useContext(OrderBookContext);
  const { regime } = useMLEngine();
  const orderBookData = context?.orderBookData;

  const [historicalMetrics, setHistoricalMetrics] = useState<OrderFlowMetrics[]>([]);
  const [isClient, setIsClient] = useState(false);

  useEffect(() => {
    setIsClient(true);
  }, []);

  const bids = orderBookData?.bids || [];
  const asks = orderBookData?.asks || [];

  // Advanced order flow metrics
  const orderFlowMetrics = useMemo((): OrderFlowMetrics => {
    if (bids.length === 0 || asks.length === 0) {
      return {
        bidAskSpread: 0, spreadPercentage: 0, orderFlowImbalance: 0,
        volumeWeightedBidAsk: 0, largeOrdersDetected: 0, bookPressure: 0,
        bookVelocity: 0, depthImbalance: 0, liquidityScore: 0
      };
    }

    const bestBid = parseFloat(bids[0][0]);
    const bestAsk = parseFloat(asks[0][0]);
    const midPrice = (bestBid + bestAsk) / 2;
    const bidAskSpread = bestAsk - bestBid;
    const spreadPercentage = (bidAskSpread / midPrice) * 100;

    const vwBid = (() => {
      const relevant = bids.slice(0, 10);
      let totalValue = 0, totalVol = 0;
      relevant.forEach(([p, q]) => {
        const price = parseFloat(p), qty = parseFloat(q);
        totalValue += price * qty;
        totalVol += qty;
      });
      return totalVol > 0 ? totalValue / totalVol : 0;
    })();

    const vwAsk = (() => {
      const relevant = asks.slice(0, 10);
      let totalValue = 0, totalVol = 0;
      relevant.forEach(([p, q]) => {
        const price = parseFloat(p), qty = parseFloat(q);
        totalValue += price * qty;
        totalVol += qty;
      });
      return totalVol > 0 ? totalValue / totalVol : 0;
    })();

    const volumeWeightedBidAsk = vwAsk - vwBid;

    const bidVolume5 = bids.slice(0, 5).reduce((sum, [_, qty]) => sum + parseFloat(qty), 0);
    const askVolume5 = asks.slice(0, 5).reduce((sum, [_, qty]) => sum + parseFloat(qty), 0);
    const orderFlowImbalance = (bidVolume5 - askVolume5) / (bidVolume5 + askVolume5) * 100;

    const allSizes = [...bids, ...asks].map(([_, qty]) => parseFloat(qty));
    const avgSize = allSizes.reduce((a, b) => a + b, 0) / allSizes.length;
    const largeOrdersDetected = allSizes.filter(size => size > avgSize * 3).length;

    let bidPressure = 0, askPressure = 0;
    bids.slice(0, 10).forEach(([price, qty]) => {
      const distance = Math.abs(parseFloat(price) - midPrice);
      bidPressure += parseFloat(qty) * (1 / (1 + distance / midPrice));
    });
    asks.slice(0, 10).forEach(([price, qty]) => {
      const distance = Math.abs(parseFloat(price) - midPrice);
      askPressure += parseFloat(qty) * (1 / (1 + distance / midPrice));
    });
    const bookPressure = (bidPressure - askPressure) / (bidPressure + askPressure) * 100;

    const bookVelocity = Math.abs(orderFlowImbalance) * (1 + spreadPercentage);

    return {
      bidAskSpread,
      spreadPercentage,
      orderFlowImbalance,
      volumeWeightedBidAsk,
      largeOrdersDetected,
      bookPressure,
      bookVelocity,
      depthImbalance: orderFlowImbalance,
      liquidityScore: (bidVolume5 + askVolume5) / 100 // Scale to a meaningful score
    };
  }, [bids, asks]);

  useEffect(() => {
    const interval = setInterval(() => {
      setHistoricalMetrics(prev => [...prev.slice(-29), orderFlowMetrics]);
    }, 2000);
    return () => clearInterval(interval);
  }, [orderFlowMetrics]);

  // Dynamic order size distribution with blue color theme
  const sizeDistribution = useMemo((): SizeBucket[] => {
    const allOrders = [...bids, ...asks].map(([_, qty]) => parseFloat(qty)).filter(s => !isNaN(s) && s > 0);
    if (allOrders.length === 0) {
      return [
        { range: '0', count: 0 },
        { range: '0', count: 0 },
        { range: '0', count: 0 },
        { range: '0', count: 0 },
        { range: '0', count: 0 }
      ];
    }

    const minSize = Math.min(...allOrders);
    const maxSize = Math.max(...allOrders);
    
    if (maxSize === minSize) {
      return [
        { range: maxSize.toFixed(2), count: allOrders.length },
        { range: '', count: 0 },
        { range: '', count: 0 },
        { range: '', count: 0 },
        { range: '', count: 0 }
      ];
    }

    const logMin = Math.log10(minSize);
    const logMax = Math.log10(maxSize);
    const logStep = (logMax - logMin) / 5;

    const buckets: SizeBucket[] = [];
    for (let i = 0; i < 5; i++) {
      const start = Math.pow(10, logMin + i * logStep);
      const end = Math.pow(10, logMin + (i + 1) * logStep);
      
      const count = allOrders.filter(size => 
        i === 4 ? size >= start : (size >= start && size < end)
      ).length;

      const formatSize = (s: number) => {
        if (s >= 1000) return (s / 1000).toFixed(1) + 'k';
        if (s >= 1) return s.toFixed(1);
        return s.toFixed(3);
      };

      buckets.push({
        range: `${formatSize(start)}-${formatSize(end)}`,
        count
      });
    }

    return buckets;
  }, [bids, asks]);

  if (!isClient) {
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, height: '100%' }}>
        <Box sx={{ flex: 1, minHeight: 100, bgcolor: 'rgba(0,0,0,0.2)', borderRadius: 1 }} />
      </Box>
    );
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, height: '100%' }}>
      {/* Top Signal Bar */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.5 }}>
        <Typography variant="subtitle2" sx={{ color: 'rgba(255,255,255,0.4)', fontWeight: 800, fontSize: '0.6rem', letterSpacing: '0.1em' }}>
          L2 METRICS
        </Typography>
        <Chip 
          label={regime?.name?.toUpperCase() || 'ANALYZING'} 
          size="small"
          sx={{ 
            height: 18, fontSize: '0.6rem', fontWeight: 900,
            bgcolor: regime?.name === 'volatile' ? 'rgba(255,68,68,0.1)' : 'rgba(0,255,136,0.1)',
            color: regime?.name === 'volatile' ? '#ff4444' : '#00ff88',
            border: `1px solid ${regime?.name === 'volatile' ? 'rgba(255,68,68,0.2)' : 'rgba(0,255,136,0.2)'}`
          }}
        />
      </Box>

      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, height: '100%', overflow: 'hidden' }}>
        {/* Quick Stats */}
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 0.5, flex: '0 0 auto' }}>
          <Box sx={{ p: 1, bgcolor: 'rgba(255,255,255,0.02)', borderRadius: 1, border: '1px solid rgba(255,255,255,0.05)' }}>
            <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.3)', display: 'block', mb: 0.25, fontSize: '0.55rem' }}>IMBAL</Typography>
            <Typography variant="h6" sx={{ color: orderFlowMetrics.orderFlowImbalance > 0 ? '#00ff88' : '#ff4444', fontSize: '0.8rem', fontWeight: 800 }}>
              {orderFlowMetrics.orderFlowImbalance.toFixed(4)}%
            </Typography>
          </Box>
          <Box sx={{ p: 1, bgcolor: 'rgba(255,255,255,0.02)', borderRadius: 1, border: '1px solid rgba(255,255,255,0.05)' }}>
            <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.3)', display: 'block', mb: 0.25, fontSize: '0.55rem' }}>VW SPREAD</Typography>
            <Typography variant="h6" sx={{ color: '#fff', fontSize: '0.8rem', fontWeight: 800 }}>
              {orderFlowMetrics.volumeWeightedBidAsk.toFixed(4)}
            </Typography>
          </Box>
          <Box sx={{ p: 1, bgcolor: 'rgba(255,255,255,0.02)', borderRadius: 1, border: '1px solid rgba(255,255,255,0.05)' }}>
            <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.3)', display: 'block', mb: 0.25, fontSize: '0.55rem' }}>LIQ</Typography>
            <Typography variant="h6" sx={{ color: '#fff', fontSize: '0.8rem', fontWeight: 800 }}>
              {orderFlowMetrics.liquidityScore.toFixed(4)}
            </Typography>
          </Box>
        </Box>

        {/* Additional Stats Row */}
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 0.5, flex: '0 0 auto' }}>
          <Box sx={{ p: 1, bgcolor: 'rgba(255,255,255,0.02)', borderRadius: 1, border: '1px solid rgba(255,255,255,0.05)' }}>
            <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.3)', display: 'block', mb: 0.25, fontSize: '0.55rem' }}>SPREAD</Typography>
            <Typography variant="h6" sx={{ color: '#fff', fontSize: '0.8rem', fontWeight: 800 }}>
              {orderFlowMetrics.bidAskSpread.toFixed(4)}
            </Typography>
          </Box>
          <Box sx={{ p: 1, bgcolor: 'rgba(255,255,255,0.02)', borderRadius: 1, border: '1px solid rgba(255,255,255,0.05)' }}>
            <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.3)', display: 'block', mb: 0.25, fontSize: '0.55rem' }}>SPREAD %</Typography>
            <Typography variant="h6" sx={{ color: orderFlowMetrics.spreadPercentage > 0.1 ? '#ffaa00' : '#00ff88', fontSize: '0.8rem', fontWeight: 800 }}>
              {orderFlowMetrics.spreadPercentage.toFixed(4)}%
            </Typography>
          </Box>
          <Box sx={{ p: 1, bgcolor: 'rgba(255,255,255,0.02)', borderRadius: 1, border: '1px solid rgba(255,255,255,0.05)' }}>
            <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.3)', display: 'block', mb: 0.25, fontSize: '0.55rem' }}>PRESSURE</Typography>
            <Typography variant="h6" sx={{ color: orderFlowMetrics.bookPressure > 0 ? '#00ff88' : '#ff4444', fontSize: '0.8rem', fontWeight: 800 }}>
              {orderFlowMetrics.bookPressure.toFixed(2)}%
            </Typography>
          </Box>
        </Box>

        {/* OFI Momentum Chart */}
        <Box sx={{ flex: 1, minHeight: 100, bgcolor: 'rgba(0,0,0,0.2)', borderRadius: 1, p: 0.5 }}>
          <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.2)', mb: 0.25, display: 'block', fontSize: '0.55rem' }}>OFI MOMENTUM</Typography>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={historicalMetrics}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
              <XAxis hide />
              <YAxis hide domain={[-100, 100]} />
              <Tooltip 
                contentStyle={{ backgroundColor: '#000', border: '1px solid #333', fontSize: '10px' }}
                itemStyle={{ padding: 0 }}
              />
              <Line 
                type="monotone" 
                dataKey="orderFlowImbalance" 
                stroke="#00ff88" 
                strokeWidth={2} 
                dot={false}
                isAnimationActive={false}
              />
              <Line 
                type="monotone" 
                dataKey="bookPressure" 
                stroke="#ff8800" 
                strokeWidth={1} 
                dot={false}
                strokeDasharray="3 3"
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </Box>

        {/* Size Distribution */}
        <Box sx={{ flex: 0.7, minHeight: 80, bgcolor: 'rgba(0,0,0,0.2)', borderRadius: 1, p: 0.5 }}>
          <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.2)', mb: 0.25, display: 'block', fontSize: '0.55rem' }}>SIZE DIST</Typography>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={sizeDistribution} margin={{ top: 5, right: 5, left: -20, bottom: 5 }}>
              <XAxis 
                dataKey="range" 
                hide={false} 
                fontSize={7} 
                tick={{ fill: 'rgba(255,255,255,0.3)' }} 
                interval={0}
              />
              <YAxis hide domain={[0, 'dataMax + 1']} />
              <Tooltip 
                contentStyle={{ backgroundColor: '#000', border: '1px solid #333', fontSize: '10px' }}
                cursor={{ fill: 'rgba(255,255,255,0.05)' }}
                labelStyle={{ color: '#fff' }}
              />
              <Bar dataKey="count" radius={[2, 2, 0, 0]}>
                {sizeDistribution.map((entry, index) => (
                  <Cell 
                    key={`cell-${index}`} 
                    fill={entry.count === 0 ? 'transparent' : `rgba(0, 170, 255, ${0.4 + (index * 0.15)})`} 
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Box>
      </Box>
    </Box>
  );
};

export default Level2Section;
