'use client';

import React, { useEffect, useRef, useCallback } from 'react';
import { Box, Typography } from '@mui/material';
import { ECAM } from './ecamTheme';
import type { TechnicalState, BollingerBandsState } from '../TradingEngine/TechnicalIndicators';
import type { LinRegState } from '../TradingEngine/LinearRegressionTarget';
import type { RadarVectorState } from '../TradingEngine/RadarVector';
import type { BotPortfolio } from '@stores/tradingStore';

// ─── Lazy-load lightweight-charts to avoid SSR issues ────────────────────────
type LWC = typeof import('lightweight-charts');
let lwcPromise: Promise<LWC> | null = null;
function getLWC(): Promise<LWC> {
  if (!lwcPromise) {
    lwcPromise = import('lightweight-charts');
  }
  return lwcPromise;
}

// ─── Props ───────────────────────────────────────────────────────────────────

interface TradingViewChartProps {
  currentPrice?: number;
  technicals?: TechnicalState | null;
  linReg?: LinRegState | null;
  radarVector?: RadarVectorState | null;
  bollingerBands?: BollingerBandsState | null;
  botPortfolio?: BotPortfolio | null;
}

// ─── Color Theme ─────────────────────────────────────────────────────────────

const CHART_COLORS = {
  bg: '#0a0a14',
  grid: 'rgba(255,255,255,0.03)',
  text: 'rgba(255,255,255,0.4)',
  price: '#00ddff',
  bbUpper: 'rgba(255,170,0,0.4)',
  bbLower: 'rgba(255,170,0,0.4)',
  bbFill: 'rgba(255,170,0,0.05)',
  equityLine: '#00ff88',
  pnlPos: 'rgba(0,255,136,0.6)',
  pnlNeg: 'rgba(255,34,34,0.6)',
  buyMarker: '#00ff88',
  sellMarker: '#ff2222',
  bbMiddle: 'rgba(255,170,0,0.6)',
  linRegTarget: 'rgba(255,0,255,0.5)',
  linRegUpper: 'rgba(255,0,255,0.15)',
  linRegLower: 'rgba(255,0,255,0.15)',
  rsiLine: '#00ddff',
  rsiOB: 'rgba(255,0,0,0.3)',
  rsiOS: 'rgba(0,255,0,0.3)',
  macdLine: '#00ddff',
  macdSignal: '#ff8800',
  macdHistPos: 'rgba(0,255,136,0.5)',
  macdHistNeg: 'rgba(255,34,34,0.5)',
  stochK: '#00ddff',
  stochD: '#ff8800',
  volume: 'rgba(255,255,255,0.08)',
};

const MAX_POINTS = 300;

// ─── Component ───────────────────────────────────────────────────────────────

