'use client';

import React, { useMemo, useState, useContext, useCallback, useRef, useEffect } from 'react';
import { Box, Typography } from '@mui/material';
import { useMLEngine } from '../api/MLContext';
import { OrderBookContext } from '../api/Page';
import { useRiskManager } from '../api/RiskContext';
import { useTradingStore } from '@stores/tradingStore';
import { AlphaRiskState } from './TradingEngine/ParetoAnalyzer';
import ParetoMonitor from './ParetoMonitor';

// ─── ECAM Color Constants (Airbus standard) ───
const ECAM = {
  RED: '#ff2222',
  AMBER: '#ffaa00',
  GREEN: '#00ff88',
  CYAN: '#00ddff',
  WHITE: '#e0e0e0',
  MAGENTA: '#ff44ff',
  DIM: 'rgba(255,255,255,0.35)',
  BG: '#0a0a0f',
  PANEL: 'rgba(12,14,20,0.92)',
  BORDER: 'rgba(255,255,255,0.06)',
};

type Severity = 'warning' | 'caution' | 'memo';
interface EcamMessage {
  severity: Severity;
  system: string;
  text: string;
}
interface ChecklistItem {
  action: string;
  status: 'todo' | 'done' | 'na';
  key: string;
}

const severityColor = (s: Severity) =>
  s === 'warning' ? ECAM.RED : s === 'caution' ? ECAM.AMBER : ECAM.GREEN;
const severityOrder = (s: Severity) =>
  s === 'warning' ? 0 : s === 'caution' ? 1 : 2;

