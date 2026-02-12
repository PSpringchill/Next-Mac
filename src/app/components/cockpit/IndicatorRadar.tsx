import React, { useMemo } from 'react';
import { Box, Typography } from '@mui/material';
import { ECAM } from './ecamTheme';
import type { IndicatorProfilerState } from '../TradingEngine/IndicatorProfiler';

// ─── Short labels for radar axes ────────────────────────────────────────────

const SHORT_LABELS: Record<string, string> = {
  rsi_norm: 'RSI',
  macd_hist_norm: 'MACD',
  macd_aligned: 'MACDa',
  ema9_21_cross: 'EMA9/21',
  ema21_50_cross: 'EMA21/50',
  ema50_200_cross: 'EMA50/200',
  ema9_slope: 'EMA9s',
  bb_percentB: 'BB%B',
  bb_squeeze: 'BBsqz',
  bb_bandwidth: 'BBbw',
  stoch_k_norm: 'StK',
  stoch_d_norm: 'StD',
  stoch_cross: 'StX',
  adx_norm: 'ADX',
  adx_di_diff: 'DI±',
  atr_percentile: 'ATR%',
  vwap_dev: 'VWAP',
  obi: 'OBI',
  price_chg_1: 'Δ1',
  price_chg_5: 'Δ5',
  price_chg_20: 'Δ20',
  price_chg_50: 'Δ50',
  price_chg_100: 'Δ100',
  linreg_slope: 'LRs',
  linreg_r2: 'R²',
  linreg_dev: 'LRd',
  volume_roc: 'VolΔ',
  spread_norm: 'Sprd',
};

interface IndicatorRadarProps {
  profilerState: IndicatorProfilerState | null;
}

