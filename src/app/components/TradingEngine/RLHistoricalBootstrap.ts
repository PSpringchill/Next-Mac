// ─── RL Historical Bootstrap ─────────────────────────────────────────────────
// Fetches 1m klines (last 6 hours) from Binance via /api/klines,
// replays them through RLDataCollector to build the indicator buffer,
// then triggers multiple training rounds on RLBacktestTrainer.
// Also attempts to load the latest saved model version on startup.

import RLDataCollector from './RLDataCollector';
import RLBacktestTrainer from './RLBacktestTrainer';
import A3CProtectAgent from './A3CProtectAgent';

// ─── Kline format from Binance ──────────────────────────────────────────────
// [openTime, open, high, low, close, volume, closeTime, quoteAssetVolume, ...]

interface Kline {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

function parseKlines(raw: any[]): Kline[] {
  return raw.map(k => ({
    openTime: k[0],
    open: parseFloat(k[1]),
    high: parseFloat(k[2]),
    low: parseFloat(k[3]),
    close: parseFloat(k[4]),
    volume: parseFloat(k[5]),
  })).filter(k => k.close > 0 && Number.isFinite(k.close));
}

// ─── Bootstrap State ────────────────────────────────────────────────────────

export interface BootstrapState {
  status: 'idle' | 'fetching' | 'replaying' | 'training' | 'saving' | 'done' | 'error';
  candlesFetched: number;
  candlesReplayed: number;
  trainRounds: number;
  modelVersion: string | null;
  loadedVersion: string | null;
  error: string | null;
  elapsedMs: number;
}

// ─── Bootstrap Runner ───────────────────────────────────────────────────────

export async function bootstrapFromHistory(
  symbol: string,
  collector: RLDataCollector,
  trainer: RLBacktestTrainer,
  protectAgent: A3CProtectAgent | null,
  onProgress?: (state: BootstrapState) => void,
): Promise<BootstrapState> {
  const state: BootstrapState = {
    status: 'idle',
    candlesFetched: 0,
    candlesReplayed: 0,
    trainRounds: 0,
    modelVersion: null,
    loadedVersion: null,
    error: null,
    elapsedMs: 0,
  };
  const t0 = performance.now();
  const emit = () => {
    state.elapsedMs = performance.now() - t0;
    onProgress?.({ ...state });
  };

  try {
    // ─── 1. Try to load latest saved model ────────────────────────────
    const dqnVersions = RLBacktestTrainer.getModelVersions();
    if (dqnVersions.length > 0) {
      const latest = dqnVersions[dqnVersions.length - 1];
      const loaded = await trainer.loadModel(latest.tag);
      if (loaded) {
        state.loadedVersion = latest.tag;
        console.log(`[Bootstrap] Loaded DQN model: ${latest.tag}`);
      }
    }

    const a3cVersions = A3CProtectAgent.getModelVersions();
    if (a3cVersions.length > 0 && protectAgent) {
      const latest = a3cVersions[a3cVersions.length - 1];
      const loaded = await protectAgent.loadModel(latest.tag);
      if (loaded) {
        console.log(`[Bootstrap] Loaded A3C model: ${latest.tag}`);
      }
    }

    // ─── 2. Fetch 1m klines (last 6 hours = 360 candles) ─────────────
    state.status = 'fetching';
    emit();

    const resp = await fetch(`/api/klines?symbol=${encodeURIComponent(symbol)}&interval=1m&limit=1000`);
    if (!resp.ok) {
      throw new Error(`Klines API returned ${resp.status}`);
    }
    const rawKlines = await resp.json();
    if (!Array.isArray(rawKlines) || rawKlines.length === 0) {
      throw new Error('No kline data returned');
    }

    const klines = parseKlines(rawKlines);
    state.candlesFetched = klines.length;
    emit();
    console.log(`[Bootstrap] Fetched ${klines.length} candles for ${symbol}`);

    // ─── 3. Replay candles through RLDataCollector ────────────────────
    state.status = 'replaying';
    emit();

    // We feed close prices with synthetic technicals derived from candle data.
    // The RLDataCollector builds its own EMAs, VWAP, etc. from price history.
    // We pass null for technicals/linReg since the collector can compute
    // most features from price alone, and the TechnicalIndicators module
    // isn't available for offline replay (it requires live state).
    for (let i = 0; i < klines.length; i++) {
      const k = klines[i];
      const spread = (k.high - k.low) * 0.001; // synthetic spread
      const obi = (k.close > k.open) ? 0.3 : (k.close < k.open) ? -0.3 : 0; // synthetic OBI

      collector.collect(k.close, null, null, obi, spread, k.volume);
      state.candlesReplayed = i + 1;

      // Emit progress every 50 candles
      if (i % 50 === 0) emit();
    }
    emit();
    console.log(`[Bootstrap] Replayed ${klines.length} candles → buffer size: ${collector.getBuffer().length}`);

    // ─── 4. Run multiple training rounds ──────────────────────────────
    state.status = 'training';
    emit();

    const buffer = collector.getBuffer();
    const trainRounds = Math.min(30, Math.floor(buffer.length / 50));

    for (let r = 0; r < trainRounds; r++) {
      trainer.runExternalTraining(buffer);
      state.trainRounds = r + 1;
      emit();
    }
    console.log(`[Bootstrap] Completed ${trainRounds} training rounds`);

    // ─── 5. Auto-save model version ───────────────────────────────────
    state.status = 'saving';
    emit();

    // Warm-start: reduce epsilon after pre-training (exploit what was learned)
    trainer.warmStart(0.3);

    const tag = await trainer.saveModel(`bootstrap-${symbol}-${Date.now()}`);
    state.modelVersion = tag;

    if (protectAgent) {
      await protectAgent.saveModel(`bootstrap-${symbol}-${Date.now()}`);
    }

    state.status = 'done';
    emit();
    console.log(`[Bootstrap] Done in ${state.elapsedMs.toFixed(0)}ms — model: ${tag}`);

    return state;

  } catch (err: any) {
    state.status = 'error';
    state.error = err?.message ?? String(err);
    emit();
    console.error('[Bootstrap] Error:', err);
    return state;
  }
}

export default bootstrapFromHistory;
