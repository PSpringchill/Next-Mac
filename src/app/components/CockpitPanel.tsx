'use client';

import React, { useMemo, useState, useContext, useCallback, useRef, useEffect } from 'react';
import { Box, Typography } from '@mui/material';
import { useMLEngine } from '../api/MLContext';
import { OrderBookContext } from '../api/Page';
import { useRiskManager } from '../api/RiskContext';
import { useTradingStore } from '@stores/tradingStore';
import { AlphaRiskState } from './TradingEngine/ParetoAnalyzer';
import ParetoMonitor from './ParetoMonitor';
import { ECAM, EcamMessage, ChecklistItem, SmoothedTechData, severityOrder } from './cockpit/ecamTheme';
import SpeedTape from './cockpit/SpeedTape';
import AttitudeIndicator from './cockpit/AttitudeIndicator';
import FeatureRadar from './cockpit/FeatureRadar';
import MarketStatePanel from './cockpit/MarketStatePanel';
import EngineInstruments from './cockpit/EngineInstruments';
import EcamWarningDisplay from './cockpit/EcamWarningDisplay';

// ─── COMPONENT ───
const CockpitPanel: React.FC = () => {
  const orderBookContext = useContext(OrderBookContext);
  const { mlPrediction, regime, learner, history } = useMLEngine();
  const { portfolioState, status, config } = useRiskManager();
  const paretoState = useTradingStore((s) => s.paretoState);
  const radarVector = useTradingStore((s) => s.radarVector);
  const dynamicRegime = useTradingStore((s) => s.dynamicRegime);
  const signalFilter = useTradingStore((s) => s.signalFilter);
  const circuitBreaker = useTradingStore((s) => s.circuitBreaker);
  const [wallRangePct, setWallRangePct] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('speedTapeScale');
      if (saved) { const n = parseFloat(saved); if (!isNaN(n) && n > 0) return n; }
    }
    return 5;
  });
  useEffect(() => { localStorage.setItem('speedTapeScale', String(wallRangePct)); }, [wallRangePct]);
  const [checkedItems, setCheckedItems] = useState<Record<string, boolean>>({});
  const wallRangeOptions = [2, 5, 10];
  const scaleSteps = [0.5, 1, 2, 3, 5, 7, 10, 15, 20];
  const handleScaleUp = useCallback(() => {
    setWallRangePct(prev => {
      const idx = scaleSteps.indexOf(prev);
      return idx > 0 ? scaleSteps[idx - 1] : scaleSteps[0];
    });
  }, []);
  const handleScaleDown = useCallback(() => {
    setWallRangePct(prev => {
      const idx = scaleSteps.indexOf(prev);
      if (idx >= 0 && idx < scaleSteps.length - 1) return scaleSteps[idx + 1];
      const next = scaleSteps.find(s => s > prev);
      return next ?? scaleSteps[scaleSteps.length - 1];
    });
  }, []);

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

  // Cast smoothedTech to typed interface for sub-components
  const techData = smoothedTech as SmoothedTechData;

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
        <Box sx={{ display: 'flex', gap: 2, p: 0.5, alignItems: 'flex-start', justifyContent: 'center' }}>
          <SpeedTape smoothedTech={techData} wallRangePct={wallRangePct} priceRoC={priceRoC} radarVector={radarVector} dynamicRegime={dynamicRegime} onScaleUp={handleScaleUp} onScaleDown={handleScaleDown} />
          <AttitudeIndicator volumeProfile={volumeProfile} volRoC={volRoC} radarVector={radarVector} dynamicRegime={dynamicRegime} linReg={signalFilter?.linReg} currentPrice={techData.midPrice} circuitBreaker={circuitBreaker} />
        </Box>
        <FeatureRadar featureWeights={featureWeights} />
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
          <MarketStatePanel
            smoothedTech={techData}
            wallRangePct={wallRangePct}
            setWallRangePct={setWallRangePct}
            wallRangeOptions={wallRangeOptions}
          />
          <EngineInstruments smoothedTech={techData} isBullish={isBullish} trendScore={trendScore} />
        </Box>

        {/* ═══ RIGHT — E/WD (ECAM Warning Display) ═══ */}
        <EcamWarningDisplay
          ecamMessages={ecamMessages}
          procedures={procedures}
          checkedItems={checkedItems}
          toggleCheck={toggleCheck}
          resetChecks={() => setCheckedItems({})}
          regimeTransitions={history.regimeTransitions}
        />
      </Box>

      {/* ═══ PARETO TAIL RISK & DYNAMIC REGIME ═══ */}
      <ParetoMonitor />
    </Box>
  );
};

export default React.memo(CockpitPanel);