const TradingViewChart: React.FC<TradingViewChartProps> = ({
  currentPrice,
  technicals,
  linReg,
  radarVector,
  bollingerBands,
  botPortfolio,
}) => {
  const mainChartRef = useRef<HTMLDivElement>(null);
  const rsiChartRef = useRef<HTMLDivElement>(null);
  const macdChartRef = useRef<HTMLDivElement>(null);
  const equityChartRef = useRef<HTMLDivElement>(null);

  // Store chart & series instances
  const mainChartInstance = useRef<any>(null);
  const rsiChartInstance = useRef<any>(null);
  const macdChartInstance = useRef<any>(null);

  const priceSeriesRef = useRef<any>(null);
  const bbUpperRef = useRef<any>(null);
  const bbLowerRef = useRef<any>(null);
  const bbMiddleRef = useRef<any>(null);
  const lrTargetRef = useRef<any>(null);

  const rsiSeriesRef = useRef<any>(null);
  const rsiOBRef = useRef<any>(null);
  const rsiOSRef = useRef<any>(null);

  const macdLineRef = useRef<any>(null);
  const macdSignalRef = useRef<any>(null);
  const macdHistRef = useRef<any>(null);

  const equityChartInstance = useRef<any>(null);
  const equitySeriesRef = useRef<any>(null);
  const pnlHistRef = useRef<any>(null);

  const lastTradeCountRef = useRef<number>(0);
  const tickCountRef = useRef<number>(0);
  const initRef = useRef<boolean>(false);

  // ─── Initialize charts ────────────────────────────────────────────────
  useEffect(() => {
    if (initRef.current) return;
    if (!mainChartRef.current || !rsiChartRef.current || !macdChartRef.current) return;

    initRef.current = true;

    getLWC().then((lwc) => {
      const { createChart, ColorType, LineStyle, CrosshairMode } = lwc;

      const commonOpts = {
        layout: {
          background: { type: ColorType.Solid, color: CHART_COLORS.bg },
          textColor: CHART_COLORS.text,
          fontFamily: 'monospace',
          fontSize: 10,
        },
        grid: {
          vertLines: { color: CHART_COLORS.grid },
          horzLines: { color: CHART_COLORS.grid },
        },
        crosshair: { mode: CrosshairMode.Normal },
        rightPriceScale: {
          borderColor: 'rgba(255,255,255,0.08)',
          scaleMargins: { top: 0.05, bottom: 0.05 },
        },
        timeScale: {
          borderColor: 'rgba(255,255,255,0.08)',
          timeVisible: true,
          secondsVisible: false,
        },
        handleScroll: { mouseWheel: true, pressedMouseMove: true },
        handleScale: { mouseWheel: true, pinch: true },
      };

      // ─── Main price chart ─────────────────────────────────────────
      const mainChart = createChart(mainChartRef.current!, {
        ...commonOpts,
        width: mainChartRef.current!.clientWidth,
        height: 260,
      });
      mainChartInstance.current = mainChart;

      // Price line
      priceSeriesRef.current = mainChart.addLineSeries({
        color: CHART_COLORS.price,
        lineWidth: 2,
        priceLineVisible: true,
        lastValueVisible: true,
      });

      // Bollinger Bands
      bbUpperRef.current = mainChart.addLineSeries({
        color: CHART_COLORS.bbUpper,
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        priceLineVisible: false,
        lastValueVisible: false,
      });
      bbLowerRef.current = mainChart.addLineSeries({
        color: CHART_COLORS.bbLower,
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        priceLineVisible: false,
        lastValueVisible: false,
      });
      bbMiddleRef.current = mainChart.addLineSeries({
        color: CHART_COLORS.bbMiddle,
        lineWidth: 1,
        lineStyle: LineStyle.Dotted,
        priceLineVisible: false,
        lastValueVisible: false,
      });

      // LinReg target
      lrTargetRef.current = mainChart.addLineSeries({
        color: CHART_COLORS.linRegTarget,
        lineWidth: 1,
        lineStyle: LineStyle.SparseDotted,
        priceLineVisible: false,
        lastValueVisible: false,
      });

      // ─── Equity / P&L chart ─────────────────────────────────────────
      if (equityChartRef.current) {
        const equityChart = createChart(equityChartRef.current, {
          ...commonOpts,
          width: equityChartRef.current.clientWidth,
          height: 90,
          rightPriceScale: {
            ...commonOpts.rightPriceScale,
            scaleMargins: { top: 0.1, bottom: 0.1 },
          },
        });
        equityChartInstance.current = equityChart;

        equitySeriesRef.current = equityChart.addLineSeries({
          color: CHART_COLORS.equityLine,
          lineWidth: 2,
          priceLineVisible: true,
          lastValueVisible: true,
        });

        pnlHistRef.current = equityChart.addHistogramSeries({
          priceLineVisible: false,
          lastValueVisible: false,
        });
      }

      // ─── RSI chart ────────────────────────────────────────────────
      const rsiChart = createChart(rsiChartRef.current!, {
        ...commonOpts,
        width: rsiChartRef.current!.clientWidth,
        height: 80,
        rightPriceScale: {
          ...commonOpts.rightPriceScale,
          scaleMargins: { top: 0.1, bottom: 0.1 },
        },
      });
      rsiChartInstance.current = rsiChart;

      rsiSeriesRef.current = rsiChart.addLineSeries({
        color: CHART_COLORS.rsiLine,
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: true,
      });

      // RSI overbought/oversold reference lines
      rsiOBRef.current = rsiChart.addLineSeries({
        color: CHART_COLORS.rsiOB,
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        priceLineVisible: false,
        lastValueVisible: false,
      });
      rsiOSRef.current = rsiChart.addLineSeries({
        color: CHART_COLORS.rsiOS,
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        priceLineVisible: false,
        lastValueVisible: false,
      });

      // ─── MACD chart ───────────────────────────────────────────────
      const macdChart = createChart(macdChartRef.current!, {
        ...commonOpts,
        width: macdChartRef.current!.clientWidth,
        height: 80,
        rightPriceScale: {
          ...commonOpts.rightPriceScale,
          scaleMargins: { top: 0.15, bottom: 0.15 },
        },
      });
      macdChartInstance.current = macdChart;

      macdLineRef.current = macdChart.addLineSeries({
        color: CHART_COLORS.macdLine,
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: true,
      });
      macdSignalRef.current = macdChart.addLineSeries({
        color: CHART_COLORS.macdSignal,
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
      });
      macdHistRef.current = macdChart.addHistogramSeries({
        priceLineVisible: false,
        lastValueVisible: false,
      });

      // Sync crosshairs
      mainChart.timeScale().subscribeVisibleLogicalRangeChange((range: any) => {
        if (range) {
          rsiChart.timeScale().setVisibleLogicalRange(range);
          macdChart.timeScale().setVisibleLogicalRange(range);
          equityChartInstance.current?.timeScale().setVisibleLogicalRange(range);
        }
      });

      // Handle resize
      const resizeObserver = new ResizeObserver(() => {
        if (mainChartRef.current) {
          mainChart.applyOptions({ width: mainChartRef.current.clientWidth });
        }
        if (rsiChartRef.current) {
          rsiChart.applyOptions({ width: rsiChartRef.current.clientWidth });
        }
        if (macdChartRef.current) {
          macdChart.applyOptions({ width: macdChartRef.current.clientWidth });
        }
        if (equityChartRef.current && equityChartInstance.current) {
          equityChartInstance.current.applyOptions({ width: equityChartRef.current.clientWidth });
        }
      });
      if (mainChartRef.current) resizeObserver.observe(mainChartRef.current);

      return () => {
        resizeObserver.disconnect();
        mainChart.remove();
        rsiChart.remove();
        macdChart.remove();
        equityChartInstance.current?.remove();
      };
    });
  }, []);

  // ─── Update data on each tick ─────────────────────────────────────────
  useEffect(() => {
    if (!currentPrice || !priceSeriesRef.current) return;

    tickCountRef.current += 1;
    const time = Math.floor(Date.now() / 1000) as any;

    // Price
    priceSeriesRef.current.update({ time, value: currentPrice });

    // Bollinger Bands
    const bb = bollingerBands ?? technicals?.bollingerBands;
    if (bb && bb.upper > 0) {
      bbUpperRef.current?.update({ time, value: bb.upper });
      bbLowerRef.current?.update({ time, value: bb.lower });
      bbMiddleRef.current?.update({ time, value: bb.middle });
    }

    // LinReg target
    if (linReg && linReg.priceTarget > 0) {
      lrTargetRef.current?.update({ time, value: linReg.priceTarget });
    }

    // RSI
    const rsi = technicals?.rsi;
    if (rsi) {
      rsiSeriesRef.current?.update({ time, value: rsi.value });
      rsiOBRef.current?.update({ time, value: 70 });
      rsiOSRef.current?.update({ time, value: 30 });
    }

    // MACD
    const macd = technicals?.macd;
    if (macd) {
      macdLineRef.current?.update({ time, value: macd.macdLine });
      macdSignalRef.current?.update({ time, value: macd.signalLine });
      macdHistRef.current?.update({
        time,
        value: macd.histogram,
        color: macd.histogram >= 0 ? CHART_COLORS.macdHistPos : CHART_COLORS.macdHistNeg,
      });
    }
  }, [currentPrice, technicals, linReg, bollingerBands]);

  // ─── Update equity & P&L chart + trade markers ─────────────────────
  useEffect(() => {
    if (!botPortfolio || !currentPrice) return;
    const time = Math.floor(Date.now() / 1000) as any;

    // Equity line
    equitySeriesRef.current?.update({ time, value: botPortfolio.equity });

    // P&L histogram bar
    pnlHistRef.current?.update({
      time,
      value: botPortfolio.dailyPnl,
      color: botPortfolio.dailyPnl >= 0 ? CHART_COLORS.pnlPos : CHART_COLORS.pnlNeg,
    });

    // Trade markers on price chart: add markers for new trades
    if (botPortfolio.trades.length > lastTradeCountRef.current && priceSeriesRef.current) {
      const newTrades = botPortfolio.trades.slice(lastTradeCountRef.current);
      lastTradeCountRef.current = botPortfolio.trades.length;

      try {
        // Build full marker list from all recent trades
        const markers = botPortfolio.trades.map(t => ({
          time: (Math.floor(t.timestamp / 1000)) as any,
          position: t.type === 'BUY' ? 'belowBar' as const : 'aboveBar' as const,
          color: t.type === 'BUY' ? CHART_COLORS.buyMarker : CHART_COLORS.sellMarker,
          shape: t.type === 'BUY' ? 'arrowUp' as const : 'arrowDown' as const,
          text: `${t.type} ${t.size.toFixed(4)} @ ${t.price.toFixed(2)}${t.pnl ? ` P&L:${t.pnl.toFixed(2)}` : ''}`,
        })).sort((a: any, b: any) => a.time - b.time);
        priceSeriesRef.current.setMarkers(markers);
      } catch {
        // markers API may not be available in all versions
      }
    }
  }, [botPortfolio, currentPrice]);

  // ─── Status bar ────────────────────────────────────────────────────────
  const bb = bollingerBands ?? technicals?.bollingerBands;
  const stoch = technicals?.stochastic;
  const adxState = technicals?.adx;
  const rvStatus = radarVector?.status ?? '—';
  const rvSide = radarVector?.dominantSide ?? '—';

  return (
    <Box sx={{
      display: 'flex', flexDirection: 'column', width: '100%',
      border: '1px solid rgba(255,255,255,0.08)', borderRadius: '4px',
      overflow: 'hidden', bgcolor: CHART_COLORS.bg,
    }}>
      {/* Header */}
      <Box sx={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        px: 1, py: 0.5, borderBottom: '1px solid rgba(255,255,255,0.06)',
      }}>
        <Typography sx={{ color: ECAM.WHITE, fontSize: '0.65rem', letterSpacing: '0.1em', fontWeight: 700 }}>
          CHART — TradingView Indicators
        </Typography>
        <Box sx={{ display: 'flex', gap: 1 }}>
          {bb && bb.upper > 0 && (
            <Typography sx={{ color: bb.squeeze ? ECAM.AMBER : ECAM.CYAN, fontSize: '0.6rem', fontFamily: 'monospace' }}>
              BB:{bb.squeeze ? 'SQZ' : (bb.percentB * 100).toFixed(0) + '%'}
            </Typography>
          )}
          {stoch && (
            <Typography sx={{
              color: stoch.isOverbought ? ECAM.RED : stoch.isOversold ? ECAM.GREEN : ECAM.DIM,
              fontSize: '0.6rem', fontFamily: 'monospace',
            }}>
              Stoch:{(stoch.k ?? 0).toFixed(0)}/{(stoch.d ?? 0).toFixed(0)}
            </Typography>
          )}
          {adxState && (
            <Typography sx={{
              color: adxState.isStrong ? ECAM.GREEN : adxState.isTrending ? ECAM.CYAN : ECAM.DIM,
              fontSize: '0.6rem', fontFamily: 'monospace',
            }}>
              ADX:{adxState.adx.toFixed(0)} {adxState.bullishDI ? '▲' : '▼'}
            </Typography>
          )}
          <Typography sx={{
            color: rvStatus === 'ESTABLISH' ? (rvSide === 'BUY' ? ECAM.GREEN : rvSide === 'SELL' ? ECAM.RED : ECAM.AMBER) : ECAM.DIM,
            fontSize: '0.6rem', fontFamily: 'monospace',
          }}>
            RV:{rvStatus}
          </Typography>
        </Box>
      </Box>

      {/* Main price chart */}
      <Box ref={mainChartRef} sx={{ width: '100%' }} />

      {/* RSI pane label */}
      <Box sx={{
        px: 1, py: 0.25, borderTop: '1px solid rgba(255,255,255,0.06)',
        display: 'flex', justifyContent: 'space-between',
      }}>
        <Typography sx={{ color: ECAM.DIM, fontSize: '0.55rem', fontFamily: 'monospace' }}>RSI(14)</Typography>
        <Typography sx={{
          color: technicals?.rsi.isOverbought ? ECAM.RED : technicals?.rsi.isOversold ? ECAM.GREEN : ECAM.CYAN,
          fontSize: '0.55rem', fontFamily: 'monospace', fontWeight: 700,
        }}>
          {technicals?.rsi.value.toFixed(1) ?? '—'}
        </Typography>
      </Box>
      <Box ref={rsiChartRef} sx={{ width: '100%' }} />

      {/* MACD pane label */}
      <Box sx={{
        px: 1, py: 0.25, borderTop: '1px solid rgba(255,255,255,0.06)',
        display: 'flex', justifyContent: 'space-between',
      }}>
        <Typography sx={{ color: ECAM.DIM, fontSize: '0.55rem', fontFamily: 'monospace' }}>MACD(12,26,9)</Typography>
        <Typography sx={{
          color: technicals?.macd.aligned === 'bullish' ? ECAM.GREEN : technicals?.macd.aligned === 'bearish' ? ECAM.RED : ECAM.DIM,
          fontSize: '0.55rem', fontFamily: 'monospace', fontWeight: 700,
        }}>
          {technicals?.macd.histogram.toFixed(5) ?? '—'} {technicals?.macd.aligned ?? ''}
        </Typography>
      </Box>
      <Box ref={macdChartRef} sx={{ width: '100%' }} />

      {/* Equity / P&L pane label */}
      <Box sx={{
        px: 1, py: 0.25, borderTop: '1px solid rgba(255,255,255,0.06)',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <Typography sx={{ color: ECAM.DIM, fontSize: '0.55rem', fontFamily: 'monospace' }}>EQUITY / P&L</Typography>
        {botPortfolio && (
          <Box sx={{ display: 'flex', gap: 1.5 }}>
            <Typography sx={{ color: ECAM.WHITE, fontSize: '0.55rem', fontFamily: 'monospace' }}>
              BAL:{botPortfolio.balance.toFixed(2)}
            </Typography>
            <Typography sx={{ color: ECAM.CYAN, fontSize: '0.55rem', fontFamily: 'monospace' }}>
              EQ:{botPortfolio.equity.toFixed(2)}
            </Typography>
            <Typography sx={{
              color: botPortfolio.position > 0 ? ECAM.GREEN : botPortfolio.position < 0 ? ECAM.RED : ECAM.DIM,
              fontSize: '0.55rem', fontFamily: 'monospace', fontWeight: 700,
            }}>
              POS:{botPortfolio.position.toFixed(4)}{botPortfolio.position > 0 ? `@${botPortfolio.avgEntryPrice.toFixed(2)}` : ''}
            </Typography>
            <Typography sx={{
              color: botPortfolio.unrealizedPnl >= 0 ? ECAM.GREEN : ECAM.RED,
              fontSize: '0.55rem', fontFamily: 'monospace', fontWeight: 700,
            }}>
              UPL:{botPortfolio.unrealizedPnl >= 0 ? '+' : ''}{botPortfolio.unrealizedPnl.toFixed(2)}
            </Typography>
            <Typography sx={{
              color: botPortfolio.dailyPnl >= 0 ? ECAM.GREEN : ECAM.RED,
              fontSize: '0.55rem', fontFamily: 'monospace', fontWeight: 700,
            }}>
              P&L:{botPortfolio.dailyPnl >= 0 ? '+' : ''}{botPortfolio.dailyPnl.toFixed(2)}
            </Typography>
            <Typography sx={{ color: ECAM.DIM, fontSize: '0.55rem', fontFamily: 'monospace' }}>
              T:{botPortfolio.tradesToday} WR:{(botPortfolio.winRate * 100).toFixed(0)}%
            </Typography>
          </Box>
        )}
      </Box>
      <Box ref={equityChartRef} sx={{ width: '100%' }} />
    </Box>
  );
};

export default React.memo(TradingViewChart);
