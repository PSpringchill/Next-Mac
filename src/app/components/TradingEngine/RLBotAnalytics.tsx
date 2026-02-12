'use client';

// ─── RL Bot Analytics & Performance Dashboard ────────────────────────────────
// Real-time learning curves, stability metrics, sample efficiency,
// and multi-agent performance visualization for RL trading bots.

import React, { useRef, useCallback, useEffect, useMemo } from 'react';
import { Box, Typography } from '@mui/material';
import { useTradingStore } from '@stores/tradingStore';

// ─── ECAM-inspired color palette ────────────────────────────────────────────

const C = {
  bg: '#0a0a14',
  panel: 'rgba(255,255,255,0.02)',
  border: 'rgba(255,255,255,0.06)',
  dim: 'rgba(255,255,255,0.35)',
  text: 'rgba(255,255,255,0.7)',
  white: '#e0e0e0',
  green: '#00ff88',
  red: '#ff3333',
  amber: '#ffaa00',
  cyan: '#00ddff',
  magenta: '#ff44ff',
  blue: '#4488ff',
  // Chart palette
  reward: '#00ff88',
  loss: '#ff3333',
  epsilon: '#ffaa00',
  value: '#00ddff',
  confidence: '#ff44ff',
  winRate: '#4488ff',
  pnl: '#00ff88',
  sharpe: '#ffaa00',
  drawdown: '#ff3333',
  buffer: 'rgba(255,255,255,0.15)',
};

const HISTORY_MAX = 300;

// ─── Metric history tracker ─────────────────────────────────────────────────

interface MetricPoint {
  tick: number;
  value: number;
}

interface MetricHistory {
  reward: MetricPoint[];
  loss: MetricPoint[];
  epsilon: MetricPoint[];
  value: MetricPoint[];
  confidence: MetricPoint[];
  winRate: MetricPoint[];
  pnl: MetricPoint[];
  sharpe: MetricPoint[];
  actorLoss: MetricPoint[];
  criticLoss: MetricPoint[];
  hedgeRatio: MetricPoint[];
  gridLevel: MetricPoint[];
  protectReward: MetricPoint[];
}

function pushMetric(arr: MetricPoint[], tick: number, value: number): void {
  arr.push({ tick, value });
  if (arr.length > HISTORY_MAX) arr.shift();
}

// ─── Mini sparkline canvas renderer ─────────────────────────────────────────

