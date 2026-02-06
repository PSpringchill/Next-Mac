import React, { useContext, useMemo, useState, useEffect } from 'react';
import './Level2Analysis.css';
import { OrderBookContext, OrderBookContextType } from "../../../api/Page";
import { useMLEngine } from "../../../api/MLContext";
import { LineChart, Line, BarChart, Bar, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';

interface OrderBookLevel {
  price: number;
  quantity: number;
  cumulative: number;
  percentage: number;
}

interface VolumeProfile {
  price: number;
  volume: number;
  buyVolume: number;
  sellVolume: number;
  delta: number;
}

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

const Level2Analysis: React.FC = () => {
  const context = useContext(OrderBookContext) as OrderBookContextType;
  const { regime, prediction } = useMLEngine();
  const orderBookData = context?.orderBookData;

  const [historicalMetrics, setHistoricalMetrics] = useState<OrderFlowMetrics[]>([]);
  const [isClient, setIsClient] = useState(false);
  const [volumeProfile, setVolumeProfile] = useState<VolumeProfile[]>([]);
  const [orderBookHistory, setOrderBookHistory] = useState<any[]>([]);

  useEffect(() => {
    setIsClient(true);
  }, []);

  const bids = orderBookData?.bids || [];
  const asks = orderBookData?.asks || [];

  // Process order book levels with advanced metrics
  const processedOrderBook = useMemo(() => {
    const processLevels = (orders: [string, string][], isBid: boolean): OrderBookLevel[] => {
      let cumulative = 0;
      const totalVolume = orders.reduce((sum: number, [_, qty]: [string, string]) => sum + parseFloat(qty), 0);
      
      return orders.slice(0, 20).map(([price, quantity]: [string, string]) => {
        const qty = parseFloat(quantity);
        cumulative += qty;
        return {
          price: parseFloat(price),
          quantity: qty,
          cumulative,
          percentage: (qty / totalVolume) * 100
        };
      });
    };

    return {
      bids: processLevels(bids, true),
      asks: processLevels(asks, false)
    };
  }, [bids, asks]);

  // Calculate advanced order flow metrics
  const orderFlowMetrics = useMemo((): OrderFlowMetrics => {
    if (bids.length === 0 || asks.length === 0) {
      return {
        bidAskSpread: 0,
        spreadPercentage: 0,
        orderFlowImbalance: 0,
        volumeWeightedBidAsk: 0,
        largeOrdersDetected: 0,
        bookPressure: 0,
        bookVelocity: 0,
        depthImbalance: 0,
        liquidityScore: 0
      };
    }

    const bestBid = parseFloat(bids[0][0]);
    const bestAsk = parseFloat(asks[0][0]);
    const midPrice = (bestBid + bestAsk) / 2;
    
    // Basic spread metrics
    const bidAskSpread = bestAsk - bestBid;
    const spreadPercentage = (bidAskSpread / midPrice) * 100;

    // Volume-weighted bid/ask calculation
    const calculateVWAP = (orders: [string, string][], depth: number = 10) => {
      const relevantOrders = orders.slice(0, depth);
      let totalValue = 0;
      let totalVolume = 0;
      
      relevantOrders.forEach(([price, qty]) => {
        const p = parseFloat(price);
        const q = parseFloat(qty);
        totalValue += p * q;
        totalVolume += q;
      });
      
      return totalVolume > 0 ? totalValue / totalVolume : 0;
    };

    const vwBid = calculateVWAP(bids);
    const vwAsk = calculateVWAP(asks);
    const volumeWeightedBidAsk = vwAsk - vwBid;

    // Order flow imbalance (OFI)
    const bidVolume5 = bids.slice(0, 5).reduce((sum: number, [_, qty]: [string, string]) => sum + parseFloat(qty), 0);
    const askVolume5 = asks.slice(0, 5).reduce((sum: number, [_, qty]: [string, string]) => sum + parseFloat(qty), 0);
    const orderFlowImbalance = (bidVolume5 - askVolume5) / (bidVolume5 + askVolume5) * 100;

    // Large order detection (orders > 2x average size)
    const allSizes = [...bids, ...asks].map(([_, qty]: [string, string]) => parseFloat(qty));
    const avgSize = allSizes.reduce((a: number, b: number) => a + b, 0) / allSizes.length;
    const largeOrdersDetected = allSizes.filter((size: number) => size > avgSize * 2).length;

    // Book pressure (weighted by distance from mid)
    let bidPressure = 0;
    let askPressure = 0;
    
    bids.slice(0, 10).forEach(([price, qty]: [string, string]) => {
      const distance = Math.abs(parseFloat(price) - midPrice);
      const weight = 1 / (1 + distance / midPrice);
      bidPressure += parseFloat(qty) * weight;
    });
    
    asks.slice(0, 10).forEach(([price, qty]: [string, string]) => {
      const distance = Math.abs(parseFloat(price) - midPrice);
      const weight = 1 / (1 + distance / midPrice);
      askPressure += parseFloat(qty) * weight;
    });
    
    const bookPressure = (bidPressure - askPressure) / (bidPressure + askPressure) * 100;

    // Book velocity (rate of change - simplified)
    const bookVelocity = Math.abs(orderFlowImbalance) * (1 + spreadPercentage);

    // Depth imbalance at multiple levels
    const calculateDepthImbalance = (depth: number) => {
      const bidDepth = bids.slice(0, depth).reduce((sum: number, [_, qty]: [string, string]) => sum + parseFloat(qty), 0);
      const askDepth = asks.slice(0, depth).reduce((sum: number, [_, qty]: [string, string]) => sum + parseFloat(qty), 0);
      return (bidDepth - askDepth) / (bidDepth + askDepth) * 100;
    };
    
    const depthImbalance = (calculateDepthImbalance(5) + calculateDepthImbalance(10) + calculateDepthImbalance(20)) / 3;

    // Liquidity score (combination of spread, depth, and stability)
    const totalLiquidity = bidVolume5 + askVolume5;
    const spreadScore = Math.max(0, 100 - spreadPercentage * 100);
    const depthScore = Math.min(100, totalLiquidity / 100);
    const stabilityScore = Math.max(0, 100 - Math.abs(orderFlowImbalance));
    const liquidityScore = (spreadScore * 0.3 + depthScore * 0.4 + stabilityScore * 0.3);

    return {
      bidAskSpread,
      spreadPercentage,
      orderFlowImbalance,
      volumeWeightedBidAsk,
      largeOrdersDetected,
      bookPressure,
      bookVelocity,
      depthImbalance,
      liquidityScore
    };
  }, [bids, asks]);

  // Update historical metrics
  useEffect(() => {
    const interval = setInterval(() => {
      setHistoricalMetrics(prev => {
        const newMetrics = [...prev, orderFlowMetrics];
        return newMetrics.slice(-50); // Keep last 50 data points
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [orderFlowMetrics]);

  // Volume profile calculation
  useEffect(() => {
    if (bids.length === 0 || asks.length === 0) return;

    const profile: VolumeProfile[] = [];
    const allPrices = [...bids, ...asks].map(([p, _]) => parseFloat(p));
    const minPrice = Math.min(...allPrices);
    const maxPrice = Math.max(...allPrices);
    const priceStep = (maxPrice - minPrice) / 20;

    for (let i = 0; i < 20; i++) {
      const priceLevel = minPrice + (priceStep * i);
      let buyVolume = 0;
      let sellVolume = 0;

      bids.forEach(([price, qty]: [string, string]) => {
        const p = parseFloat(price);
        if (Math.abs(p - priceLevel) < priceStep / 2) {
          buyVolume += parseFloat(qty);
        }
      });

      asks.forEach(([price, qty]: [string, string]) => {
        const p = parseFloat(price);
        if (Math.abs(p - priceLevel) < priceStep / 2) {
          sellVolume += parseFloat(qty);
        }
      });

      profile.push({
        price: priceLevel,
        volume: buyVolume + sellVolume,
        buyVolume,
        sellVolume,
        delta: buyVolume - sellVolume
      });
    }

    setVolumeProfile(profile);
  }, [bids, asks]);

  // Depth chart data
  const depthChartData = useMemo(() => {
    const bidData = processedOrderBook.bids.map(level => ({
      price: level.price,
      volume: level.cumulative,
      type: 'bid'
    }));

    const askData = processedOrderBook.asks.map(level => ({
      price: level.price,
      volume: level.cumulative,
      type: 'ask'
    }));

    return [...bidData.reverse(), ...askData];
  }, [processedOrderBook]);

  // Dynamic order size distribution with blue color theme
  const sizeDistribution = useMemo((): { range: string; count: number }[] => {
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

    const buckets: { range: string; count: number }[] = [];
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
      <div className="l2a-container">
        <div className="l2a-header">
          <h2>Level 2 Advanced Analysis</h2>
          <div className="l2a-status">
            <span className={`status-indicator ${regime?.name === 'volatile' ? 'volatile' : 'stable'}`}>
              {regime?.name?.toUpperCase() || 'ANALYZING'}
            </span>
          </div>
        </div>
        <div className="l2a-charts">
          <div className="chart-container" />
          <div className="chart-container" />
        </div>
      </div>
    );
  }

  return (
    <div className="l2a-container">
      {/* Header with key metrics */}
      <div className="l2a-header">
        <h2>Level 2 Advanced Analysis</h2>
        <div className="l2a-status">
          <span className={`status-indicator ${regime?.name === 'volatile' ? 'volatile' : 'stable'}`}>
            {regime?.name?.toUpperCase() || 'ANALYZING'}
          </span>
        </div>
      </div>

      {/* Key Metrics Grid */}
      <div className="l2a-metrics-grid">
        <div className="metric-card">
          <div className="metric-label">Bid/Ask Spread</div>
          <div className="metric-value">{orderFlowMetrics.bidAskSpread.toFixed(4)}</div>
          <div className="metric-subvalue">{orderFlowMetrics.spreadPercentage.toFixed(4)}%</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Order Flow Imbalance</div>
          <div className={`metric-value ${orderFlowMetrics.orderFlowImbalance > 0 ? 'positive' : 'negative'}`}>
            {orderFlowMetrics.orderFlowImbalance.toFixed(4)}%
          </div>
          <div className="metric-subvalue">{orderFlowMetrics.orderFlowImbalance > 0 ? 'Bid Heavy' : 'Ask Heavy'}</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Book Pressure</div>
          <div className={`metric-value ${orderFlowMetrics.bookPressure > 0 ? 'positive' : 'negative'}`}>
            {orderFlowMetrics.bookPressure.toFixed(4)}%
          </div>
          <div className="metric-subvalue">Weighted</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Liquidity Score</div>
          <div className="metric-value">{orderFlowMetrics.liquidityScore.toFixed(4)}</div>
          <div className="metric-subvalue">Raw Score</div>
        </div>
      </div>

      {/* Charts Section */}
      <div className="l2a-charts">
        {/* Depth Chart */}
        <div className="chart-container">
          <h3>Order Book Depth</h3>
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={depthChartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#333" />
              <XAxis dataKey="price" stroke="#888" />
              <YAxis stroke="#888" />
              <Tooltip 
                contentStyle={{ backgroundColor: '#1a1a1a', border: '1px solid #333' }}
                labelStyle={{ color: '#fff' }}
              />
              <Area 
                type="stepAfter" 
                dataKey="volume" 
                stroke="#00ff88"
                fill="rgba(0, 255, 136, 0.1)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Volume Profile */}
        <div className="chart-container">
          <h3>Volume Profile</h3>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={volumeProfile} layout="horizontal">
              <CartesianGrid strokeDasharray="3 3" stroke="#333" />
              <XAxis type="number" stroke="#888" />
              <YAxis dataKey="price" type="category" stroke="#888" />
              <Tooltip 
                contentStyle={{ backgroundColor: '#1a1a1a', border: '1px solid #333' }}
                labelStyle={{ color: '#fff' }}
              />
              <Bar dataKey="buyVolume" stackId="a" fill="rgba(0, 255, 136, 0.4)" />
              <Bar dataKey="sellVolume" stackId="a" fill="rgba(255, 68, 68, 0.4)" />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Order Flow Imbalance History */}
        <div className="chart-container">
          <h3>Order Flow Imbalance History</h3>
          <ResponsiveContainer width="100%" height={150}>
            <LineChart data={historicalMetrics}>
              <CartesianGrid strokeDasharray="3 3" stroke="#333" />
              <XAxis stroke="#888" />
              <YAxis stroke="#888" />
              <Tooltip 
                contentStyle={{ backgroundColor: '#1a1a1a', border: '1px solid #333' }}
                labelStyle={{ color: '#fff' }}
              />
              <Line 
                type="monotone" 
                dataKey="orderFlowImbalance" 
                stroke="#00ff88" 
                strokeWidth={2}
                dot={false}
              />
              <Line 
                type="monotone" 
                dataKey="bookPressure" 
                stroke="#ff8800" 
                strokeWidth={1}
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Size Distribution */}
        <div className="chart-container">
          <h3>Order Size Distribution</h3>
          <ResponsiveContainer width="100%" height={150}>
            <BarChart data={sizeDistribution}>
              <CartesianGrid strokeDasharray="3 3" stroke="#333" />
              <XAxis dataKey="range" stroke="#888" fontSize={10} />
              <YAxis stroke="#888" />
              <Tooltip 
                contentStyle={{ backgroundColor: '#1a1a1a', border: '1px solid #333' }}
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
        </div>
      </div>

      {/* Advanced Metrics Table */}
      <div className="l2a-advanced-metrics">
        <h3>Advanced Metrics</h3>
        <div className="metrics-table">
          <div className="metric-row">
            <span>Volume Weighted Spread</span>
            <span>{orderFlowMetrics.volumeWeightedBidAsk.toFixed(4)}</span>
          </div>
          <div className="metric-row">
            <span>Large Orders Detected</span>
            <span className={orderFlowMetrics.largeOrdersDetected > 5 ? 'alert' : ''}>
              {orderFlowMetrics.largeOrdersDetected}
            </span>
          </div>
          <div className="metric-row">
            <span>Book Velocity</span>
            <span>{orderFlowMetrics.bookVelocity.toFixed(4)}</span>
          </div>
          <div className="metric-row">
            <span>Depth Imbalance (5/10/20)</span>
            <span className={Math.abs(orderFlowMetrics.depthImbalance) > 20 ? 'alert' : ''}>
              {orderFlowMetrics.depthImbalance.toFixed(4)}%
            </span>
          </div>
        </div>
      </div>

      {/* Top Levels Summary */}
      <div className="l2a-top-levels">
        <div className="bid-levels">
          <h4>Top Bid Levels</h4>
          {processedOrderBook.bids.slice(0, 5).map((level, i) => (
            <div key={i} className="level-row">
              <span className="price">{level.price.toFixed(4)}</span>
              <span className="quantity">{level.quantity.toFixed(4)}</span>
              <div className="level-bar bid-bar" style={{ width: `${level.percentage}%` }} />
            </div>
          ))}
        </div>
        <div className="ask-levels">
          <h4>Top Ask Levels</h4>
          {processedOrderBook.asks.slice(0, 5).map((level, i) => (
            <div key={i} className="level-row">
              <span className="price">{level.price.toFixed(4)}</span>
              <span className="quantity">{level.quantity.toFixed(4)}</span>
              <div className="level-bar ask-bar" style={{ width: `${level.percentage}%` }} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default Level2Analysis;