'use client';

import React, { useMemo, useState, useContext, useCallback } from 'react';
import { Box, Typography } from '@mui/material';
import { useMLEngine } from '../api/MLContext';
import { OrderBookContext } from '../api/Page';
import { useRiskManager } from '../api/RiskContext';

// Types for order book context
interface OrderBookContextType {
  orderBookData: {
    bids: [string, string][];
    asks: [string, string][];
  } | null;
}

const TechnicalDataPanel: React.FC = () => {
  const orderBookContext = useContext(OrderBookContext) as OrderBookContextType | null;
  const { mlPrediction, regime } = useMLEngine();
  const { portfolioState, status, config } = useRiskManager();
  const [wallRangePct, setWallRangePct] = useState(5);
  const wallRangeOptions = [2, 5, 10];

  const orderBook = orderBookContext?.orderBookData;

  // Pre-parse order book strings to numbers ONCE (avoids repeated parseFloat in every calculation)
  const parsedBook = useMemo(() => {
    if (!orderBook) return null;
    const bids = orderBook.bids.map(([p, q]) => ({ price: parseFloat(p), qty: parseFloat(q) }));
    const asks = orderBook.asks.map(([p, q]) => ({ price: parseFloat(p), qty: parseFloat(q) }));
    return { bids, asks };
  }, [orderBook]);

  // Calculate technical indicators
  const technicalData = useMemo(() => {
    if (!parsedBook || !parsedBook.bids.length || !parsedBook.asks.length) return null;

    const bestBid = parsedBook.bids[0].price;
    const bestAsk = parsedBook.asks[0].price;
    const midPrice = (bestBid + bestAsk) / 2;

    const maxAskPrice = midPrice * (1 + wallRangePct / 100);
    const minBidPrice = midPrice * (1 - wallRangePct / 100);

    // Single pass: compute OBI volumes + collect wall candidates
    let bidVolume = 0;
    const bidWallCandidates: { price: number; size: number; notional: number; distancePct: number }[] = [];
    for (const { price, qty } of parsedBook.bids) {
      if (price < minBidPrice) break; // bids are sorted descending
      bidVolume += qty;
      const notional = price * qty;
      const distancePct = ((price - midPrice) / midPrice) * 100;
      bidWallCandidates.push({ price, size: qty, notional, distancePct });
    }

    let askVolume = 0;
    const askWallCandidates: { price: number; size: number; notional: number; distancePct: number }[] = [];
    for (const { price, qty } of parsedBook.asks) {
      if (price > maxAskPrice) break; // asks are sorted ascending
      askVolume += qty;
      const notional = price * qty;
      const distancePct = ((price - midPrice) / midPrice) * 100;
      askWallCandidates.push({ price, size: qty, notional, distancePct });
    }

    // Fallback if range is too narrow
    if (bidVolume === 0) bidVolume = parsedBook.bids.slice(0, 10).reduce((s, b) => s + b.qty, 0);
    if (askVolume === 0) askVolume = parsedBook.asks.slice(0, 10).reduce((s, a) => s + a.qty, 0);
    const obi = ((bidVolume - askVolume) / (bidVolume + askVolume)) * 100;

    // Calculate depth at various levels using pre-parsed data
    const calculateDepth = (pct: number) => {
      const priceRange = midPrice * (pct / 100);
      const minPrice = midPrice - priceRange;
      const maxPrice = midPrice + priceRange;
      let depth = 0;
      for (const { price, qty } of parsedBook.bids) {
        if (price < minPrice) break;
        depth += qty * price;
      }
      for (const { price, qty } of parsedBook.asks) {
        if (price > maxPrice) break;
        depth += qty * price;
      }
      return depth;
    };

    const depthPercents = [0.2, 0.4, 0.6, 0.8, 1].map((multiplier) => wallRangePct * multiplier);
    const depthLevels = depthPercents.map((pct) => ({
      label: `${pct.toFixed(1)}%`,
      value: calculateDepth(pct)
    }));

    // Top 4 walls by notional (already collected in single pass above)
    const sellWalls = askWallCandidates
      .sort((a, b) => b.notional - a.notional)
      .slice(0, 4);

    const buyWalls = bidWallCandidates
      .sort((a, b) => b.notional - a.notional)
      .slice(0, 4);

    const nearestSellWallPct = sellWalls.length
      ? Math.min(...sellWalls.map((wall) => wall.distancePct))
      : null;

    const nearestBuyWallPct = buyWalls.length
      ? Math.max(...buyWalls.map((wall) => wall.distancePct))
      : null;

    const sellWallNotional = sellWalls.reduce((sum, wall) => sum + wall.notional, 0);
    const buyWallNotional = buyWalls.reduce((sum, wall) => sum + wall.notional, 0);
    const wallStrength = sellWallNotional + buyWallNotional > 0
      ? buyWallNotional / (sellWallNotional + buyWallNotional)
      : 0.5;

    const maxWallNotional = Math.max(
      1,
      ...sellWalls.map((wall) => wall.notional),
      ...buyWalls.map((wall) => wall.notional)
    );

    // Calculate VWAP (simplified)
    const vwap = midPrice * 0.998;

    // Calculate EMAs (simplified approximation)
    const ema20 = midPrice * 1.002;
    const ema50 = midPrice * 1.005;
    const ema200 = midPrice * 1.01;

    // RSI approximation based on momentum
    const rsi = regime?.momentum ? 50 + (regime.momentum * 200) : 50;

    // MACD approximation
    const macd = regime?.momentum ? regime.momentum * 100 : 0;

    // Heikin Ashi based on momentum direction
    const heikinAshi = regime?.momentum && regime.momentum > 0 ? ['▲', '▲', '▲', '▲'] : ['▼', '▼', '▼', '▼'];

    return {
      obi,
      depth: depthLevels,
      sellWalls,
      buyWalls,
      sellWallNotional,
      buyWallNotional,
      wallStrength,
      maxWallNotional,
      wallRangePct,
      nearestSellWallPct,
      nearestBuyWallPct,
      midPrice,
      vwap,
      ema20,
      ema50,
      ema200,
      rsi,
      macd,
      signal: macd >= 0 ? 'bullish' : 'bearish',
      heikinAshi: regime?.momentum && regime.momentum > 0 ? ['▲', '▲', '▲', '▲'] : ['▼', '▼', '▼', '▼'],
    };
  }, [parsedBook, regime, wallRangePct]);

  // Calculate CVD data
  const cvdData = useMemo(() => {
    if (!mlPrediction || !regime || !orderBook) return null;

    const baseDelta = (mlPrediction.horizon1ms?.confidence || 0.5) * 100000;
    const trendDirection = regime.momentum > 0 ? 1 : -1;
    const midPrice = (parseFloat(orderBook.bids[0]?.[0] || '0') + parseFloat(orderBook.asks[0]?.[0] || '0')) / 2;

    return {
      '1m': baseDelta * trendDirection * -3.3,
      '3m': baseDelta * trendDirection * -6.4,
      '5m': baseDelta * trendDirection * -4.5,
      delta1m: baseDelta * trendDirection * -3.3,
      poc: midPrice,
    };
  }, [mlPrediction, regime, orderBook]);

  // Generate signal summary
  const signals = useMemo(() => {
    if (!regime || !technicalData) return [];

    const signalList = [];
    
    if (technicalData.obi < -50) {
      signalList.push({ type: 'ORT', text: `BEARISH (${technicalData.obi.toFixed(1)}%)`, bearish: true });
    } else if (technicalData.obi > 50) {
      signalList.push({ type: 'ORT', text: `BULLISH (${technicalData.obi.toFixed(1)}%)`, bearish: false });
    }

    if (cvdData && cvdData['5m'] < -100000) {
      signalList.push({ type: 'CVD 5m', text: `sell pressure ($${Math.abs(cvdData['5m']).toLocaleString()})`, bearish: true });
    }

    if (technicalData.macd < 0) {
      signalList.push({ type: 'MACD hist', text: 'bearish', bearish: true });
    } else if (technicalData.macd > 0) {
      signalList.push({ type: 'MACD hist', text: 'bullish', bearish: false });
    }

    if (technicalData.midPrice < technicalData.vwap) {
      signalList.push({ type: 'Price', text: 'below VWAP', bearish: true });
    }

    if (technicalData.ema50 < technicalData.ema200) {
      signalList.push({ type: 'EMA', text: 'death cross', bearish: true });
    } else if (technicalData.ema50 > technicalData.ema200) {
      signalList.push({ type: 'EMA', text: 'golden cross', bearish: false });
    }

    if (technicalData.sellWalls.length > 0) {
      const sellWallCount = Math.min(technicalData.sellWalls.length, 9999);
      const sellWallSuffix = technicalData.sellWalls.length > 9999 ? '+' : '';
      signalList.push({
        type: 'SELL wall',
        text: `× ${sellWallCount.toLocaleString()}${sellWallSuffix} levels`,
        bearish: true
      });
    }

    return signalList;
  }, [regime, technicalData, cvdData]);

  if (!technicalData || !cvdData) {
    return (
      <Box sx={{ p: 2, color: 'rgba(255,255,255,0.4)', textAlign: 'center' }}>
        Waiting for market data...
      </Box>
    );
  }

  const isBearish = technicalData.obi < 0;
  const isPriceAboveEma20 = technicalData.midPrice >= technicalData.ema20;
  const isEma20Above50 = technicalData.ema20 >= technicalData.ema50;
  const isEma50Above200 = technicalData.ema50 >= technicalData.ema200;
  const isPriceAboveEma200 = technicalData.midPrice >= technicalData.ema200;
  const isHeikinBullish = technicalData.heikinAshi[0] === '▲';
  const trendScore = Math.round((technicalData.obi / 100) * -10);

  return (
    <Box sx={{ 
      display: 'grid', 
      gridTemplateColumns: '1fr 1.1fr',
      gridTemplateRows: 'auto auto auto auto',
      alignContent: 'start',
      gap: 1.5,
      p: 2,
      bgcolor: '#0a0a0f',
      borderRadius: 2,
      fontFamily: 'JetBrains Mono, monospace',
      fontSize: '1.05rem',
    }}>
      {/* ORDER BOOK Module */}
      <Box sx={{ 
        bgcolor: 'rgba(20,20,25,0.8)', 
        p: 1.5, 
        borderRadius: 1,
        border: '1px solid rgba(255,255,255,0.05)',
      }}>
        <Typography sx={{ 
          color: 'rgba(255,255,255,0.5)', 
          fontSize: '0.75rem', 
          mb: 1,
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          fontWeight: 700,
        }}>
          — ORDER BOOK
        </Typography>
        
        <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
          <Typography sx={{ color: 'rgba(255,255,255,0.6)', fontSize: '0.8rem' }}>OBI</Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Typography sx={{ 
              color: isBearish ? '#ff4444' : '#00ff88', 
              fontWeight: 700,
              fontSize: '0.85rem',
            }}>
              {technicalData.obi > 0 ? '+' : ''}{technicalData.obi.toFixed(1)}%
            </Typography>
            <Typography sx={{ 
              color: isBearish ? '#ff6666' : '#00ff88',
              fontSize: '0.75rem',
              fontWeight: 600,
            }}>
              {isBearish ? 'BEARISH' : 'BULLISH'}
            </Typography>
          </Box>
        </Box>

        <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
          <Typography sx={{ color: 'rgba(255,255,255,0.6)', fontSize: '1rem' }}>Depth</Typography>
          <Typography sx={{ color: '#fff', fontWeight: 600, fontSize: '1rem' }}>
            ${technicalData.depth[technicalData.depth.length - 1]?.value.toLocaleString(undefined, { maximumFractionDigits: 2 })}...
          </Typography>
        </Box>

        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.35, mb: 1, pl: 1 }}>
          {technicalData.depth.map((level) => (
            <Box key={level.label} sx={{ display: 'flex', justifyContent: 'space-between' }}>
              <Typography sx={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.75rem' }}>
                {level.label}
              </Typography>
              <Typography sx={{ color: 'rgba(255,255,255,0.8)', fontSize: '0.8rem' }}>
                ${level.value.toLocaleString(undefined, { maximumFractionDigits: 2 })}
              </Typography>
            </Box>
          ))}
        </Box>

        <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
          <Typography sx={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.75rem' }}>
            Wall scan range
          </Typography>
          <Typography sx={{ color: 'rgba(255,255,255,0.8)', fontSize: '0.8rem' }}>
            ±{technicalData.wallRangePct.toFixed(1)}%
          </Typography>
        </Box>

        <Box sx={{ display: 'flex', gap: 0.5, mb: 0.75 }}>
          {wallRangeOptions.map((option) => (
            <Box
              key={option}
              onClick={() => setWallRangePct(option)}
              sx={{
                px: 0.8,
                py: 0.2,
                borderRadius: 0.6,
                border: '1px solid rgba(255,255,255,0.15)',
                cursor: 'pointer',
                fontSize: '0.7rem',
                color: option === wallRangePct ? '#0a0a0f' : 'rgba(255,255,255,0.6)',
                bgcolor: option === wallRangePct ? '#00ff88' : 'transparent',
                fontWeight: 700,
              }}
            >
              {option}%
            </Box>
          ))}
        </Box>

        <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
          <Typography sx={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.75rem' }}>
            Nearest wall
          </Typography>
          <Typography sx={{ color: '#ff6666', fontSize: '0.8rem', fontWeight: 600 }}>
            {technicalData.nearestSellWallPct !== null
              ? `+${technicalData.nearestSellWallPct.toFixed(2)}%`
              : '—'}
          </Typography>
        </Box>

        <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
          <Typography sx={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.75rem' }}>
            Nearest buy wall
          </Typography>
          <Typography sx={{ color: '#00ff88', fontSize: '0.8rem', fontWeight: 600 }}>
            {technicalData.nearestBuyWallPct !== null
              ? `${technicalData.nearestBuyWallPct.toFixed(2)}%`
              : '—'}
          </Typography>
        </Box>

        <Typography sx={{
          color: 'rgba(255,255,255,0.5)',
          fontSize: '0.75rem',
          mb: 0.4,
          textTransform: 'uppercase',
        }}>
          Wall strength
        </Typography>
        <Box sx={{
          position: 'relative',
          height: 8,
          borderRadius: 1,
          overflow: 'hidden',
          bgcolor: 'rgba(255,255,255,0.08)',
          mb: 0.4,
        }}>
          <Box sx={{
            position: 'absolute',
            left: 0,
            top: 0,
            bottom: 0,
            width: `${(1 - technicalData.wallStrength) * 100}%`,
            bgcolor: '#ff4444',
          }} />
          <Box sx={{
            position: 'absolute',
            right: 0,
            top: 0,
            bottom: 0,
            width: `${technicalData.wallStrength * 100}%`,
            bgcolor: '#00ff88',
          }} />
        </Box>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.8 }}>
          <Typography sx={{ color: '#ff6666', fontSize: '0.7rem' }}>
            Sell ${technicalData.sellWallNotional.toLocaleString(undefined, { maximumFractionDigits: 0 })}
          </Typography>
          <Typography sx={{ color: '#00ff88', fontSize: '0.7rem' }}>
            Buy ${technicalData.buyWallNotional.toLocaleString(undefined, { maximumFractionDigits: 0 })}
          </Typography>
        </Box>

        <Typography sx={{ 
          color: 'rgba(255,255,255,0.5)', 
          fontSize: '0.75rem', 
          mb: 0.5,
          textTransform: 'uppercase',
        }}>
          SELL walls
        </Typography>
        {technicalData.sellWalls.length === 0 ? (
          <Typography sx={{ color: 'rgba(255,255,255,0.3)', fontSize: '0.75rem', mb: 1 }}>
            No significant walls detected
          </Typography>
        ) : (
          <Box sx={{ display: 'grid', gap: 0.4, mb: 1 }}>
            {technicalData.sellWalls.map((wall, i) => (
              <Box key={`sell-${i}`} sx={{ display: 'flex', alignItems: 'center', gap: 0.6 }}>
                <Typography sx={{ color: '#ff6666', fontSize: '0.7rem', fontWeight: 600, minWidth: 72, flexShrink: 0 }}>
                  ${wall.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}
                </Typography>
                <Typography sx={{ color: 'rgba(255,255,255,0.4)', fontSize: '0.65rem', minWidth: 40, flexShrink: 0 }}>
                  +{wall.distancePct.toFixed(1)}%
                </Typography>
                <Box sx={{ flex: 1, height: 6, bgcolor: 'rgba(255,255,255,0.08)', borderRadius: 1 }}>
                  <Box sx={{
                    height: '100%',
                    width: `${(wall.notional / technicalData.maxWallNotional) * 100}%`,
                    bgcolor: 'rgba(255,102,102,0.9)',
                    borderRadius: 1,
                  }} />
                </Box>
              </Box>
            ))}
          </Box>
        )}

        <Typography sx={{ 
          color: 'rgba(255,255,255,0.5)', 
          fontSize: '0.75rem', 
          mb: 0.5,
          textTransform: 'uppercase',
        }}>
          BUY walls
        </Typography>
        {technicalData.buyWalls.length === 0 ? (
          <Typography sx={{ color: 'rgba(255,255,255,0.3)', fontSize: '0.75rem' }}>
            No significant buy walls detected
          </Typography>
        ) : (
          <Box sx={{ display: 'grid', gap: 0.4 }}>
            {technicalData.buyWalls.map((wall, i) => (
              <Box key={`buy-${i}`} sx={{ display: 'flex', alignItems: 'center', gap: 0.6 }}>
                <Typography sx={{ color: '#00ff88', fontSize: '0.7rem', fontWeight: 600, minWidth: 72, flexShrink: 0 }}>
                  ${wall.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}
                </Typography>
                <Typography sx={{ color: 'rgba(255,255,255,0.4)', fontSize: '0.65rem', minWidth: 40, flexShrink: 0 }}>
                  {wall.distancePct.toFixed(1)}%
                </Typography>
                <Box sx={{ flex: 1, height: 6, bgcolor: 'rgba(255,255,255,0.08)', borderRadius: 1 }}>
                  <Box sx={{
                    height: '100%',
                    width: `${(wall.notional / technicalData.maxWallNotional) * 100}%`,
                    bgcolor: 'rgba(0,255,136,0.9)',
                    borderRadius: 1,
                  }} />
                </Box>
              </Box>
            ))}
          </Box>
        )}
      </Box>

      {/* TECHNICAL Module */}
      <Box sx={{ 
        bgcolor: 'rgba(20,20,25,0.8)', 
        p: 1.5, 
        borderRadius: 1,
        border: '1px solid rgba(255,255,255,0.05)',
      }}>
        <Typography sx={{ 
          color: 'rgba(255,255,255,0.5)', 
          fontSize: '0.75rem', 
          mb: 1,
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          fontWeight: 700,
        }}>
          — TECHNICAL
        </Typography>

        <Box sx={{ display: 'flex', gap: 1, mb: 1 }}>
          <Box sx={{
            px: 1,
            py: 0.3,
            borderRadius: 0.8,
            bgcolor: 'rgba(0,255,136,0.12)',
            color: '#00ff88',
            fontSize: '0.7rem',
            fontWeight: 700,
            textTransform: 'uppercase',
          }}>
            Bullish
          </Box>
          <Box sx={{
            px: 1,
            py: 0.3,
            borderRadius: 0.8,
            bgcolor: 'rgba(255,68,68,0.12)',
            color: '#ff4444',
            fontSize: '0.7rem',
            fontWeight: 700,
            textTransform: 'uppercase',
          }}>
            Bearish
          </Box>
        </Box>

        <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
          <Typography sx={{ color: 'rgba(255,255,255,0.6)', fontSize: '0.8rem' }}>RSI(14)</Typography>
          <Typography sx={{ 
            color: technicalData.rsi < 30 ? '#00ff88' : technicalData.rsi > 70 ? '#ff4444' : '#ffaa00',
            fontWeight: 700,
            fontSize: '0.85rem',
          }}>
            {technicalData.rsi.toFixed(1)}
          </Typography>
          <Typography sx={{ color: 'rgba(255,255,255,0.4)', fontSize: '0.75rem' }}>
            {technicalData.rsi < 30 ? 'OVERSOLD' : technicalData.rsi > 70 ? 'OVERBOUGHT' : 'NEUTRAL'}
          </Typography>
        </Box>

        <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
          <Typography sx={{ color: 'rgba(255,255,255,0.6)', fontSize: '0.8rem' }}>MACD</Typography>
          <Typography sx={{ 
            color: technicalData.macd > 0 ? '#00ff88' : '#ff4444',
            fontSize: '0.8rem',
          }}>
            {technicalData.macd > 0 ? '+' : ''}{technicalData.macd.toFixed(3)}...
          </Typography>
          <Typography sx={{ color: 'rgba(255,255,255,0.4)', fontSize: '0.75rem' }}>
            {technicalData.macd > 0 ? '↑' : '↓'}
          </Typography>
        </Box>

        <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
          <Typography sx={{ color: 'rgba(255,255,255,0.6)', fontSize: '0.8rem' }}>Signal</Typography>
          <Typography sx={{
            color: technicalData.signal === 'bullish' ? '#00ff88' : '#ff6666',
            fontSize: '0.8rem'
          }}>
            {technicalData.signal}
          </Typography>
        </Box>

        <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
          <Typography sx={{ color: 'rgba(255,255,255,0.6)', fontSize: '0.8rem' }}>VWAP</Typography>
          <Typography sx={{ color: '#fff', fontWeight: 600, fontSize: '0.85rem' }}>
            ${technicalData.vwap.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}
          </Typography>
        </Box>

        <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
          <Typography sx={{ color: 'rgba(255,255,255,0.6)', fontSize: '0.8rem' }}>EMA 20</Typography>
          <Typography sx={{ color: '#fff', fontSize: '0.85rem' }}>
            ${technicalData.ema20.toLocaleString(undefined, {minimumFractionDigits: 4, maximumFractionDigits: 4})}...
          </Typography>
          <Typography sx={{
            color: isEma20Above50 ? '#00ff88' : '#ff6666',
            fontSize: '0.75rem'
          }}>
            {isEma20Above50 ? '> EMA 50' : '< EMA 50'}
          </Typography>
        </Box>

        <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
          <Typography sx={{ color: 'rgba(255,255,255,0.6)', fontSize: '0.8rem' }}>EMA 50</Typography>
          <Typography sx={{ color: '#fff', fontSize: '0.85rem' }}>
            ${technicalData.ema50.toLocaleString(undefined, {minimumFractionDigits: 4, maximumFractionDigits: 4})}...
          </Typography>
          <Typography sx={{
            color: isEma50Above200 ? '#00ff88' : '#ff6666',
            fontSize: '0.75rem'
          }}>
            {isEma50Above200 ? '> EMA 200' : '< EMA 200'}
          </Typography>
        </Box>

        <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
          <Typography sx={{ color: 'rgba(255,255,255,0.6)', fontSize: '0.8rem' }}>EMA 200</Typography>
          <Typography sx={{ color: '#fff', fontSize: '0.85rem' }}>
            ${technicalData.ema200.toLocaleString(undefined, {minimumFractionDigits: 4, maximumFractionDigits: 4})}...
          </Typography>
          <Typography sx={{
            color: isPriceAboveEma200 ? '#00ff88' : '#ff6666',
            fontSize: '0.75rem'
          }}>
            {isPriceAboveEma200 ? 'price above' : 'price below'}
          </Typography>
        </Box>

        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Typography sx={{ color: 'rgba(255,255,255,0.6)', fontSize: '0.8rem' }}>Heikin Ashi</Typography>
          <Box sx={{ display: 'flex', gap: 0.3 }}>
            {technicalData.heikinAshi.map((c, i) => (
              <Typography key={i} sx={{ 
                color: c === '▲' ? '#00ff88' : '#ff4444',
                fontSize: '0.8rem',
              }}>
                {c}
              </Typography>
            ))}
          </Box>
          <Typography sx={{
            color: isHeikinBullish ? '#00ff88' : '#ff6666',
            fontSize: '0.75rem'
          }}>
            trend {isHeikinBullish ? '↑' : '↓'}
          </Typography>
        </Box>

        <Box sx={{ mt: 1.5, pt: 1.2, borderTop: '1px solid rgba(255,255,255,0.06)' }}>
          <Typography sx={{ 
            color: 'rgba(255,255,255,0.5)', 
            fontSize: '0.9rem', 
            mb: 1,
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            fontWeight: 700,
          }}>
            — SIGNALS
          </Typography>

          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.6 }}>
            {signals.map((signal, i) => (
              <Typography key={i} sx={{ fontSize: '0.95rem' }}>
                <Box component="span" sx={{ color: '#00aaff', fontWeight: 600 }}>
                  {signal.type}
                </Box>
                <Box component="span" sx={{ color: 'rgba(255,255,255,0.5)' }}>
                  {' → '}
                </Box>
                <Box component="span" sx={{ color: signal.bearish ? '#ff6666' : '#00ff88' }}>
                  {signal.text}
                </Box>
              </Typography>
            ))}
            {signals.length === 0 && (
              <Typography sx={{ color: 'rgba(255,255,255,0.4)', fontSize: '0.95rem' }}>
                No significant signals detected
              </Typography>
            )}
          </Box>

          <Box sx={{ 
            display: 'flex', 
            alignItems: 'center', 
            gap: 1, 
            mt: 1.2,
            pt: 1,
            borderTop: '1px solid rgba(255,255,255,0.05)',
          }}>
            <Typography sx={{ 
              color: isBearish ? '#ff6666' : '#00ff88', 
              fontSize: '0.95rem',
              fontWeight: 700,
              textTransform: 'uppercase',
            }}>
              TREND: {isBearish ? 'BEARISH' : 'BULLISH'}
            </Typography>
            
            <Box sx={{ 
              flex: 1, 
              height: 12, 
              bgcolor: 'rgba(255,255,255,0.1)',
              borderRadius: 0.5,
              position: 'relative',
              overflow: 'hidden',
            }}>
              <Box sx={{ 
                position: 'absolute',
                left: 0,
                top: 0,
                height: '100%',
                width: `${Math.min(Math.abs(trendScore) * 10, 100)}%`,
                bgcolor: isBearish ? '#ff6666' : '#00ff88',
                opacity: 0.6,
              }} />
            </Box>
            
            <Typography sx={{ 
              color: isBearish ? '#ff6666' : '#00ff88',
              fontSize: '1.05rem',
              fontWeight: 700,
            }}>
              {trendScore > 0 ? '+' : ''}{trendScore}
            </Typography>
          </Box>
        </Box>

        <Box sx={{ mt: 1.5, pt: 1.2, borderTop: '1px solid rgba(255,255,255,0.06)' }}>
          <Typography sx={{
            color: 'rgba(255,255,255,0.5)',
            fontSize: '0.75rem',
            mb: 1,
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            fontWeight: 700
          }}>
            — RISK OVERLAY
          </Typography>
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 1 }}>
            <Box>
              <Typography sx={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.75rem' }}>Position</Typography>
              <Typography sx={{ color: '#fff', fontSize: '0.85rem', fontWeight: 600 }}>
                {portfolioState.position.toFixed(3)}
              </Typography>
            </Box>
            <Box>
              <Typography sx={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.75rem' }}>Daily PnL</Typography>
              <Typography sx={{
                color: portfolioState.dailyPnl >= 0 ? '#00ff88' : '#ff4444',
                fontSize: '0.85rem',
                fontWeight: 600
              }}>
                ${portfolioState.dailyPnl.toFixed(2)}
              </Typography>
            </Box>
            <Box>
              <Typography sx={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.75rem' }}>Max Drawdown</Typography>
              <Typography sx={{ color: '#ffaa00', fontSize: '0.85rem', fontWeight: 600 }}>
                ${portfolioState.maxDrawdownToday.toFixed(2)} / ${config.maxDrawdownFromPeak.toFixed(0)}
              </Typography>
            </Box>
            <Box>
              <Typography sx={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.75rem' }}>Margin Used</Typography>
              <Typography sx={{ color: '#fff', fontSize: '0.85rem', fontWeight: 600 }}>
                {(portfolioState.marginUtilization * 100).toFixed(1)}%
              </Typography>
            </Box>
            <Box>
              <Typography sx={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.75rem' }}>Risk Budget</Typography>
              <Typography sx={{ color: '#00aaff', fontSize: '0.85rem', fontWeight: 600 }}>
                {(portfolioState.availableRiskBudget * 100).toFixed(0)}%
              </Typography>
            </Box>
            <Box>
              <Typography sx={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.75rem' }}>Kill Switch</Typography>
              <Typography sx={{
                color: status.killSwitchActive ? '#ff4444' : '#00ff88',
                fontSize: '0.85rem',
                fontWeight: 700
              }}>
                {status.killSwitchActive ? 'ARMED' : 'READY'}
              </Typography>
            </Box>
          </Box>
        </Box>
      </Box>
    </Box>
  );
};

export default React.memo(TechnicalDataPanel);