function drawSparkline(
  canvas: HTMLCanvasElement,
  data: MetricPoint[],
  color: string,
  opts?: { min?: number; max?: number; fill?: boolean; zeroLine?: boolean },
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx || data.length < 2) return;

  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth * dpr;
  const h = canvas.clientHeight * dpr;
  canvas.width = w;
  canvas.height = h;

  ctx.clearRect(0, 0, w, h);

  const values = data.map(d => d.value);
  const minV = opts?.min ?? Math.min(...values);
  const maxV = opts?.max ?? Math.max(...values);
  const range = maxV - minV || 1;

  // Zero line
  if (opts?.zeroLine && minV < 0 && maxV > 0) {
    const zeroY = h - ((0 - minV) / range) * h;
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(0, zeroY);
    ctx.lineTo(w, zeroY);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Fill area
  if (opts?.fill) {
    ctx.beginPath();
    const baseY = opts?.zeroLine ? h - ((0 - minV) / range) * h : h;
    for (let i = 0; i < data.length; i++) {
      const x = (i / (data.length - 1)) * w;
      const y = h - ((values[i] - minV) / range) * h;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.lineTo(w, baseY);
    ctx.lineTo(0, baseY);
    ctx.closePath();
    ctx.fillStyle = color.replace(')', ',0.08)').replace('rgb', 'rgba');
    ctx.fill();
  }

  // Line
  ctx.beginPath();
  for (let i = 0; i < data.length; i++) {
    const x = (i / (data.length - 1)) * w;
    const y = h - ((values[i] - minV) / range) * h;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5 * dpr;
  ctx.stroke();

  // Last value dot
  const lastX = w;
  const lastY = h - ((values[values.length - 1] - minV) / range) * h;
  ctx.beginPath();
  ctx.arc(lastX - 2, lastY, 2.5 * dpr, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
}

// ─── Metric Card ────────────────────────────────────────────────────────────

interface MetricCardProps {
  label: string;
  value: string;
  color: string;
  data: MetricPoint[];
  sparkOpts?: { min?: number; max?: number; fill?: boolean; zeroLine?: boolean };
  subLabel?: string;
}

const MetricCard: React.FC<MetricCardProps> = React.memo(({ label, value, color, data, sparkOpts, subLabel }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (canvasRef.current && data.length >= 2) {
      drawSparkline(canvasRef.current, data, color, sparkOpts);
    }
  }, [data, color, sparkOpts]);

  return (
    <Box sx={{
      bgcolor: C.panel, border: `1px solid ${C.border}`, borderRadius: '4px',
      p: 0.8, display: 'flex', flexDirection: 'column', minWidth: 0,
    }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', mb: 0.3 }}>
        <Typography sx={{ color: C.dim, fontSize: '0.55rem', letterSpacing: '0.08em', fontWeight: 600, textTransform: 'uppercase' }}>
          {label}
        </Typography>
        <Typography sx={{ color, fontSize: '0.7rem', fontWeight: 800, fontFamily: 'monospace' }}>
          {value}
        </Typography>
      </Box>
      <canvas ref={canvasRef} style={{ width: '100%', height: 32 }} />
      {subLabel && (
        <Typography sx={{ color: C.dim, fontSize: '0.5rem', fontFamily: 'monospace', mt: 0.2, textAlign: 'right' }}>
          {subLabel}
        </Typography>
      )}
    </Box>
  );
});
MetricCard.displayName = 'MetricCard';

// ─── Action distribution bar ────────────────────────────────────────────────

const ACTION_COLORS = [
  '#ff3333', // STRONG_SELL
  '#ff8844', // SELL
  '#888888', // HOLD
  '#44cc88', // BUY
  '#00ff88', // STRONG_BUY
];

const PROTECT_ACTION_COLORS = [
  '#666666', // HOLD
  '#ffaa00', // REDUCE_25
  '#ff8800', // REDUCE_50
  '#ff3333', // CLOSE_ALL
  '#4488ff', // HEDGE_PARTIAL
  '#0066ff', // HEDGE_FULL
  '#00ddff', // GRID_ENTRY
  '#ff44ff', // MARTINGALE
  '#00ff88', // TRAIL_STOP
];

const PROTECT_ACTION_NAMES = [
  'HOLD', 'RED25', 'RED50', 'CLOSE', 'H50', 'H100', 'GRID', 'MART', 'TRAIL'
];

interface ActionBarProps {
  probs: number[];
  colors: string[];
  labels: string[];
  title: string;
}

const ActionBar: React.FC<ActionBarProps> = React.memo(({ probs, colors, labels, title }) => {
  const total = probs.reduce((s, p) => s + p, 0) || 1;
  return (
    <Box sx={{ bgcolor: C.panel, border: `1px solid ${C.border}`, borderRadius: '4px', p: 0.8 }}>
      <Typography sx={{ color: C.dim, fontSize: '0.55rem', letterSpacing: '0.08em', fontWeight: 600, mb: 0.5, textTransform: 'uppercase' }}>
        {title}
      </Typography>
      <Box sx={{ display: 'flex', height: 16, borderRadius: '2px', overflow: 'hidden' }}>
        {probs.map((p, i) => {
          const pct = (p / total) * 100;
          if (pct < 0.5) return null;
          return (
            <Box key={i} sx={{
              width: `${pct}%`, bgcolor: colors[i] || '#666',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              transition: 'width 0.3s',
            }}>
              {pct > 8 && (
                <Typography sx={{ color: '#000', fontSize: '0.45rem', fontWeight: 800, lineHeight: 1 }}>
                  {labels[i]}
                </Typography>
              )}
            </Box>
          );
        })}
      </Box>
    </Box>
  );
});
ActionBar.displayName = 'ActionBar';

// ─── Stability meter (rolling std of reward) ────────────────────────────────

function computeStability(data: MetricPoint[], window: number = 50): { mean: number; std: number; stability: number } {
  if (data.length < window) return { mean: 0, std: 0, stability: 0 };
  const recent = data.slice(-window).map(d => d.value);
  const mean = recent.reduce((s, v) => s + v, 0) / recent.length;
  const variance = recent.reduce((s, v) => s + (v - mean) ** 2, 0) / recent.length;
  const std = Math.sqrt(variance);
  const stability = mean !== 0 ? 1 / (1 + std / Math.abs(mean)) : 0;
  return { mean, std, stability };
}

// ─── Sample efficiency (reward per training step) ───────────────────────────

function sampleEfficiency(rewards: MetricPoint[], trainSteps: number): number {
  if (trainSteps === 0 || rewards.length === 0) return 0;
  const totalReward = rewards.reduce((s, p) => s + p.value, 0);
  return totalReward / trainSteps;
}

// ─── Main Component ─────────────────────────────────────────────────────────

const RLBotAnalytics: React.FC = () => {
  const rlTrainer = useTradingStore((s) => s.rlTrainer);
  const rlCollector = useTradingStore((s) => s.rlCollector);
  const protectAgent = useTradingStore((s) => s.protectAgent);
  const bootstrapState = useTradingStore((s) => s.bootstrapState);

  // Persistent metric history
  const histRef = useRef<MetricHistory>({
    reward: [], loss: [], epsilon: [], value: [], confidence: [],
    winRate: [], pnl: [], sharpe: [], actorLoss: [], criticLoss: [],
    hedgeRatio: [], gridLevel: [], protectReward: [],
  });

  const tickRef = useRef(0);

  // Update history on each render with new data
  const updateHistory = useCallback(() => {
    const h = histRef.current;
    const t = ++tickRef.current;

    if (rlTrainer) {
      pushMetric(h.reward, t, rlTrainer.avgReward);
      pushMetric(h.loss, t, rlTrainer.lastLoss);
      pushMetric(h.epsilon, t, rlTrainer.epsilon);
      pushMetric(h.confidence, t, rlTrainer.currentConfidence);
      pushMetric(h.winRate, t, rlTrainer.lastBacktestWinRate);
      pushMetric(h.pnl, t, rlTrainer.cumulativePnL);
      pushMetric(h.sharpe, t, rlTrainer.lastBacktestSharpe);
    }

    if (protectAgent) {
      pushMetric(h.value, t, protectAgent.value);
      pushMetric(h.actorLoss, t, protectAgent.lastActorLoss);
      pushMetric(h.criticLoss, t, protectAgent.lastCriticLoss);
      pushMetric(h.hedgeRatio, t, protectAgent.gridMartingale.hedgeRatio);
      pushMetric(h.gridLevel, t, protectAgent.gridMartingale.gridOrders.length);
      pushMetric(h.protectReward, t, protectAgent.avgReward);
    }
  }, [rlTrainer, protectAgent]);

  useEffect(() => { updateHistory(); }, [updateHistory]);

  const h = histRef.current;

  // Stability metrics
  const rewardStability = useMemo(() => computeStability(h.reward), [h.reward.length]);
  const protectStability = useMemo(() => computeStability(h.protectReward), [h.protectReward.length]);

  // Sample efficiency
  const rlEfficiency = useMemo(
    () => sampleEfficiency(h.reward, rlTrainer?.totalTrainSteps ?? 0),
    [h.reward.length, rlTrainer?.totalTrainSteps],
  );
  const protectEfficiency = useMemo(
    () => sampleEfficiency(h.protectReward, protectAgent?.totalTrainSteps ?? 0),
    [h.protectReward.length, protectAgent?.totalTrainSteps],
  );

  // No data state
  const noData = !rlTrainer && !protectAgent;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, width: '100%' }}>
      {/* ─── Header ───────────────────────────────────────────────────── */}
      <Box sx={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        px: 1, py: 0.5, bgcolor: C.panel, borderRadius: '4px', border: `1px solid ${C.border}`,
      }}>
        <Typography sx={{ color: C.white, fontSize: '0.65rem', letterSpacing: '0.12em', fontWeight: 700 }}>
          RL BOT — ANALYTICS & PERFORMANCE
        </Typography>
        <Box sx={{ display: 'flex', gap: 1.5 }}>
          <Typography sx={{
            color: rlTrainer?.isWarmedUp ? C.green : C.amber,
            fontSize: '0.6rem', fontFamily: 'monospace', fontWeight: 700,
          }}>
            DQN:{rlTrainer?.isWarmedUp ? 'ONLINE' : 'WARMUP'}
          </Typography>
          <Typography sx={{
            color: (protectAgent?.totalTrainSteps ?? 0) > 0 ? C.cyan : C.amber,
            fontSize: '0.6rem', fontFamily: 'monospace', fontWeight: 700,
          }}>
            A3C:{(protectAgent?.totalTrainSteps ?? 0) > 0 ? 'ONLINE' : 'WARMUP'}
          </Typography>
          <Typography sx={{ color: C.dim, fontSize: '0.6rem', fontFamily: 'monospace' }}>
            BUF:{rlCollector?.bufferSize ?? 0}
          </Typography>
          {bootstrapState && (
            <Typography sx={{
              color: bootstrapState.status === 'done' ? C.green
                : bootstrapState.status === 'error' ? C.red
                : C.amber,
              fontSize: '0.6rem', fontFamily: 'monospace', fontWeight: 700,
            }}>
              BOOT:{bootstrapState.status.toUpperCase()}
              {bootstrapState.status === 'replaying' ? ` ${bootstrapState.candlesReplayed}/${bootstrapState.candlesFetched}` : ''}
              {bootstrapState.status === 'training' ? ` R${bootstrapState.trainRounds}` : ''}
              {bootstrapState.status === 'done' ? ` ${bootstrapState.candlesFetched}c ${bootstrapState.trainRounds}r ${bootstrapState.elapsedMs.toFixed(0)}ms` : ''}
            </Typography>
          )}
        </Box>
      </Box>

      {/* Bootstrap / Model Version Info */}
      {bootstrapState && bootstrapState.status === 'done' && (
        <Box sx={{
          display: 'flex', gap: 2, px: 1, py: 0.4,
          bgcolor: 'rgba(0,255,136,0.03)', borderRadius: '4px', border: `1px solid rgba(0,255,136,0.1)`,
          alignItems: 'center',
        }}>
          <Typography sx={{ color: C.green, fontSize: '0.55rem', fontFamily: 'monospace', fontWeight: 700 }}>
            BOOTSTRAPPED
          </Typography>
          <Typography sx={{ color: C.dim, fontSize: '0.55rem', fontFamily: 'monospace' }}>
            {bootstrapState.candlesFetched} candles (6h 1m) → {bootstrapState.trainRounds} train rounds
          </Typography>
          {bootstrapState.loadedVersion && (
            <Typography sx={{ color: C.cyan, fontSize: '0.55rem', fontFamily: 'monospace' }}>
              Restored: {bootstrapState.loadedVersion}
            </Typography>
          )}
          {bootstrapState.modelVersion && (
            <Typography sx={{ color: C.amber, fontSize: '0.55rem', fontFamily: 'monospace' }}>
              Saved: {bootstrapState.modelVersion}
            </Typography>
          )}
        </Box>
      )}

      {noData && !bootstrapState && (
        <Box sx={{ p: 3, textAlign: 'center' }}>
          <Typography sx={{ color: C.dim, fontSize: '0.7rem' }}>
            Waiting for market data — RL agents will begin collecting and training automatically...
          </Typography>
        </Box>
      )}

      {bootstrapState && bootstrapState.status === 'error' && (
        <Box sx={{ px: 1, py: 0.4, bgcolor: 'rgba(255,0,0,0.05)', borderRadius: '4px', border: `1px solid rgba(255,0,0,0.15)` }}>
          <Typography sx={{ color: C.red, fontSize: '0.55rem', fontFamily: 'monospace' }}>
            Bootstrap error: {bootstrapState.error}
          </Typography>
        </Box>
      )}

      {/* ─── DQN Entry Agent — Learning Curves ────────────────────────── */}
      {rlTrainer && (
        <>
          <Typography sx={{ color: C.cyan, fontSize: '0.6rem', letterSpacing: '0.1em', fontWeight: 700, px: 0.5 }}>
            ▎ DQN ENTRY AGENT — LEARNING CURVES
          </Typography>
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 1 }}>
            <MetricCard
              label="Avg Reward" value={rlTrainer.avgReward.toFixed(4)} color={C.reward}
              data={h.reward} sparkOpts={{ zeroLine: true, fill: true }}
              subLabel={`σ=${rewardStability.std.toFixed(3)} stab=${(rewardStability.stability * 100).toFixed(0)}%`}
            />
            <MetricCard
              label="Training Loss" value={rlTrainer.lastLoss.toFixed(6)} color={C.loss}
              data={h.loss} sparkOpts={{ min: 0 }}
              subLabel={`steps=${rlTrainer.totalTrainSteps}`}
            />
            <MetricCard
              label="Epsilon (ε)" value={rlTrainer.epsilon.toFixed(4)} color={C.epsilon}
              data={h.epsilon} sparkOpts={{ min: 0, max: 1 }}
              subLabel={`${((1 - rlTrainer.epsilon) * 100).toFixed(0)}% exploit`}
            />
            <MetricCard
              label="Confidence" value={rlTrainer.currentConfidence.toFixed(3)} color={C.confidence}
              data={h.confidence} sparkOpts={{ min: 0, max: 1, fill: true }}
              subLabel={`Q=[${rlTrainer.qValues.map(q => q.toFixed(2)).join(',')}]`}
            />
          </Box>

          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 1 }}>
            <MetricCard
              label="Backtest WR" value={`${(rlTrainer.lastBacktestWinRate * 100).toFixed(1)}%`} color={C.winRate}
              data={h.winRate} sparkOpts={{ min: 0, max: 1 }}
              subLabel={`${rlTrainer.lastBacktestTrades} trades`}
            />
            <MetricCard
              label="Cum. PnL" value={rlTrainer.cumulativePnL.toFixed(4)} color={C.pnl}
              data={h.pnl} sparkOpts={{ zeroLine: true, fill: true }}
            />
            <MetricCard
              label="Sharpe" value={rlTrainer.lastBacktestSharpe.toFixed(2)} color={C.sharpe}
              data={h.sharpe} sparkOpts={{ zeroLine: true }}
            />
            <MetricCard
              label="Replay Buffer" value={`${rlTrainer.replayBufferSize}`} color={C.buffer}
              data={[{ tick: 0, value: rlTrainer.replayBufferSize }]}
              subLabel={`eff=${rlEfficiency.toFixed(4)}/step`}
            />
          </Box>

          {/* Action distribution */}
          <ActionBar
            probs={rlTrainer.qValues.map(q => Math.exp(q))}
            colors={ACTION_COLORS}
            labels={['S.SELL', 'SELL', 'HOLD', 'BUY', 'S.BUY']}
            title="DQN Q-Value Distribution"
          />
        </>
      )}

      {/* ─── A3C Protect Agent — Learning Curves ──────────────────────── */}
      {protectAgent && (
        <>
          <Typography sx={{ color: C.magenta, fontSize: '0.6rem', letterSpacing: '0.1em', fontWeight: 700, px: 0.5, mt: 1 }}>
            ▎ A3C PROTECT AGENT — BALANCE / HEDGE / GRID
          </Typography>
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 1 }}>
            <MetricCard
              label="Actor Loss" value={protectAgent.lastActorLoss.toFixed(6)} color={C.loss}
              data={h.actorLoss} sparkOpts={{ min: 0 }}
              subLabel={`steps=${protectAgent.totalTrainSteps}`}
            />
            <MetricCard
              label="Critic Loss" value={protectAgent.lastCriticLoss.toFixed(6)} color={C.amber}
              data={h.criticLoss} sparkOpts={{ min: 0 }}
            />
            <MetricCard
              label="Value Est." value={protectAgent.value.toFixed(4)} color={C.value}
              data={h.value} sparkOpts={{ zeroLine: true, fill: true }}
              subLabel={`σ=${protectStability.std.toFixed(3)}`}
            />
            <MetricCard
              label="Avg Reward" value={protectAgent.avgReward.toFixed(4)} color={C.reward}
              data={h.protectReward} sparkOpts={{ zeroLine: true, fill: true }}
              subLabel={`eff=${protectEfficiency.toFixed(4)}/step`}
            />
          </Box>

          {/* Grid/Martingale/Hedge state */}
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 1 }}>
            <MetricCard
              label="Hedge Ratio" value={`${(protectAgent.gridMartingale.hedgeRatio * 100).toFixed(0)}%`}
              color={C.blue} data={h.hedgeRatio} sparkOpts={{ min: 0, max: 1 }}
            />
            <MetricCard
              label="Grid Level" value={`${protectAgent.gridMartingale.gridOrders.length}/${protectAgent.gridMartingale.gridMaxLevels}`}
              color={C.cyan} data={h.gridLevel}
              sparkOpts={{ min: 0, max: protectAgent.gridMartingale.gridMaxLevels }}
            />
            <Box sx={{ bgcolor: C.panel, border: `1px solid ${C.border}`, borderRadius: '4px', p: 0.8 }}>
              <Typography sx={{ color: C.dim, fontSize: '0.55rem', letterSpacing: '0.08em', fontWeight: 600, textTransform: 'uppercase' }}>
                Martingale
              </Typography>
              <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.5, mt: 0.3 }}>
                <Typography sx={{
                  color: protectAgent.gridMartingale.martingaleCount > 0 ? C.amber : C.dim,
                  fontSize: '1rem', fontWeight: 800, fontFamily: 'monospace',
                }}>
                  {protectAgent.gridMartingale.martingaleCount}×
                </Typography>
                <Typography sx={{ color: C.dim, fontSize: '0.55rem', fontFamily: 'monospace' }}>
                  / {protectAgent.gridMartingale.martingaleMaxCount} max
                </Typography>
              </Box>
            </Box>
            <Box sx={{ bgcolor: C.panel, border: `1px solid ${C.border}`, borderRadius: '4px', p: 0.8 }}>
              <Typography sx={{ color: C.dim, fontSize: '0.55rem', letterSpacing: '0.08em', fontWeight: 600, textTransform: 'uppercase' }}>
                Profit Lock
              </Typography>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.2, mt: 0.3 }}>
                <Typography sx={{
                  color: protectAgent.gridMartingale.peakPnL > 0 ? C.green : C.dim,
                  fontSize: '0.7rem', fontWeight: 800, fontFamily: 'monospace',
                }}>
                  Peak: {protectAgent.gridMartingale.peakPnL.toFixed(2)}
                </Typography>
                <Typography sx={{
                  color: protectAgent.gridMartingale.lockedProfit > 0 ? C.green : C.dim,
                  fontSize: '0.6rem', fontFamily: 'monospace',
                }}>
                  Locked: {protectAgent.gridMartingale.lockedProfit.toFixed(2)}
                </Typography>
              </Box>
            </Box>
          </Box>

          {/* Policy distribution */}
          <ActionBar
            probs={protectAgent.policyProbs}
            colors={PROTECT_ACTION_COLORS}
            labels={PROTECT_ACTION_NAMES}
            title={`A3C Policy — Action: ${protectAgent.actionLabel} (${(protectAgent.confidence * 100).toFixed(0)}%)`}
          />
        </>
      )}

      {/* ─── Cross-Agent Stability & Efficiency Summary ───────────────── */}
      {(rlTrainer || protectAgent) && (
        <>
          <Typography sx={{ color: C.white, fontSize: '0.6rem', letterSpacing: '0.1em', fontWeight: 700, px: 0.5, mt: 1 }}>
            ▎ STABILITY & SAMPLE EFFICIENCY
          </Typography>
          <Box sx={{
            display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 1,
            bgcolor: C.panel, border: `1px solid ${C.border}`, borderRadius: '4px', p: 1,
          }}>
            {/* DQN metrics */}
            <Box>
              <Typography sx={{ color: C.dim, fontSize: '0.5rem', textTransform: 'uppercase', letterSpacing: '0.06em' }}>DQN Stability</Typography>
              <Typography sx={{
                color: rewardStability.stability > 0.5 ? C.green : rewardStability.stability > 0.2 ? C.amber : C.red,
                fontSize: '0.85rem', fontWeight: 800, fontFamily: 'monospace',
              }}>
                {(rewardStability.stability * 100).toFixed(0)}%
              </Typography>
            </Box>
            <Box>
              <Typography sx={{ color: C.dim, fontSize: '0.5rem', textTransform: 'uppercase', letterSpacing: '0.06em' }}>DQN Efficiency</Typography>
              <Typography sx={{ color: C.cyan, fontSize: '0.85rem', fontWeight: 800, fontFamily: 'monospace' }}>
                {rlEfficiency.toFixed(4)}
              </Typography>
            </Box>
            <Box>
              <Typography sx={{ color: C.dim, fontSize: '0.5rem', textTransform: 'uppercase', letterSpacing: '0.06em' }}>DQN Reward σ</Typography>
              <Typography sx={{ color: C.text, fontSize: '0.85rem', fontWeight: 800, fontFamily: 'monospace' }}>
                {rewardStability.std.toFixed(4)}
              </Typography>
            </Box>
            {/* A3C metrics */}
            <Box>
              <Typography sx={{ color: C.dim, fontSize: '0.5rem', textTransform: 'uppercase', letterSpacing: '0.06em' }}>A3C Stability</Typography>
              <Typography sx={{
                color: protectStability.stability > 0.5 ? C.green : protectStability.stability > 0.2 ? C.amber : C.red,
                fontSize: '0.85rem', fontWeight: 800, fontFamily: 'monospace',
              }}>
                {(protectStability.stability * 100).toFixed(0)}%
              </Typography>
            </Box>
            <Box>
              <Typography sx={{ color: C.dim, fontSize: '0.5rem', textTransform: 'uppercase', letterSpacing: '0.06em' }}>A3C Efficiency</Typography>
              <Typography sx={{ color: C.cyan, fontSize: '0.85rem', fontWeight: 800, fontFamily: 'monospace' }}>
                {protectEfficiency.toFixed(4)}
              </Typography>
            </Box>
            <Box>
              <Typography sx={{ color: C.dim, fontSize: '0.5rem', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Ep. Reward</Typography>
              <Typography sx={{
                color: (protectAgent?.episodeReward ?? 0) >= 0 ? C.green : C.red,
                fontSize: '0.85rem', fontWeight: 800, fontFamily: 'monospace',
              }}>
                {(protectAgent?.episodeReward ?? 0).toFixed(3)}
              </Typography>
            </Box>
          </Box>
        </>
      )}
    </Box>
  );
};

export default React.memo(RLBotAnalytics);