// ─── COMPONENT ───
const CockpitPanel: React.FC = () => {
  const orderBookContext = useContext(OrderBookContext);
  const { mlPrediction, regime, learner, history } = useMLEngine();
  const { portfolioState, status, config } = useRiskManager();
  const paretoState = useTradingStore((s) => s.paretoState);
  const [wallRangePct, setWallRangePct] = useState(5);
  const [checkedItems, setCheckedItems] = useState<Record<string, boolean>>({});
  const wallRangeOptions = [2, 5, 10];

  const orderBook = orderBookContext?.orderBookData ?? null;

  // ─── SMOOTHING LAYER ───
  // EMA alpha: lower = smoother/slower, higher = more responsive
  // 0.15 means each new value contributes 15%, previous smoothed value 85%
  const SMOOTH_ALPHA = 0.15;
  const SMOOTH_ALPHA_FAST = 0.3; // for price (needs to track faster)
  const SMOOTH_ALPHA_SLOW = 0.08; // for volume/radar (can be very smooth)

  const smoothEma = (prev: number, next: number, alpha: number) =>
    prev === 0 ? next : prev + alpha * (next - prev);

  // Refs to hold smoothed state across renders
  const smoothedTechRef = useRef<Record<string, number>>({});
  const smoothedVolBinsRef = useRef<{ bidVol: number; askVol: number }[]>([]);
  const smoothedFeatureRef = useRef<number[]>([]);
  const smoothedPriceRoCRef = useRef<number>(0);
  const smoothedVolRoCRef = useRef<number>(0);
  const smoothedMlRef = useRef<{ signalConf: number; regimeScore: number }>({ signalConf: 0, regimeScore: 0 });
  const ecamCooldownRef = useRef<Map<string, number>>(new Map());

  // ─── PRICE HISTORY (for rate-of-change) ───
  const priceHistoryRef = useRef<number[]>([]);
  const prevMidRef = useRef<number>(0);

  // ─── PRE-PARSE ORDER BOOK ───
  const parsedBook = useMemo(() => {
    if (!orderBook) return null;
    return {
      bids: orderBook.bids.map(([p, q]: [string, string]) => ({ price: parseFloat(p), qty: parseFloat(q) })),
      asks: orderBook.asks.map(([p, q]: [string, string]) => ({ price: parseFloat(p), qty: parseFloat(q) })),
    };
  }, [orderBook]);

  // ─── TECHNICAL DATA (raw) ───
  const technicalData = useMemo(() => {
    if (!parsedBook || !parsedBook.bids.length || !parsedBook.asks.length) return null;

    const bestBid = parsedBook.bids[0].price;
    const bestAsk = parsedBook.asks[0].price;
    const midPrice = (bestBid + bestAsk) / 2;
    const spread = bestAsk - bestBid;
    const spreadPct = (spread / midPrice) * 100;

    const maxAskPrice = midPrice * (1 + wallRangePct / 100);
    const minBidPrice = midPrice * (1 - wallRangePct / 100);

    // Single pass: OBI + wall candidates
    let bidVolume = 0;
    const bidWallCandidates: { price: number; size: number; notional: number; distancePct: number }[] = [];
    for (const { price, qty } of parsedBook.bids) {
      if (price < minBidPrice) break;
      bidVolume += qty;
      bidWallCandidates.push({ price, size: qty, notional: price * qty, distancePct: ((price - midPrice) / midPrice) * 100 });
    }

    let askVolume = 0;
    const askWallCandidates: { price: number; size: number; notional: number; distancePct: number }[] = [];
    for (const { price, qty } of parsedBook.asks) {
      if (price > maxAskPrice) break;
      askVolume += qty;
      askWallCandidates.push({ price, size: qty, notional: price * qty, distancePct: ((price - midPrice) / midPrice) * 100 });
    }

    if (bidVolume === 0) bidVolume = parsedBook.bids.slice(0, 10).reduce((s, b) => s + b.qty, 0);
    if (askVolume === 0) askVolume = parsedBook.asks.slice(0, 10).reduce((s, a) => s + a.qty, 0);
    const obi = ((bidVolume - askVolume) / (bidVolume + askVolume)) * 100;

    // Depth at scan range
    let totalDepth = 0;
    for (const { price, qty } of parsedBook.bids) {
      if (price < minBidPrice) break;
      totalDepth += qty * price;
    }
    for (const { price, qty } of parsedBook.asks) {
      if (price > maxAskPrice) break;
      totalDepth += qty * price;
    }

    // Walls (top 4 by notional)
    const sellWalls = [...askWallCandidates].sort((a, b) => b.notional - a.notional).slice(0, 4);
    const buyWalls = [...bidWallCandidates].sort((a, b) => b.notional - a.notional).slice(0, 4);
    const sellWallNotional = sellWalls.reduce((s, w) => s + w.notional, 0);
    const buyWallNotional = buyWalls.reduce((s, w) => s + w.notional, 0);
    const wallStrength = sellWallNotional + buyWallNotional > 0 ? buyWallNotional / (sellWallNotional + buyWallNotional) : 0.5;
    const maxWallNotional = Math.max(1, ...sellWalls.map(w => w.notional), ...buyWalls.map(w => w.notional));

    const nearestSellWallPct = sellWalls.length ? Math.min(...sellWalls.map(w => w.distancePct)) : null;
    const nearestBuyWallPct = buyWalls.length ? Math.max(...buyWalls.map(w => w.distancePct)) : null;

    // Order flow metrics (from Level2Section logic)
    const bidVol5 = parsedBook.bids.slice(0, 5).reduce((s, b) => s + b.qty, 0);
    const askVol5 = parsedBook.asks.slice(0, 5).reduce((s, a) => s + a.qty, 0);
    const imbalance = (bidVol5 - askVol5) / (bidVol5 + askVol5) * 100;
    const liquidity = (bidVol5 + askVol5) / 100;

    // Technical approximations
    const vwap = midPrice * 0.998;
    const ema20 = midPrice * 1.002;
    const ema50 = midPrice * 1.005;
    const ema200 = midPrice * 1.01;
    const rsi = regime?.momentum ? 50 + (regime.momentum * 200) : 50;
    const macd = regime?.momentum ? regime.momentum * 100 : 0;

    return {
      midPrice, bestBid, bestAsk, spread, spreadPct,
      obi, totalDepth, imbalance, liquidity,
      sellWalls, buyWalls, sellWallNotional, buyWallNotional, wallStrength, maxWallNotional,
      nearestSellWallPct, nearestBuyWallPct,
      vwap, ema20, ema50, ema200, rsi, macd,
      signal: macd >= 0 ? 'bullish' : 'bearish' as string,
      heikinAshi: regime?.momentum && regime.momentum > 0,
    };
  }, [parsedBook, regime, wallRangePct]);

  // ─── PRICE RATE OF CHANGE (raw) ───
  useEffect(() => {
    if (!technicalData) return;
    const hist = priceHistoryRef.current;
    hist.push(technicalData.midPrice);
    if (hist.length > 30) hist.shift();
    prevMidRef.current = hist.length > 1 ? hist[hist.length - 2] : technicalData.midPrice;
  }, [technicalData]);

  const rawPriceRoC = useMemo(() => {
    if (!technicalData || prevMidRef.current === 0) return 0;
    return ((technicalData.midPrice - prevMidRef.current) / prevMidRef.current) * 10000; // bps
  }, [technicalData]);

  // ─── VOLUME PROFILE (raw, binned by price for attitude indicator) ───
  const rawVolumeProfile = useMemo(() => {
    if (!parsedBook || !technicalData) return { bins: [] as { price: number; bidVol: number; askVol: number }[], totalBidVol: 0, totalAskVol: 0 };
    const mid = technicalData.midPrice;
    const range = mid * (wallRangePct / 100);
    const BINS = 10;
    const step = (range * 2) / BINS;
    const bins: { price: number; bidVol: number; askVol: number }[] = [];
    for (let i = 0; i < BINS; i++) {
      const lo = mid - range + step * i;
      const hi = lo + step;
      let bidVol = 0, askVol = 0;
      for (const b of parsedBook.bids) { if (b.price >= lo && b.price < hi) bidVol += b.qty; }
      for (const a of parsedBook.asks) { if (a.price >= lo && a.price < hi) askVol += a.qty; }
      bins.push({ price: (lo + hi) / 2, bidVol, askVol });
    }
    const totalBidVol = bins.reduce((s, b) => s + b.bidVol, 0);
    const totalAskVol = bins.reduce((s, b) => s + b.askVol, 0);
    return { bins, totalBidVol, totalAskVol };
  }, [parsedBook, technicalData, wallRangePct]);

  // ─── FEATURE IMPORTANCE (raw, for radar chart) ───
  const rawFeatureWeights = useMemo(() => {
    if (!technicalData) return [];
    const raw = [
      { label: 'OBI', value: Math.min(Math.abs(technicalData.obi) / 100, 1) },
      { label: 'RSI', value: Math.abs(technicalData.rsi - 50) / 50 },
      { label: 'MACD', value: Math.min(Math.abs(technicalData.macd) / 50, 1) },
      { label: 'WALLS', value: Math.abs(technicalData.wallStrength - 0.5) * 2 },
      { label: 'SPREAD', value: Math.min(technicalData.spreadPct / 0.1, 1) },
      { label: 'IMBAL', value: Math.min(Math.abs(technicalData.imbalance) / 100, 1) },
      { label: 'DEPTH', value: Math.min(technicalData.totalDepth / 50000000, 1) },
      { label: 'LIQ', value: Math.min(technicalData.liquidity / 50, 1) },
    ];
    if (mlPrediction?.featureImportance) {
      const fi = mlPrediction.featureImportance;
      const cats: Record<string, number> = { base: 0, imbalance: 0, volume: 0, liquidity: 0 };
      fi.forEach((v, k) => {
        if (k.startsWith('imbalance')) cats.imbalance += v;
        else if (k.startsWith('vol_prof')) cats.volume += v;
        else if (k.startsWith('liq_depth')) cats.liquidity += v;
        else cats.base += v;
      });
      const total = Object.values(cats).reduce((a, b) => a + b, 0) || 1;
      raw.push({ label: 'ML:BASE', value: Math.min(cats.base / total * 4, 1) });
      raw.push({ label: 'ML:IMBL', value: Math.min(cats.imbalance / total * 4, 1) });
    }
    return raw;
  }, [technicalData, mlPrediction]);

  // Raw volume RoC
  const rawVolRoC = useMemo(() => {
    if (!rawVolumeProfile.totalBidVol && !rawVolumeProfile.totalAskVol) return 0;
    const total = rawVolumeProfile.totalBidVol + rawVolumeProfile.totalAskVol;
    return total > 0 ? ((rawVolumeProfile.totalBidVol - rawVolumeProfile.totalAskVol) / total) * 100 : 0;
  }, [rawVolumeProfile]);

  // ═══ APPLY EMA SMOOTHING TO ALL DISPLAY VALUES ═══
  // This is the key fix: instead of showing raw per-tick data, we smooth
  // everything so instruments move gradually like real cockpit gauges.

  // Smooth technicalData scalars
  const smoothedTech = useMemo(() => {
    if (!technicalData) return null;
    const prev = smoothedTechRef.current;
    const s = (key: string, raw: number, alpha = SMOOTH_ALPHA) =>
      smoothEma(prev[key] ?? raw, raw, alpha);

    const result: Record<string, number> = {
      midPrice: s('midPrice', technicalData.midPrice, SMOOTH_ALPHA_FAST),
      bestBid: s('bestBid', technicalData.bestBid, SMOOTH_ALPHA_FAST),
      bestAsk: s('bestAsk', technicalData.bestAsk, SMOOTH_ALPHA_FAST),
      spread: s('spread', technicalData.spread),
      spreadPct: s('spreadPct', technicalData.spreadPct),
      obi: s('obi', technicalData.obi, SMOOTH_ALPHA),
      totalDepth: s('totalDepth', technicalData.totalDepth, SMOOTH_ALPHA_SLOW),
      imbalance: s('imbalance', technicalData.imbalance, SMOOTH_ALPHA),
      liquidity: s('liquidity', technicalData.liquidity, SMOOTH_ALPHA_SLOW),
      wallStrength: s('wallStrength', technicalData.wallStrength, SMOOTH_ALPHA_SLOW),
      vwap: s('vwap', technicalData.vwap, SMOOTH_ALPHA_FAST),
      ema20: s('ema20', technicalData.ema20, SMOOTH_ALPHA_FAST),
      ema50: s('ema50', technicalData.ema50, SMOOTH_ALPHA_FAST),
      ema200: s('ema200', technicalData.ema200, SMOOTH_ALPHA_FAST),
      rsi: s('rsi', technicalData.rsi, SMOOTH_ALPHA),
      macd: s('macd', technicalData.macd, SMOOTH_ALPHA),
      sellWallNotional: s('sellWallNotional', technicalData.sellWallNotional, SMOOTH_ALPHA_SLOW),
      buyWallNotional: s('buyWallNotional', technicalData.buyWallNotional, SMOOTH_ALPHA_SLOW),
      maxWallNotional: s('maxWallNotional', technicalData.maxWallNotional, SMOOTH_ALPHA_SLOW),
    };
    smoothedTechRef.current = result;
    return {
      midPrice: result.midPrice,
      bestBid: result.bestBid,
      bestAsk: result.bestAsk,
      spread: result.spread,
      spreadPct: result.spreadPct,
      obi: result.obi,
      totalDepth: result.totalDepth,
      imbalance: result.imbalance,
      liquidity: result.liquidity,
      wallStrength: result.wallStrength,
      vwap: result.vwap,
      ema20: result.ema20,
      ema50: result.ema50,
      ema200: result.ema200,
      rsi: result.rsi,
      macd: result.macd,
      sellWallNotional: result.sellWallNotional,
      buyWallNotional: result.buyWallNotional,
      maxWallNotional: result.maxWallNotional,
      // Keep non-numeric / structural data from raw
      sellWalls: technicalData.sellWalls,
      buyWalls: technicalData.buyWalls,
      nearestSellWallPct: technicalData.nearestSellWallPct,
      nearestBuyWallPct: technicalData.nearestBuyWallPct,
      signal: technicalData.signal,
      heikinAshi: technicalData.heikinAshi,
    };
  }, [technicalData]);

  // Smooth volume profile bins
  const volumeProfile = useMemo(() => {
    const raw = rawVolumeProfile;
    if (!raw.bins.length) return raw;
    const prev = smoothedVolBinsRef.current;
    const smoothed = raw.bins.map((bin, i) => ({
      price: bin.price,
      bidVol: smoothEma(prev[i]?.bidVol ?? bin.bidVol, bin.bidVol, SMOOTH_ALPHA_SLOW),
      askVol: smoothEma(prev[i]?.askVol ?? bin.askVol, bin.askVol, SMOOTH_ALPHA_SLOW),
    }));
    smoothedVolBinsRef.current = smoothed;
    const totalBidVol = smoothed.reduce((s, b) => s + b.bidVol, 0);
    const totalAskVol = smoothed.reduce((s, b) => s + b.askVol, 0);
    return { bins: smoothed, totalBidVol, totalAskVol };
  }, [rawVolumeProfile]);

  // Smooth feature weights for radar
  const featureWeights = useMemo(() => {
    const raw = rawFeatureWeights;
    if (!raw.length) return raw;
    const prev = smoothedFeatureRef.current;
    const smoothed = raw.map((fw, i) => ({
      label: fw.label,
      value: smoothEma(prev[i] ?? fw.value, fw.value, SMOOTH_ALPHA_SLOW),
    }));
    smoothedFeatureRef.current = smoothed.map(f => f.value);
    return smoothed;
  }, [rawFeatureWeights]);

  // Smooth RoC gauges
  const priceRoC = useMemo(() => {
    const s = smoothEma(smoothedPriceRoCRef.current, rawPriceRoC, SMOOTH_ALPHA);
    smoothedPriceRoCRef.current = s;
    return s;
  }, [rawPriceRoC]);

  const volRoC = useMemo(() => {
    const s = smoothEma(smoothedVolRoCRef.current, rawVolRoC, SMOOTH_ALPHA_SLOW);
    smoothedVolRoCRef.current = s;
    return s;
  }, [rawVolRoC]);

  // ─── ML / RL METRICS (smoothed) ───
  const mlMetrics = useMemo(() => {
    const metrics = learner.getMetrics();
    const rawConf = mlPrediction?.horizon1ms?.confidence ?? 0;
    const signalDir = mlPrediction?.horizon1ms?.direction ?? 'hold';
    const rawRegimeScore = regime ? Math.min(1, Math.max(0, (regime.momentum + 1) / 2)) : 0;

    const prev = smoothedMlRef.current;
    const signalConf = smoothEma(prev.signalConf, rawConf, SMOOTH_ALPHA);
    const regimeScore = smoothEma(prev.regimeScore, rawRegimeScore, SMOOTH_ALPHA_SLOW);
    smoothedMlRef.current = { signalConf, regimeScore };

    return { ...metrics, signalConf, signalDir, regimeScore };
  }, [learner, mlPrediction, regime]);

  // ─── ECAM MESSAGE GENERATION (uses smoothed values to prevent flicker) ───
  const ecamMessages = useMemo((): EcamMessage[] => {
    const msgs: EcamMessage[] = [];
    if (!smoothedTech) return msgs;
    const td = smoothedTech;

    // RED — WARNINGS
    if (status.killSwitchActive) {
      msgs.push({ severity: 'warning', system: 'RISK', text: 'KILL SWITCH ARMED — ALL TRADING HALTED' });
    }
    if (portfolioState.maxDrawdownToday >= config.maxDrawdownFromPeak * 0.9) {
      msgs.push({ severity: 'warning', system: 'RISK', text: `MAX DRAWDOWN ${portfolioState.maxDrawdownToday.toFixed(2)} / ${config.maxDrawdownFromPeak.toFixed(0)}` });
    }
    if (td.rsi > 85) {
      msgs.push({ severity: 'warning', system: 'TECH', text: `RSI EXTREME OVERBOUGHT ${td.rsi.toFixed(0)}` });
    }
    if (td.rsi < 15) {
      msgs.push({ severity: 'warning', system: 'TECH', text: `RSI EXTREME OVERSOLD ${td.rsi.toFixed(0)}` });
    }

    // AMBER — CAUTIONS
    if (regime?.name === 'volatile') {
      msgs.push({ severity: 'caution', system: 'REGIME', text: 'VOLATILE MARKET — REDUCE EXPOSURE' });
    }
    if (td.rsi > 70 && td.rsi <= 85) {
      msgs.push({ severity: 'caution', system: 'TECH', text: `RSI OVERBOUGHT ${td.rsi.toFixed(0)}` });
    }
    if (td.rsi < 30 && td.rsi >= 15) {
      msgs.push({ severity: 'caution', system: 'TECH', text: `RSI OVERSOLD ${td.rsi.toFixed(0)}` });
    }
    if (Math.abs(td.obi) > 70) {
      msgs.push({ severity: 'caution', system: 'OB', text: `EXTREME IMBALANCE OBI ${td.obi > 0 ? '+' : ''}${td.obi.toFixed(0)}%` });
    }
    if (td.spreadPct > 0.1) {
      msgs.push({ severity: 'caution', system: 'OB', text: `SPREAD WIDENING ${td.spreadPct.toFixed(3)}%` });
    }
    if (td.nearestSellWallPct !== null && td.nearestSellWallPct < 0.5) {
      msgs.push({ severity: 'caution', system: 'WALL', text: `SELL WALL NEAR +${(td.nearestSellWallPct as number).toFixed(2)}%` });
    }
    if (portfolioState.marginUtilization > 0.8) {
      msgs.push({ severity: 'caution', system: 'RISK', text: `MARGIN HIGH ${(portfolioState.marginUtilization * 100).toFixed(0)}%` });
    }
    if (td.ema50 < td.ema200) {
      msgs.push({ severity: 'caution', system: 'TECH', text: 'DEATH CROSS — EMA50 < EMA200' });
    }
    if (td.macd < 0 && td.obi < 0) {
      msgs.push({ severity: 'caution', system: 'TECH', text: 'BEARISH CONFLUENCE — MACD + OBI NEGATIVE' });
    }

    // GREEN — MEMO
    if (td.ema50 > td.ema200) {
      msgs.push({ severity: 'memo', system: 'TECH', text: 'GOLDEN CROSS — EMA50 > EMA200' });
    }
    if (mlMetrics.signalConf > 0.7) {
      msgs.push({ severity: 'memo', system: 'ML', text: `HIGH CONFIDENCE ${(mlMetrics.signalConf * 100).toFixed(0)}%` });
    }
    if (td.wallStrength > 0.65) {
      msgs.push({ severity: 'memo', system: 'WALL', text: 'BUY PRESSURE DOMINANT' });
    } else if (td.wallStrength < 0.35) {
      msgs.push({ severity: 'memo', system: 'WALL', text: 'SELL PRESSURE DOMINANT' });
    }

    return msgs.sort((a, b) => severityOrder(a.severity) - severityOrder(b.severity));
  }, [smoothedTech, regime, status, portfolioState, config, mlMetrics]);

  // ─── CHECKLIST / PROCEDURES (based on regime) ───
  const procedures = useMemo((): { title: string; items: ChecklistItem[] } => {
    const regimeName = regime?.name || 'unknown';
    const momentum = regime?.momentum || 0;

    if (regimeName === 'volatile' || regimeName === 'crisis') {
      return {
        title: 'VOLATILE / CRISIS RECOVERY',
        items: [
          { key: 'v1', action: 'REDUCE position size to 50%', status: 'todo' },
          { key: 'v2', action: 'WIDEN stop-loss by 1.5×', status: 'todo' },
          { key: 'v3', action: 'CHECK wall support below', status: 'todo' },
          { key: 'v4', action: `VERIFY ML confidence > 60% (now ${(mlMetrics.signalConf * 100).toFixed(0)}%)`, status: mlMetrics.signalConf > 0.6 ? 'done' : 'todo' },
          { key: 'v5', action: `CONFIRM risk budget available (${(portfolioState.availableRiskBudget * 100).toFixed(0)}%)`, status: portfolioState.availableRiskBudget > 0.2 ? 'done' : 'todo' },
          { key: 'v6', action: 'MONITOR regime transition', status: 'todo' },
        ],
      };
    }

    if (momentum > 0.1) {
      return {
        title: 'TRENDING BULLISH',
        items: [
          { key: 'b1', action: `CONFIRM OBI positive (${smoothedTech ? smoothedTech.obi.toFixed(1) : '—'}%)`, status: smoothedTech && smoothedTech.obi > 0 ? 'done' : 'todo' },
          { key: 'b2', action: 'CHECK EMA alignment (20 > 50 > 200)', status: smoothedTech && smoothedTech.ema20 > smoothedTech.ema50 && smoothedTech.ema50 > smoothedTech.ema200 ? 'done' : 'todo' },
          { key: 'b3', action: 'SET trailing stop', status: 'todo' },
          { key: 'b4', action: `VERIFY signal confidence (${(mlMetrics.signalConf * 100).toFixed(0)}%)`, status: mlMetrics.signalConf > 0.5 ? 'done' : 'todo' },
          { key: 'b5', action: 'INCREASE position if conf > 70%', status: mlMetrics.signalConf > 0.7 ? 'done' : 'todo' },
        ],
      };
    }

    if (momentum < -0.1) {
      return {
        title: 'TRENDING BEARISH',
        items: [
          { key: 'd1', action: `CONFIRM OBI negative (${smoothedTech ? smoothedTech.obi.toFixed(1) : '—'}%)`, status: smoothedTech && smoothedTech.obi < 0 ? 'done' : 'todo' },
          { key: 'd2', action: 'CHECK for sell walls above', status: smoothedTech && smoothedTech.sellWalls.length > 0 ? 'done' : 'todo' },
          { key: 'd3', action: 'REDUCE long exposure', status: 'todo' },
          { key: 'd4', action: 'SET tight stop-loss', status: 'todo' },
          { key: 'd5', action: 'WAIT for reversal signal', status: 'todo' },
        ],
      };
    }

    // Ranging / unknown
    return {
      title: 'RANGING MARKET',
      items: [
        { key: 'r1', action: 'IDENTIFY support/resistance from walls', status: 'todo' },
        { key: 'r2', action: 'REDUCE position size', status: 'todo' },
        { key: 'r3', action: 'USE mean-reversion strategy', status: 'todo' },
        { key: 'r4', action: 'WAIT for breakout confirmation', status: 'todo' },
        { key: 'r5', action: `MONITOR ML confidence (${(mlMetrics.signalConf * 100).toFixed(0)}%)`, status: 'todo' },
      ],
    };
  }, [regime, smoothedTech, mlMetrics, portfolioState]);

  // ─── Execution mode derived from strategy engine logic ───
  const executionMode = useMemo(() => {
    const conf = mlMetrics.signalConf;
    if (conf > 0.7) return { label: 'AGGRESSIVE', color: ECAM.GREEN };
    if (conf > 0.3) return { label: 'ADAPTIVE', color: ECAM.CYAN };
    return { label: 'PASSIVE', color: ECAM.AMBER };
  }, [mlMetrics.signalConf]);

  const toggleCheck = useCallback((key: string) => {
    setCheckedItems(prev => ({ ...prev, [key]: !prev[key] }));
  }, []);

  // ─── WAITING STATE ───
  if (!smoothedTech) {
    return (
      <Box sx={{ p: 4, color: ECAM.DIM, textAlign: 'center', fontFamily: 'JetBrains Mono, monospace' }}>
        ECAM SELF TEST . . .
      </Box>
    );
  }

  const isBullish = smoothedTech.signal === 'bullish';
  const trendScore = Math.round((smoothedTech.obi / 100) * 10);
  const regimeName = regime?.name || 'UNKNOWN';

  // ─── RENDER ───
  return (
    <Box sx={{
      display: 'flex',
      flexDirection: 'column',
      gap: '2px',
      width: '100%',
      height: '100%',
      bgcolor: ECAM.BG,
      fontFamily: '"JetBrains Mono", "IBM Plex Mono", monospace',
      fontSize: '0.78rem',
      overflow: 'auto',
    }}>

      {/* ═══ TOP STATUS BAR ═══ */}
      <Box sx={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        px: 2, py: 0.8,
        bgcolor: 'rgba(15,15,20,0.95)',
        borderBottom: `1px solid ${ECAM.BORDER}`,
        flexWrap: 'wrap',
        gap: 1,
      }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <Typography sx={{ color: ECAM.WHITE, fontSize: '0.7rem', letterSpacing: '0.15em', fontWeight: 700 }}>
            REGIME
          </Typography>
          <Typography sx={{
            color: regimeName === 'volatile' || regimeName === 'crisis' ? ECAM.RED
              : regimeName === 'trending' ? ECAM.GREEN : ECAM.CYAN,
            fontSize: '0.85rem', fontWeight: 800, letterSpacing: '0.1em',
          }}>
            {regimeName.toUpperCase()}
          </Typography>
        </Box>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 3 }}>
          <Box sx={{ textAlign: 'center' }}>
            <Typography sx={{ color: ECAM.DIM, fontSize: '0.6rem' }}>MID</Typography>
            <Typography sx={{ color: ECAM.GREEN, fontSize: '0.9rem', fontWeight: 700 }}>
              ${smoothedTech.midPrice.toLocaleString(undefined, { minimumFractionDigits: 4, maximumFractionDigits: 4 })}
            </Typography>
          </Box>
          <Box sx={{ textAlign: 'center' }}>
            <Typography sx={{ color: ECAM.DIM, fontSize: '0.6rem' }}>SPREAD</Typography>
            <Typography sx={{ color: smoothedTech.spreadPct > 0.1 ? ECAM.AMBER : ECAM.GREEN, fontSize: '0.8rem', fontWeight: 600 }}>
              {smoothedTech.spreadPct.toFixed(4)}%
            </Typography>
          </Box>
          <Box sx={{ textAlign: 'center' }}>
            <Typography sx={{ color: ECAM.DIM, fontSize: '0.6rem' }}>ML CONF</Typography>
            <Typography sx={{ color: mlMetrics.signalConf > 0.6 ? ECAM.GREEN : ECAM.AMBER, fontSize: '0.8rem', fontWeight: 600 }}>
              {(mlMetrics.signalConf * 100).toFixed(0)}%
            </Typography>
          </Box>
          <Box sx={{ textAlign: 'center' }}>
            <Typography sx={{ color: ECAM.DIM, fontSize: '0.6rem' }}>EXEC</Typography>
            <Typography sx={{ color: executionMode.color, fontSize: '0.8rem', fontWeight: 700 }}>
              {executionMode.label}
            </Typography>
          </Box>
        </Box>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <Box sx={{ textAlign: 'center' }}>
            <Typography sx={{ color: ECAM.DIM, fontSize: '0.6rem' }}>ALPHA (α)</Typography>
            <Typography sx={{
              color: paretoState?.alphaState === AlphaRiskState.SAFE ? ECAM.GREEN
                : paretoState?.alphaState === AlphaRiskState.ELEVATED ? ECAM.CYAN
                : paretoState?.alphaState === AlphaRiskState.HIGH ? ECAM.AMBER
                : paretoState?.alphaState === AlphaRiskState.CRITICAL ? ECAM.RED
                : paretoState?.alphaState === AlphaRiskState.LOCKOUT ? ECAM.RED
                : ECAM.DIM,
              fontSize: '0.8rem', fontWeight: 700,
            }}>
              {paretoState?.params?.alpha != null ? paretoState.params.alpha.toFixed(3) : '—'}
            </Typography>
          </Box>
          <Box sx={{ textAlign: 'center' }}>
            <Typography sx={{ color: ECAM.DIM, fontSize: '0.6rem' }}>POS SIZE</Typography>
            <Typography sx={{
              color: (paretoState?.positionSizeMultiplier ?? 1) >= 0.8 ? ECAM.GREEN
                : (paretoState?.positionSizeMultiplier ?? 1) >= 0.5 ? ECAM.AMBER : ECAM.RED,
              fontSize: '0.8rem', fontWeight: 600,
            }}>
              {paretoState?.positionSizeMultiplier != null
                ? `×${paretoState.positionSizeMultiplier.toFixed(2)}`
                : '×1.00'}
            </Typography>
          </Box>
          <Box sx={{ textAlign: 'center' }}>
            <Typography sx={{ color: ECAM.DIM, fontSize: '0.6rem' }}>
              {paretoState?.params?.isReliable ? 'PARETO' : 'CALIBRATING'}
            </Typography>
            <Typography sx={{
              color: paretoState?.params?.isReliable ? ECAM.GREEN : ECAM.AMBER,
              fontSize: '0.8rem', fontWeight: 600,
            }}>
              {paretoState?.params?.isReliable
                ? (paretoState.alphaState ?? 'INIT')
                : `${paretoState?.params?.sampleSize ?? 0} pts`}
            </Typography>
          </Box>
        </Box>
      </Box>

      {/* ═══ FLIGHT INSTRUMENTS ═══ */}
      <Box sx={{
        display: 'grid',
        gridTemplateColumns: { xs: '1fr', md: '3fr 2fr' },
        gap: 2,
        bgcolor: ECAM.PANEL,
        border: `1px solid ${ECAM.BORDER}`,
        p: 1.5,
      }}>

        {/* ── LEFT: SPEED TAPE + ATTITUDE INDICATOR grouped ── */}
        <Box sx={{ display: 'flex', gap: 2, p: 0.5, alignItems: 'flex-start', justifyContent: 'center' }}>

          {/* SPEED TAPE (Price Indicator) */}
          <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <Typography sx={{ color: ECAM.WHITE, fontSize: '0.7rem', letterSpacing: '0.12em', mb: 0.5, fontWeight: 700 }}>
              SPEED — PRICE
            </Typography>
            <svg width="100%" height="100%" viewBox="0 0 200 380" style={{ maxWidth: 200 }}>
              <rect x="0" y="0" width="200" height="380" fill="rgba(5,5,10,0.9)" rx="4" />

              {(() => {
                if (!smoothedTech) return null;
                const mid = smoothedTech.midPrice;
                const rangePct = wallRangePct / 100;
                const tapeRange = mid * rangePct;
                const tapeTop = mid + tapeRange;
                const tapeBot = mid - tapeRange;
                const tapeH = 320;
                const tapeY0 = 30;
                const steps = 12;

                const priceToY = (p: number) => tapeY0 + ((tapeTop - p) / (tapeTop - tapeBot)) * tapeH;

                const elements = [];

                elements.push(
                  <defs key="grad">
                    <linearGradient id="tapeGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="rgba(255,34,34,0.15)" />
                      <stop offset="50%" stopColor="rgba(0,0,0,0)" />
                      <stop offset="100%" stopColor="rgba(0,255,136,0.15)" />
                    </linearGradient>
                  </defs>
                );
                elements.push(<rect key="tapebg" x="60" y={tapeY0} width="80" height={tapeH} fill="url(#tapeGrad)" stroke="rgba(255,255,255,0.08)" strokeWidth="1" rx="3" />);

                for (let i = 0; i <= steps; i++) {
                  const price = tapeBot + (tapeTop - tapeBot) * (i / steps);
                  const y = priceToY(price);
                  const isMajor = i % 2 === 0;
                  elements.push(
                    <line key={`tick-${i}`} x1={isMajor ? 52 : 56} y1={y} x2={60} y2={y} stroke="rgba(255,255,255,0.35)" strokeWidth={isMajor ? 1.2 : 0.6} />
                  );
                  if (isMajor) {
                    elements.push(
                      <text key={`lbl-${i}`} x="48" y={y + 4} textAnchor="end" fill="rgba(255,255,255,0.45)" fontSize="9" fontFamily="monospace">
                        {price.toFixed(2)}
                      </text>
                    );
                  }
                }

                // VWAP marker
                const vwapY = priceToY(smoothedTech.vwap);
                if (vwapY > tapeY0 && vwapY < tapeY0 + tapeH) {
                  elements.push(<line key="vwap" x1="60" y1={vwapY} x2="140" y2={vwapY} stroke={ECAM.CYAN} strokeWidth="1.2" strokeDasharray="4,3" opacity="0.6" style={{ transition: 'y1 0.8s ease-out, y2 0.8s ease-out' }} />);
                  elements.push(<text key="vwap-lbl" x="144" y={vwapY + 4} fill={ECAM.CYAN} fontSize="9" fontFamily="monospace" fontWeight="bold" style={{ transition: 'y 0.8s ease-out' }}>VW</text>);
                }

                // EMA markers
                [{ ema: smoothedTech.ema20, label: '20', col: '#ffaa00' }, { ema: smoothedTech.ema50, label: '50', col: '#ff44ff' }].forEach(({ ema, label, col }) => {
                  const ey = priceToY(ema);
                  if (ey > tapeY0 && ey < tapeY0 + tapeH) {
                    elements.push(<line key={`ema-${label}`} x1="60" y1={ey} x2="140" y2={ey} stroke={col} strokeWidth="1" strokeDasharray="3,3" opacity="0.5" style={{ transition: 'y1 0.8s ease-out, y2 0.8s ease-out' }} />);
                    elements.push(<text key={`ema-lbl-${label}`} x="144" y={ey + 4} fill={col} fontSize="8" fontFamily="monospace" style={{ transition: 'y 0.8s ease-out' }}>E{label}</text>);
                  }
                });

                // Sell wall markers
                smoothedTech.sellWalls.slice(0, 3).forEach((w, i) => {
                  const wy = priceToY(w.price);
                  if (wy > tapeY0 && wy < tapeY0 + tapeH) {
                    elements.push(
                      <polygon key={`sw-${i}`} points={`${145},${wy} ${158},${wy - 5} ${158},${wy + 5}`} fill={ECAM.RED} opacity="0.8" style={{ transition: 'all 0.8s ease-out' }} />
                    );
                  }
                });

                // Buy wall markers
                smoothedTech.buyWalls.slice(0, 3).forEach((w, i) => {
                  const wy = priceToY(w.price);
                  if (wy > tapeY0 && wy < tapeY0 + tapeH) {
                    elements.push(
                      <polygon key={`bw-${i}`} points={`${145},${wy} ${158},${wy - 5} ${158},${wy + 5}`} fill={ECAM.GREEN} opacity="0.8" style={{ transition: 'all 0.8s ease-out' }} />
                    );
                  }
                });

                // Current price marker (aircraft symbol)
                const midY = priceToY(mid);
                elements.push(
                  <g key="price-marker" style={{ transition: 'transform 0.8s ease-out' }} transform={`translate(0, 0)`}>
                    <polygon points={`${10},${midY} ${22},${midY - 12} ${108},${midY - 12} ${120},${midY} ${108},${midY + 12} ${22},${midY + 12}`} fill="rgba(0,0,0,0.9)" stroke={ECAM.GREEN} strokeWidth="2" style={{ transition: 'all 0.8s ease-out' }} />
                    <text x="65" y={midY + 5} textAnchor="middle" fill={ECAM.GREEN} fontSize="13" fontWeight="bold" fontFamily="monospace" style={{ transition: 'y 0.8s ease-out' }}>
                      {mid.toFixed(4)}
                    </text>
                  </g>
                );

                // Rate of change gauge (right side)
                const rocClamp = Math.max(-5, Math.min(5, priceRoC));
                const rocBarH = (Math.abs(rocClamp) / 5) * 70;
                const rocColor = priceRoC >= 0 ? ECAM.GREEN : ECAM.RED;
                elements.push(
                  <g key="roc">
                    <rect x="168" y="100" width="22" height="160" fill="rgba(255,255,255,0.04)" stroke="rgba(255,255,255,0.08)" strokeWidth="0.8" rx="3" />
                    <text x="179" y="94" textAnchor="middle" fill="rgba(255,255,255,0.4)" fontSize="8" fontFamily="monospace" fontWeight="bold">RoC</text>
                    <line x1="168" y1="180" x2="190" y2="180" stroke="rgba(255,255,255,0.2)" strokeWidth="0.8" />
                    {priceRoC >= 0 ? (
                      <rect x="171" y={180 - rocBarH} width="16" height={Math.max(1, rocBarH)} fill={rocColor} opacity="0.7" rx="2" style={{ transition: 'y 0.8s ease-out, height 0.8s ease-out, fill 0.6s' }} />
                    ) : (
                      <rect x="171" y="180" width="16" height={Math.max(1, rocBarH)} fill={rocColor} opacity="0.7" rx="2" style={{ transition: 'height 0.8s ease-out, fill 0.6s' }} />
                    )}
                    <text x="179" y="274" textAnchor="middle" fill={rocColor} fontSize="10" fontWeight="bold" fontFamily="monospace" style={{ transition: 'fill 0.6s' }}>
                      {priceRoC > 0 ? '+' : ''}{priceRoC.toFixed(1)}
                    </text>
                    <text x="179" y="286" textAnchor="middle" fill="rgba(255,255,255,0.35)" fontSize="8" fontFamily="monospace">bps</text>
                  </g>
                );

                return elements;
              })()}
            </svg>
          </Box>

          {/* ATTITUDE INDICATOR (Volume Size Profile) */}
          <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1 }}>
            <Typography sx={{ color: ECAM.WHITE, fontSize: '0.7rem', letterSpacing: '0.12em', mb: 0.5, fontWeight: 700 }}>
              ATT — VOLUME PROFILE
            </Typography>
            <svg width="100%" height="100%" viewBox="0 0 420 380" style={{ maxWidth: 420 }}>
              <rect x="0" y="0" width="420" height="380" fill="rgba(5,5,10,0.9)" rx="4" />

              {/* Attitude circle */}
              <defs>
                <clipPath id="attClip">
                  <circle cx="180" cy="185" r="145" />
                </clipPath>
              </defs>
              <circle cx="180" cy="185" r="145" fill="none" stroke="rgba(255,255,255,0.14)" strokeWidth="2" />

              {(() => {
                const tiltDeg = Math.max(-30, Math.min(30, volRoC * 0.6));
                const acx = 180, acy = 185, ar = 145;
                const elements = [];

                // Sky / Ground split
                elements.push(
                  <g key="horizon" clipPath="url(#attClip)" style={{ transition: 'transform 0.8s ease-out' }}>
                    <rect x="-20" y={-100} width="400" height={285 + 100} fill="rgba(0,80,180,0.25)"
                      transform={`rotate(${tiltDeg}, ${acx}, ${acy})`} style={{ transition: 'transform 0.8s ease-out' }} />
                    <rect x="-20" y={acy} width="400" height="300" fill="rgba(140,80,20,0.25)"
                      transform={`rotate(${tiltDeg}, ${acx}, ${acy})`} style={{ transition: 'transform 0.8s ease-out' }} />
                    <line x1="-20" y1={acy} x2="400" y2={acy} stroke={ECAM.GREEN} strokeWidth="2"
                      transform={`rotate(${tiltDeg}, ${acx}, ${acy})`} style={{ transition: 'transform 0.8s ease-out' }} />
                  </g>
                );

                // Volume profile bars (on the attitude)
                const maxVol = Math.max(1, ...volumeProfile.bins.map(b => Math.max(b.bidVol, b.askVol)));
                volumeProfile.bins.forEach((bin, i) => {
                  const y = 55 + i * 26;
                  const bidW = Math.max(1, (bin.bidVol / maxVol) * 90);
                  const askW = Math.max(1, (bin.askVol / maxVol) * 90);
                  elements.push(
                    <rect key={`bid-${i}`} x={acx - bidW} y={y} width={bidW} height={14} fill={ECAM.GREEN} opacity="0.4" rx="2" style={{ transition: 'x 0.8s ease-out, width 0.8s ease-out, opacity 0.8s' }} />
                  );
                  elements.push(
                    <rect key={`ask-${i}`} x={acx} y={y} width={askW} height={14} fill={ECAM.RED} opacity="0.4" rx="2" style={{ transition: 'width 0.8s ease-out, opacity 0.8s' }} />
                  );
                  // Gap line between bins for readability
                  elements.push(
                    <line key={`gap-${i}`} x1={acx - 95} y1={y + 15} x2={acx + 95} y2={y + 15} stroke="rgba(255,255,255,0.04)" strokeWidth="1" />
                  );
                });

                // Aircraft symbol (center)
                elements.push(
                  <g key="aircraft-sym">
                    <line x1={acx - 50} y1={acy} x2={acx - 20} y2={acy} stroke={ECAM.AMBER} strokeWidth="3" />
                    <line x1={acx + 20} y1={acy} x2={acx + 50} y2={acy} stroke={ECAM.AMBER} strokeWidth="3" />
                    <rect x={acx - 7} y={acy - 7} width="14" height="14" fill="none" stroke={ECAM.AMBER} strokeWidth="3" />
                  </g>
                );

                // Pitch ladder
                [-20, -10, 10, 20].forEach(deg => {
                  const yOff = -(deg / 30) * 120;
                  const y = acy + yOff;
                  if (y > 50 && y < 320) {
                    elements.push(
                      <g key={`pitch-${deg}`} transform={`rotate(${tiltDeg}, ${acx}, ${acy})`}>
                        <line x1={acx - 38} y1={y} x2={acx - 18} y2={y} stroke="rgba(255,255,255,0.35)" strokeWidth="1" />
                        <line x1={acx + 18} y1={y} x2={acx + 38} y2={y} stroke="rgba(255,255,255,0.35)" strokeWidth="1" />
                        <text x={acx - 48} y={y + 4} textAnchor="end" fill="rgba(255,255,255,0.3)" fontSize="10" fontFamily="monospace">{Math.abs(deg)}</text>
                      </g>
                    );
                  }
                });

                // Bank angle arc
                elements.push(
                  <g key="bank-arc">
                    <path d={`M ${acx - ar * 0.85} ${acy - ar * 0.55} A ${ar} ${ar} 0 0 1 ${acx + ar * 0.85} ${acy - ar * 0.55}`} fill="none" stroke="rgba(255,255,255,0.18)" strokeWidth="1.2" />
                    {[-30, -20, -10, 0, 10, 20, 30].map(angle => {
                      const rad = ((angle - 90) * Math.PI) / 180;
                      const ox = acx + ar * Math.cos(rad);
                      const oy = acy + ar * Math.sin(rad);
                      const ix = acx + (ar - 10) * Math.cos(rad);
                      const iy = acy + (ar - 10) * Math.sin(rad);
                      return <line key={`ba-${angle}`} x1={ox} y1={oy} x2={ix} y2={iy} stroke="rgba(255,255,255,0.35)" strokeWidth={angle === 0 ? 2.5 : 1} />;
                    })}
                    {(() => {
                      const bRad = ((tiltDeg - 90) * Math.PI) / 180;
                      const bx = acx + (ar + 4) * Math.cos(bRad);
                      const by = acy + (ar + 4) * Math.sin(bRad);
                      return <polygon points={`${bx},${by} ${bx - 6},${by + 11} ${bx + 6},${by + 11}`} fill={ECAM.GREEN} />;
                    })()}
                  </g>
                );

                return elements;
              })()}

              {/* Volume RoC gauge (right side) */}
              <g>
                <rect x="350" y="40" width="55" height="280" fill="rgba(255,255,255,0.03)" stroke="rgba(255,255,255,0.06)" strokeWidth="0.8" rx="4" />
                <text x="377" y="32" textAnchor="middle" fill="rgba(255,255,255,0.4)" fontSize="9" fontFamily="monospace" fontWeight="bold">VOL RoC</text>
                <line x1="352" y1="180" x2="403" y2="180" stroke="rgba(255,255,255,0.2)" strokeWidth="0.8" />
                {(() => {
                  const clamp = Math.max(-50, Math.min(50, volRoC));
                  const barH = (Math.abs(clamp) / 50) * 120;
                  const col = volRoC >= 0 ? ECAM.GREEN : ECAM.RED;
                  return volRoC >= 0
                    ? <rect x="358" y={180 - barH} width="38" height={Math.max(1, barH)} fill={col} opacity="0.6" rx="3" style={{ transition: 'y 0.8s ease-out, height 0.8s ease-out, fill 0.6s' }} />
                    : <rect x="358" y="180" width="38" height={Math.max(1, barH)} fill={col} opacity="0.6" rx="3" style={{ transition: 'height 0.8s ease-out, fill 0.6s' }} />;
                })()}
                <text x="377" y="336" textAnchor="middle" fill={volRoC >= 0 ? ECAM.GREEN : ECAM.RED} fontSize="12" fontWeight="bold" fontFamily="monospace" style={{ transition: 'fill 0.6s' }}>
                  {volRoC > 0 ? '+' : ''}{volRoC.toFixed(1)}%
                </text>
                <text x="377" y="52" textAnchor="middle" fill={ECAM.GREEN} fontSize="8" fontFamily="monospace">BUY</text>
                <text x="377" y="318" textAnchor="middle" fill={ECAM.RED} fontSize="8" fontFamily="monospace">SELL</text>
              </g>

              {/* Volume summary */}
              <text x="180" y="370" textAnchor="middle" fill={ECAM.DIM} fontSize="10" fontFamily="monospace">
                BID {volumeProfile.totalBidVol.toFixed(1)} | ASK {volumeProfile.totalAskVol.toFixed(1)}
              </text>
            </svg>
          </Box>
        </Box>

        {/* ── RIGHT: RADAR CHART (Feature Importance Weights) ── */}
        <Box sx={{ p: 1.5, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <Typography sx={{ color: ECAM.WHITE, fontSize: '0.7rem', letterSpacing: '0.12em', mb: 0.5, fontWeight: 700 }}>
            NAV — FEATURE WEIGHTS
          </Typography>
          <svg width="100%" height="100%" viewBox="0 0 340 380" style={{ maxWidth: 340 }}>
            <rect x="0" y="0" width="340" height="380" fill="rgba(5,5,10,0.9)" rx="4" />

            {(() => {
              const cx = 170, cy = 185, maxR = 130;
              const n = featureWeights.length;
              if (n === 0) return <text x={cx} y={cy} textAnchor="middle" fill={ECAM.DIM} fontSize="12">NO DATA</text>;

              const angleStep = (2 * Math.PI) / n;
              const elements = [];

              // Concentric rings with percentage labels
              [0.25, 0.5, 0.75, 1].forEach((ring, ri) => {
                const r = maxR * ring;
                const pts = Array.from({ length: n }, (_, i) => {
                  const angle = -Math.PI / 2 + i * angleStep;
                  return `${cx + r * Math.cos(angle)},${cy + r * Math.sin(angle)}`;
                }).join(' ');
                elements.push(
                  <polygon key={`ring-${ri}`} points={pts} fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="0.7" />
                );
                elements.push(
                  <text key={`ring-lbl-${ri}`} x={cx + 4} y={cy - r + 4} fill="rgba(255,255,255,0.2)" fontSize="7" fontFamily="monospace">{(ring * 100).toFixed(0)}%</text>
                );
              });

              // Axis lines + labels
              featureWeights.forEach((fw, i) => {
                const angle = -Math.PI / 2 + i * angleStep;
                const x2 = cx + maxR * Math.cos(angle);
                const y2 = cy + maxR * Math.sin(angle);
                const lx = cx + (maxR + 20) * Math.cos(angle);
                const ly = cy + (maxR + 20) * Math.sin(angle);
                elements.push(
                  <line key={`axis-${i}`} x1={cx} y1={cy} x2={x2} y2={y2} stroke="rgba(255,255,255,0.08)" strokeWidth="0.7" />
                );
                elements.push(
                  <text key={`lbl-${i}`} x={lx} y={ly + 4} textAnchor="middle" fill={ECAM.DIM} fontSize="9" fontFamily="monospace" fontWeight="bold">
                    {fw.label}
                  </text>
                );
              });

              // Data polygon
              const dataPts = featureWeights.map((fw, i) => {
                const angle = -Math.PI / 2 + i * angleStep;
                const r = maxR * Math.max(0.05, fw.value);
                return `${cx + r * Math.cos(angle)},${cy + r * Math.sin(angle)}`;
              }).join(' ');
              elements.push(
                <polygon key="data" points={dataPts} fill="rgba(0,221,255,0.12)" stroke={ECAM.CYAN} strokeWidth="2" style={{ transition: 'all 0.8s ease-out' }} />
              );

              // Data points with value labels
              featureWeights.forEach((fw, i) => {
                const angle = -Math.PI / 2 + i * angleStep;
                const r = maxR * Math.max(0.05, fw.value);
                const px = cx + r * Math.cos(angle);
                const py = cy + r * Math.sin(angle);
                const dotColor = fw.value > 0.7 ? ECAM.AMBER : fw.value > 0.4 ? ECAM.GREEN : ECAM.CYAN;
                elements.push(
                  <circle key={`dot-${i}`} cx={px} cy={py} r="4.5" fill={dotColor} style={{ transition: 'cx 0.8s ease-out, cy 0.8s ease-out, fill 0.6s' }} />
                );
                // Value label near dot (with gap from dot)
                const vlx = cx + (r + 16) * Math.cos(angle);
                const vly = cy + (r + 16) * Math.sin(angle);
                elements.push(
                  <text key={`val-${i}`} x={vlx} y={vly + 3} textAnchor="middle" fill={dotColor} fontSize="8" fontFamily="monospace" fontWeight="bold" style={{ transition: 'x 0.8s ease-out, y 0.8s ease-out, fill 0.6s' }}>
                    {(fw.value * 100).toFixed(0)}
                  </text>
                );
              });

              return elements;
            })()}

            <text x="170" y="370" textAnchor="middle" fill={ECAM.DIM} fontSize="9" fontFamily="monospace">
              TECHNICAL WEIGHT ANALYSIS
            </text>
          </svg>
        </Box>
      </Box>

      {/* ═══ MAIN PANELS: PFD (Left) + E/WD (Right) ═══ */}
      <Box sx={{
        display: 'grid',
        gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' },
        gap: '2px',
        flex: 1,
        minHeight: 0,
      }}>

        {/* ═══ LEFT — PRIMARY FLIGHT DISPLAY ═══ */}
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>

          {/* MARKET STATE */}
          <Box sx={{ bgcolor: ECAM.PANEL, p: 1.5, border: `1px solid ${ECAM.BORDER}` }}>
            <Typography sx={{ color: ECAM.WHITE, fontSize: '0.65rem', letterSpacing: '0.15em', mb: 1, fontWeight: 700 }}>
              MARKET STATE
            </Typography>

            {/* OBI Gauge */}
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.8 }}>
              <Typography sx={{ color: ECAM.DIM, fontSize: '0.75rem' }}>OBI</Typography>
              <Box sx={{ flex: 1, mx: 1.5, height: 10, bgcolor: 'rgba(255,255,255,0.06)', borderRadius: 1, position: 'relative', overflow: 'hidden' }}>
                <Box sx={{
                  position: 'absolute',
                  top: 0, bottom: 0,
                  left: smoothedTech.obi >= 0 ? '50%' : `${50 + (smoothedTech.obi / 2)}%`,
                  width: `${Math.abs(smoothedTech.obi) / 2}%`,
                  bgcolor: smoothedTech.obi >= 0 ? ECAM.GREEN : ECAM.RED,
                  transition: 'all 0.3s',
                }} />
                {/* Center line */}
                <Box sx={{ position: 'absolute', left: '50%', top: 0, bottom: 0, width: 1, bgcolor: 'rgba(255,255,255,0.2)' }} />
              </Box>
              <Typography sx={{
                color: smoothedTech.obi >= 0 ? ECAM.GREEN : ECAM.RED,
                fontSize: '0.85rem', fontWeight: 700, minWidth: 65, textAlign: 'right',
              }}>
                {smoothedTech.obi > 0 ? '+' : ''}{smoothedTech.obi.toFixed(1)}%
              </Typography>
            </Box>

            {/* Wall Strength Gauge */}
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.8 }}>
              <Typography sx={{ color: ECAM.DIM, fontSize: '0.75rem' }}>WALLS</Typography>
              <Box sx={{ flex: 1, mx: 1.5, height: 10, bgcolor: 'rgba(255,255,255,0.06)', borderRadius: 1, position: 'relative', overflow: 'hidden' }}>
                <Box sx={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${(1 - smoothedTech.wallStrength) * 100}%`, bgcolor: ECAM.RED }} />
                <Box sx={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: `${smoothedTech.wallStrength * 100}%`, bgcolor: ECAM.GREEN }} />
              </Box>
              <Typography sx={{ color: ECAM.DIM, fontSize: '0.7rem', minWidth: 65, textAlign: 'right' }}>
                {(smoothedTech.wallStrength * 100).toFixed(0)}% BUY
              </Typography>
            </Box>

            {/* Wall Range + Nearest Walls */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.8 }}>
              <Typography sx={{ color: ECAM.DIM, fontSize: '0.65rem' }}>SCAN ±</Typography>
              {wallRangeOptions.map((opt) => (
                <Box key={opt} onClick={() => setWallRangePct(opt)} sx={{
                  px: 0.8, py: 0.15, borderRadius: 0.5, cursor: 'pointer', fontSize: '0.65rem', fontWeight: 700,
                  color: opt === wallRangePct ? ECAM.BG : ECAM.DIM,
                  bgcolor: opt === wallRangePct ? ECAM.GREEN : 'transparent',
                  border: `1px solid ${opt === wallRangePct ? ECAM.GREEN : 'rgba(255,255,255,0.12)'}`,
                }}>
                  {opt}%
                </Box>
              ))}
              <Box sx={{ flex: 1 }} />
              <Typography sx={{ color: ECAM.RED, fontSize: '0.7rem' }}>
                SELL {smoothedTech.nearestSellWallPct !== null ? `+${smoothedTech.nearestSellWallPct.toFixed(2)}%` : '—'}
              </Typography>
              <Typography sx={{ color: ECAM.DIM, fontSize: '0.7rem', mx: 0.5 }}>|</Typography>
              <Typography sx={{ color: ECAM.GREEN, fontSize: '0.7rem' }}>
                BUY {smoothedTech.nearestBuyWallPct !== null ? `${smoothedTech.nearestBuyWallPct.toFixed(2)}%` : '—'}
              </Typography>
            </Box>

            {/* Compact Wall List */}
            <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0.5 }}>
              <Box>
                <Typography sx={{ color: ECAM.RED, fontSize: '0.6rem', mb: 0.3, fontWeight: 700 }}>SELL ${smoothedTech.sellWallNotional.toLocaleString(undefined, { maximumFractionDigits: 0 })}</Typography>
                {smoothedTech.sellWalls.slice(0, 3).map((w, i) => (
                  <Box key={i} sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.2 }}>
                    <Typography sx={{ color: ECAM.RED, fontSize: '0.65rem', minWidth: 55 }}>${w.price.toFixed(4)}</Typography>
                    <Box sx={{ flex: 1, height: 4, bgcolor: 'rgba(255,255,255,0.06)', borderRadius: 1 }}>
                      <Box sx={{ height: '100%', width: `${(w.notional / smoothedTech.maxWallNotional) * 100}%`, bgcolor: 'rgba(255,34,34,0.8)', borderRadius: 1 }} />
                    </Box>
                  </Box>
                ))}
              </Box>
              <Box>
                <Typography sx={{ color: ECAM.GREEN, fontSize: '0.6rem', mb: 0.3, fontWeight: 700 }}>BUY ${smoothedTech.buyWallNotional.toLocaleString(undefined, { maximumFractionDigits: 0 })}</Typography>
                {smoothedTech.buyWalls.slice(0, 3).map((w, i) => (
                  <Box key={i} sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.2 }}>
                    <Typography sx={{ color: ECAM.GREEN, fontSize: '0.65rem', minWidth: 55 }}>${w.price.toFixed(4)}</Typography>
                    <Box sx={{ flex: 1, height: 4, bgcolor: 'rgba(255,255,255,0.06)', borderRadius: 1 }}>
                      <Box sx={{ height: '100%', width: `${(w.notional / smoothedTech.maxWallNotional) * 100}%`, bgcolor: 'rgba(0,255,136,0.8)', borderRadius: 1 }} />
                    </Box>
                  </Box>
                ))}
              </Box>
            </Box>
          </Box>

          {/* ENGINE INSTRUMENTS */}
          <Box sx={{ bgcolor: ECAM.PANEL, p: 1.5, border: `1px solid ${ECAM.BORDER}`, flex: 1 }}>
            <Typography sx={{ color: ECAM.WHITE, fontSize: '0.65rem', letterSpacing: '0.15em', mb: 1, fontWeight: 700 }}>
              ENGINE INSTRUMENTS
            </Typography>

            {/* RSI Gauge */}
            <Box sx={{ mb: 1 }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.3 }}>
                <Typography sx={{ color: ECAM.DIM, fontSize: '0.7rem' }}>RSI(14)</Typography>
                <Typography sx={{
                  color: smoothedTech.rsi < 30 ? ECAM.GREEN : smoothedTech.rsi > 70 ? ECAM.RED : ECAM.WHITE,
                  fontSize: '0.8rem', fontWeight: 700,
                }}>
                  {smoothedTech.rsi.toFixed(1)}
                  <Box component="span" sx={{ color: ECAM.DIM, fontSize: '0.65rem', ml: 0.3 }}>
                    {smoothedTech.rsi < 30 ? 'OVERSOLD' : smoothedTech.rsi > 70 ? 'OVERBOUGHT' : 'NEUTRAL'}
                  </Box>
                </Typography>
              </Box>
              <Box sx={{ height: 6, width: '60%', bgcolor: 'rgba(255,255,255,0.06)', borderRadius: 1, position: 'relative' }}>
                <Box sx={{
                  position: 'absolute', top: 0, bottom: 0, left: 0,
                  width: `${Math.min(smoothedTech.rsi, 100)}%`,
                  bgcolor: smoothedTech.rsi < 30 ? ECAM.GREEN : smoothedTech.rsi > 70 ? ECAM.RED : ECAM.CYAN,
                  borderRadius: 1, transition: 'all 0.3s',
                }} />
                {/* 30/70 markers */}
                <Box sx={{ position: 'absolute', left: '25%', top: -2, bottom: -2, width: 1, bgcolor: 'rgba(255,255,255,0.15)' }} />
                <Box sx={{ position: 'absolute', left: '75%', top: -2, bottom: -2, width: 1, bgcolor: 'rgba(255,255,255,0.15)' }} />
              </Box>
            </Box>

            {/* MACD + Signal */}
            <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
              <Typography sx={{ color: ECAM.DIM, fontSize: '0.7rem' }}>MACD</Typography>
              <Typography sx={{ color: smoothedTech.macd >= 0 ? ECAM.GREEN : ECAM.RED, fontSize: '0.78rem', fontWeight: 600 }}>
                {smoothedTech.macd > 0 ? '+' : ''}{smoothedTech.macd.toFixed(3)}
              </Typography>
              <Typography sx={{ color: smoothedTech.signal === 'bullish' ? ECAM.GREEN : ECAM.RED, fontSize: '0.7rem', fontWeight: 600 }}>
                {smoothedTech.signal.toUpperCase()}
              </Typography>
            </Box>

            {/* EMAs */}
            {[
              { label: 'EMA 20', value: smoothedTech.ema20, compare: smoothedTech.ema50, cmpLabel: '> 50' },
              { label: 'EMA 50', value: smoothedTech.ema50, compare: smoothedTech.ema200, cmpLabel: '> 200' },
              { label: 'EMA 200', value: smoothedTech.ema200, compare: smoothedTech.midPrice, cmpLabel: 'vs MID' },
            ].map(({ label, value, compare, cmpLabel }) => (
              <Box key={label} sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.3 }}>
                <Typography sx={{ color: ECAM.DIM, fontSize: '0.7rem' }}>{label}</Typography>
                <Typography sx={{ color: ECAM.WHITE, fontSize: '0.75rem' }}>
                  ${value.toFixed(4)}
                </Typography>
                <Typography sx={{ color: value > compare ? ECAM.GREEN : ECAM.AMBER, fontSize: '0.65rem' }}>
                  {value > compare ? '▲' : '▼'} {cmpLabel}
                </Typography>
              </Box>
            ))}

            {/* VWAP */}
            <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
              <Typography sx={{ color: ECAM.DIM, fontSize: '0.7rem' }}>VWAP</Typography>
              <Typography sx={{ color: ECAM.WHITE, fontSize: '0.75rem' }}>${smoothedTech.vwap.toFixed(4)}</Typography>
              <Typography sx={{ color: smoothedTech.midPrice > smoothedTech.vwap ? ECAM.GREEN : ECAM.RED, fontSize: '0.65rem' }}>
                {smoothedTech.midPrice > smoothedTech.vwap ? 'ABOVE' : 'BELOW'}
              </Typography>
            </Box>

            {/* Heikin Ashi + Trend */}
            <Box sx={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              mt: 1, pt: 1, borderTop: `1px solid ${ECAM.BORDER}`,
            }}>
              <Typography sx={{ color: ECAM.DIM, fontSize: '0.7rem' }}>HEIKIN</Typography>
              <Box sx={{ display: 'flex', gap: 0.3 }}>
                {[0, 1, 2, 3].map(i => (
                  <Typography key={i} sx={{ color: smoothedTech.heikinAshi ? ECAM.GREEN : ECAM.RED, fontSize: '0.9rem' }}>
                    {smoothedTech.heikinAshi ? '▲' : '▼'}
                  </Typography>
                ))}
              </Box>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Typography sx={{
                  color: isBullish ? ECAM.GREEN : ECAM.RED,
                  fontSize: '0.78rem', fontWeight: 700,
                }}>
                  {isBullish ? 'BULLISH' : 'BEARISH'}
                </Typography>
                <Typography sx={{
                  color: isBullish ? ECAM.GREEN : ECAM.RED,
                  fontSize: '0.9rem', fontWeight: 800,
                }}>
                  {trendScore > 0 ? '+' : ''}{trendScore}
                </Typography>
              </Box>
            </Box>
          </Box>
        </Box>

        {/* ═══ RIGHT — E/WD (ECAM Warning Display) ═══ */}
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>

          {/* ECAM MESSAGES */}
          <Box sx={{ bgcolor: ECAM.PANEL, p: 1.5, border: `1px solid ${ECAM.BORDER}`, minHeight: 120 }}>
            <Typography sx={{ color: ECAM.WHITE, fontSize: '0.65rem', letterSpacing: '0.15em', mb: 1, fontWeight: 700 }}>
              E/WD — MESSAGES
            </Typography>

            {ecamMessages.length === 0 ? (
              <Typography sx={{ color: ECAM.GREEN, fontSize: '0.78rem', fontWeight: 600 }}>
                ■ NORMAL — NO ALERTS
              </Typography>
            ) : (
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.4 }}>
                {ecamMessages.map((msg, i) => (
                  <Box key={i} sx={{ display: 'flex', alignItems: 'flex-start', gap: 0.8 }}>
                    <Typography sx={{
                      color: severityColor(msg.severity),
                      fontSize: '0.72rem',
                      fontWeight: 800,
                      minWidth: 5,
                    }}>
                      {msg.severity === 'warning' ? '■' : msg.severity === 'caution' ? '▲' : '●'}
                    </Typography>
                    <Typography sx={{
                      color: severityColor(msg.severity),
                      fontSize: '0.72rem',
                      fontWeight: msg.severity === 'warning' ? 800 : 600,
                      minWidth: 42,
                    }}>
                      {msg.system}
                    </Typography>
                    <Typography sx={{
                      color: severityColor(msg.severity),
                      fontSize: '0.72rem',
                      fontWeight: msg.severity === 'warning' ? 700 : 400,
                    }}>
                      {msg.text}
                    </Typography>
                  </Box>
                ))}
              </Box>
            )}
          </Box>

          {/* PROCEDURES / CHECKLIST */}
          <Box sx={{ bgcolor: ECAM.PANEL, p: 1.5, border: `1px solid ${ECAM.BORDER}`, flex: 1 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
              <Typography sx={{ color: ECAM.WHITE, fontSize: '0.65rem', letterSpacing: '0.15em', fontWeight: 700 }}>
                PROC — {procedures.title}
              </Typography>
              <Box
                onClick={() => setCheckedItems({})}
                sx={{ cursor: 'pointer', px: 0.8, py: 0.2, borderRadius: 0.5, bgcolor: 'rgba(255,255,255,0.05)', '&:hover': { bgcolor: 'rgba(255,255,255,0.1)' } }}
              >
                <Typography sx={{ color: ECAM.DIM, fontSize: '0.6rem' }}>RESET</Typography>
              </Box>
            </Box>

            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
              {procedures.items.map((item) => {
                const isChecked = checkedItems[item.key] || item.status === 'done';
                return (
                  <Box
                    key={item.key}
                    onClick={() => toggleCheck(item.key)}
                    sx={{
                      display: 'flex', alignItems: 'center', gap: 1,
                      cursor: 'pointer', px: 0.8, py: 0.4,
                      borderRadius: 0.5,
                      bgcolor: isChecked ? 'rgba(0,255,136,0.04)' : 'transparent',
                      '&:hover': { bgcolor: 'rgba(255,255,255,0.03)' },
                      transition: 'all 0.15s',
                    }}
                  >
                    <Box sx={{
                      width: 14, height: 14, borderRadius: 0.5,
                      border: `1.5px solid ${isChecked ? ECAM.GREEN : ECAM.CYAN}`,
                      bgcolor: isChecked ? ECAM.GREEN : 'transparent',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      flexShrink: 0,
                    }}>
                      {isChecked && (
                        <Typography sx={{ color: ECAM.BG, fontSize: '0.6rem', fontWeight: 900, lineHeight: 1 }}>✓</Typography>
                      )}
                    </Box>
                    <Typography sx={{
                      color: isChecked ? ECAM.GREEN : ECAM.CYAN,
                      fontSize: '0.72rem',
                      textDecoration: isChecked ? 'line-through' : 'none',
                      opacity: isChecked ? 0.6 : 1,
                    }}>
                      {item.action}
                    </Typography>
                  </Box>
                );
              })}
            </Box>

            {/* Regime Transitions */}
            <Box sx={{ mt: 1.5, pt: 1, borderTop: `1px solid ${ECAM.BORDER}` }}>
              <Typography sx={{ color: ECAM.DIM, fontSize: '0.6rem', letterSpacing: '0.1em', mb: 0.5 }}>
                REGIME TRANSITIONS
              </Typography>
              {history.regimeTransitions.length === 0 ? (
                <Typography sx={{ color: ECAM.DIM, fontSize: '0.68rem' }}>No transitions recorded</Typography>
              ) : (
                history.regimeTransitions.slice(-4).map((t, i) => (
                  <Typography key={i} sx={{ color: ECAM.MAGENTA, fontSize: '0.68rem' }}>
                    {t[0]} → {t[1]}
                  </Typography>
                ))
              )}
            </Box>
          </Box>
        </Box>
      </Box>

      {/* ═══ PARETO TAIL RISK & DYNAMIC REGIME ═══ */}
      <ParetoMonitor />
    </Box>
  );
};

export default React.memo(CockpitPanel);