const IndicatorRadar: React.FC<IndicatorRadarProps> = ({ profilerState }) => {
  const ps = profilerState;

  // Select top 12 most discriminative indicators for the radar
  const radarProfiles = useMemo(() => {
    if (!ps?.profiles?.length) return [];
    return [...ps.profiles]
      .sort((a, b) => b.discriminativePower - a.discriminativePower)
      .slice(0, 12);
  }, [ps]);

  const n = radarProfiles.length;
  const cx = 170, cy = 170, maxR = 120;
  const angleStep = n > 0 ? (2 * Math.PI) / n : 0;

  const matchScore = ps?.matchScore ?? 0;
  const weightedMatch = ps?.weightedMatchScore ?? 0;
  const totalSamples = ps?.totalSamples ?? 0;
  const calibration = ps?.calibrationSource ?? 'none';

  // Overall status
  const statusColor = weightedMatch > 0.6 ? ECAM.GREEN
    : weightedMatch > 0.35 ? ECAM.CYAN
    : weightedMatch > 0.15 ? ECAM.AMBER : ECAM.RED;
  const statusLabel = weightedMatch > 0.6 ? 'ALIGNED'
    : weightedMatch > 0.35 ? 'PARTIAL'
    : weightedMatch > 0.15 ? 'DIVERGING' : 'MISALIGNED';

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%' }}>
      <Typography sx={{ color: ECAM.WHITE, fontSize: '0.7rem', letterSpacing: '0.12em', mb: 0.5, fontWeight: 700 }}>
        RADAR VECTOR — INDICATOR CONFIG
      </Typography>

      <svg width="100%" height="100%" viewBox="0 0 340 420" style={{ maxWidth: 340 }}>
        <rect x="0" y="0" width="340" height="420" fill="rgba(5,5,10,0.9)" rx="4" />

        {/* Status annunciator */}
        <rect x="4" y="4" width="72" height="18" rx="3" fill="rgba(0,0,0,0.7)" stroke={statusColor} strokeWidth="1" />
        <text x="40" y="16" textAnchor="middle" fill={statusColor} fontSize="9" fontFamily="monospace" fontWeight="bold">
          {statusLabel}
        </text>

        {/* Calibration source badge */}
        <rect x="264" y="4" width="72" height="18" rx="3" fill="rgba(0,0,0,0.7)" stroke={ECAM.DIM} strokeWidth="1" />
        <text x="300" y="16" textAnchor="middle" fill={calibration !== 'none' ? ECAM.CYAN : ECAM.DIM} fontSize="8" fontFamily="monospace" fontWeight="bold">
          {calibration.toUpperCase()}
        </text>

        {/* Match score */}
        <text x="170" y="16" textAnchor="middle" fill={ECAM.WHITE} fontSize="9" fontFamily="monospace" fontWeight="bold">
          MATCH {(weightedMatch * 100).toFixed(0)}%
        </text>

        {n === 0 ? (
          <text x={cx} y={cy} textAnchor="middle" fill={ECAM.DIM} fontSize="12" fontFamily="monospace">
            {calibration === 'none' ? 'CALIBRATING...' : 'NO DATA'}
          </text>
        ) : (
          <>
            {/* Concentric rings */}
            {[0.25, 0.5, 0.75, 1].map((ring, ri) => {
              const r = maxR * ring;
              const pts = Array.from({ length: n }, (_, i) => {
                const angle = -Math.PI / 2 + i * angleStep;
                return `${cx + r * Math.cos(angle)},${cy + r * Math.sin(angle)}`;
              }).join(' ');
              return (
                <React.Fragment key={`ring-${ri}`}>
                  <polygon points={pts} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="0.7" />
                  <text x={cx + 4} y={cy - r + 4} fill="rgba(255,255,255,0.15)" fontSize="6" fontFamily="monospace">
                    {(ring * 100).toFixed(0)}%
                  </text>
                </React.Fragment>
              );
            })}

            {/* Axis lines + labels */}
            {radarProfiles.map((p, i) => {
              const angle = -Math.PI / 2 + i * angleStep;
              const x2 = cx + maxR * Math.cos(angle);
              const y2 = cy + maxR * Math.sin(angle);
              const lx = cx + (maxR + 22) * Math.cos(angle);
              const ly = cy + (maxR + 22) * Math.sin(angle);
              const label = SHORT_LABELS[p.featureName] ?? p.featureName.slice(0, 5);
              return (
                <React.Fragment key={`axis-${i}`}>
                  <line x1={cx} y1={cy} x2={x2} y2={y2} stroke="rgba(255,255,255,0.06)" strokeWidth="0.7" />
                  <text x={lx} y={ly + 3} textAnchor="middle" fill={p.isInOptimal ? ECAM.GREEN : ECAM.DIM} fontSize="8" fontFamily="monospace" fontWeight="bold">
                    {label}
                  </text>
                </React.Fragment>
              );
            })}

            {/* Optimal zone polygon (filled green) */}
            <polygon
              points={radarProfiles.map((p, i) => {
                const angle = -Math.PI / 2 + i * angleStep;
                const r = maxR * Math.min(1, Math.max(0.1, p.optimalProfitProb));
                return `${cx + r * Math.cos(angle)},${cy + r * Math.sin(angle)}`;
              }).join(' ')}
              fill="rgba(0,255,136,0.08)" stroke={ECAM.GREEN} strokeWidth="1.5" strokeDasharray="4,3"
              style={{ transition: 'all 1s ease-out' }}
            />

            {/* Current value polygon (filled cyan) */}
            <polygon
              points={radarProfiles.map((p, i) => {
                const angle = -Math.PI / 2 + i * angleStep;
                // Normalize current alignment to [0.05, 1] range for display
                const r = maxR * Math.min(1, Math.max(0.05, p.alignment));
                return `${cx + r * Math.cos(angle)},${cy + r * Math.sin(angle)}`;
              }).join(' ')}
              fill="rgba(0,221,255,0.12)" stroke={ECAM.CYAN} strokeWidth="2"
              style={{ transition: 'all 0.8s ease-out' }}
            />

            {/* Data points — optimal (green diamonds) + current (cyan dots) */}
            {radarProfiles.map((p, i) => {
              const angle = -Math.PI / 2 + i * angleStep;

              // Optimal point
              const optR = maxR * Math.min(1, Math.max(0.1, p.optimalProfitProb));
              const optX = cx + optR * Math.cos(angle);
              const optY = cy + optR * Math.sin(angle);

              // Current point
              const curR = maxR * Math.min(1, Math.max(0.05, p.alignment));
              const curX = cx + curR * Math.cos(angle);
              const curY = cy + curR * Math.sin(angle);

              const dotColor = p.isInOptimal ? ECAM.GREEN
                : p.alignment > 0.5 ? ECAM.CYAN
                : p.alignment > 0.2 ? ECAM.AMBER : ECAM.RED;

              return (
                <React.Fragment key={`dot-${i}`}>
                  {/* Optimal diamond */}
                  <polygon
                    points={`${optX},${optY - 4} ${optX + 4},${optY} ${optX},${optY + 4} ${optX - 4},${optY}`}
                    fill="none" stroke={ECAM.GREEN} strokeWidth="1.2"
                    style={{ transition: 'all 1s ease-out' }}
                  />
                  {/* Current dot */}
                  <circle cx={curX} cy={curY} r="3.5" fill={dotColor}
                    style={{ transition: 'cx 0.8s ease-out, cy 0.8s ease-out, fill 0.6s' }}
                  />
                  {/* Profit prob label */}
                  <text
                    x={cx + (optR + 14) * Math.cos(angle)}
                    y={cy + (optR + 14) * Math.sin(angle) + 3}
                    textAnchor="middle" fill={dotColor} fontSize="7" fontFamily="monospace" fontWeight="bold"
                    style={{ transition: 'x 0.8s, y 0.8s, fill 0.6s' }}
                  >
                    {(p.optimalProfitProb * 100).toFixed(0)}
                  </text>
                </React.Fragment>
              );
            })}

            {/* Center crosshair */}
            <line x1={cx - 6} y1={cy} x2={cx + 6} y2={cy} stroke={ECAM.DIM} strokeWidth="0.8" />
            <line x1={cx} y1={cy - 6} x2={cx} y2={cy + 6} stroke={ECAM.DIM} strokeWidth="0.8" />
          </>
        )}

        {/* Legend */}
        <rect x="10" y="300" width="320" height="115" rx="3" fill="rgba(0,0,0,0.5)" stroke={ECAM.BORDER} strokeWidth="0.5" />

        <text x="20" y="314" fill={ECAM.WHITE} fontSize="8" fontFamily="monospace" fontWeight="bold">
          TOP PROFITABLE INDICATOR CONFIGS
        </text>

        {/* Top indicators list */}
        {(ps?.topIndicators ?? []).slice(0, 6).map((ind, i) => {
          const y = 328 + i * 14;
          const barWidth = Math.max(2, Math.min(80, ind.profitProb * 100));
          const probColor = ind.profitProb > 0.6 ? ECAM.GREEN
            : ind.profitProb > 0.5 ? ECAM.CYAN : ECAM.AMBER;
          return (
            <React.Fragment key={`top-${i}`}>
              <text x="20" y={y} fill={ECAM.WHITE} fontSize="8" fontFamily="monospace">
                {(SHORT_LABELS[ind.name] ?? ind.name.slice(0, 8)).padEnd(10)}
              </text>
              <rect x="100" y={y - 8} width={barWidth} height="8" rx="1" fill={probColor} opacity="0.7" />
              <text x="190" y={y} fill={probColor} fontSize="8" fontFamily="monospace" fontWeight="bold">
                {(ind.profitProb * 100).toFixed(1)}%
              </text>
              <text x="235" y={y} fill={ECAM.DIM} fontSize="7" fontFamily="monospace">
                pwr={ind.power.toFixed(3)}
              </text>
            </React.Fragment>
          );
        })}

        {/* Footer stats */}
        <text x="170" y="410" textAnchor="middle" fill={ECAM.DIM} fontSize="8" fontFamily="monospace">
          {totalSamples} samples · match={((matchScore) * 100).toFixed(0)}% · weighted={((weightedMatch) * 100).toFixed(0)}%
        </text>
      </svg>
    </Box>
  );
};

export default React.memo(IndicatorRadar);
