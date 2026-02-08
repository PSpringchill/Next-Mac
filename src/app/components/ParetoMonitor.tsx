'use client';

import React, { useMemo } from 'react';
import { Box, Typography } from '@mui/material';
import { useTradingStore } from '@stores/tradingStore';
import { AlphaRiskState } from './TradingEngine/ParetoAnalyzer';

// ─── ECAM Color Constants (match CockpitPanel) ───
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

// ─── Alpha state → color mapping ───
const alphaColor = (state: AlphaRiskState | undefined): string => {
  switch (state) {
    case AlphaRiskState.LOCKOUT: return ECAM.RED;
    case AlphaRiskState.CRITICAL: return ECAM.RED;
    case AlphaRiskState.HIGH: return ECAM.AMBER;
    case AlphaRiskState.ELEVATED: return ECAM.CYAN;
    case AlphaRiskState.SAFE: return ECAM.GREEN;
    default: return ECAM.DIM;
  }
};

const regimeColor = (regime: string | undefined): string => {
  switch (regime) {
    case 'VOLATILE': return ECAM.RED;
    case 'TRENDING': return ECAM.GREEN;
    case 'CALM': return ECAM.CYAN;
    case 'RANGING': return ECAM.AMBER;
    default: return ECAM.DIM;
  }
};

// ─── COMPONENT ───
const ParetoMonitor: React.FC = () => {
  const paretoState = useTradingStore((s) => s.paretoState);
  const dynamicRegime = useTradingStore((s) => s.dynamicRegime);
  const paretoHistory = useTradingStore((s) => s.paretoHistory);
  const signalFilter = useTradingStore((s) => s.signalFilter);
  const radarVector = useTradingStore((s) => s.radarVector);

  // ─── Alpha sparkline path ───
  const sparklinePath = useMemo(() => {
    if (!paretoHistory || paretoHistory.length < 2) return '';
    const w = 280, h = 60;
    const alphas = paretoHistory.map((p) => p.alpha);
    const minA = Math.min(...alphas, 1.0);
    const maxA = Math.max(...alphas, 5.0);
    const range = maxA - minA || 1;

    return alphas.map((a, i) => {
      const x = (i / (alphas.length - 1)) * w;
      const y = h - ((a - minA) / range) * h;
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');
  }, [paretoHistory]);

  // ─── Tail risk sparkline ───
  const tailSparkline = useMemo(() => {
    if (!paretoHistory || paretoHistory.length < 2) return '';
    const w = 280, h = 30;
    const risks = paretoHistory.map((p) => p.tailRisk);

    return risks.map((r, i) => {
      const x = (i / (risks.length - 1)) * w;
      const y = h - r * h;
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');
  }, [paretoHistory]);

  const alpha = paretoState?.params?.alpha ?? null;
  const aState = paretoState?.alphaState;
  const tailRisk = paretoState?.params?.tailRisk ?? 0;
  const fitness = paretoState?.params?.fitness ?? 0;
  const sampleSize = paretoState?.params?.sampleSize ?? 0;
  const isReliable = paretoState?.params?.isReliable ?? false;
  const posMultiplier = paretoState?.positionSizeMultiplier ?? 1;
  const var95 = paretoState?.var95 ?? 0;
  const var99 = paretoState?.var99 ?? 0;
  const es95 = paretoState?.es95 ?? 0;
  const regime = dynamicRegime?.regime;
  const regimeStrength = dynamicRegime?.strength ?? 0;
  const reversalRisk = dynamicRegime?.reversalRisk ?? false;
  const isCalibrated = dynamicRegime?.thresholds?.isCalibrated ?? false;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>

      {/* ═══ PARETO TAIL RISK ANALYZER ═══ */}
      <Box sx={{ bgcolor: ECAM.PANEL, p: 1.5, border: `1px solid ${ECAM.BORDER}` }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
          <Typography sx={{ color: ECAM.WHITE, fontSize: '0.65rem', letterSpacing: '0.15em', fontWeight: 700 }}>
            PARETO — TAIL RISK ANALYZER
          </Typography>
          <Typography sx={{
            color: isReliable ? ECAM.GREEN : ECAM.AMBER,
            fontSize: '0.6rem', fontWeight: 600,
          }}>
            {isReliable ? 'RELIABLE' : 'CALIBRATING'} ({sampleSize} pts)
          </Typography>
        </Box>

        {/* Alpha value + state badge */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 1.5 }}>
          <Box sx={{ textAlign: 'center' }}>
            <Typography sx={{ color: ECAM.DIM, fontSize: '0.6rem', mb: 0.3 }}>ALPHA (α)</Typography>
            <Typography sx={{
              color: alphaColor(aState),
              fontSize: '1.8rem',
              fontWeight: 800,
              fontFamily: '"JetBrains Mono", monospace',
              lineHeight: 1,
            }}>
              {alpha !== null ? alpha.toFixed(3) : '—'}
            </Typography>
          </Box>

          <Box sx={{
            px: 1.2, py: 0.5,
            borderRadius: 1,
            bgcolor: aState === AlphaRiskState.LOCKOUT
              ? 'rgba(255,34,34,0.2)'
              : aState === AlphaRiskState.CRITICAL
                ? 'rgba(255,34,34,0.12)'
                : 'rgba(255,255,255,0.04)',
            border: `1px solid ${alphaColor(aState)}`,
            animation: aState === AlphaRiskState.LOCKOUT ? 'pulse 1s infinite' : 'none',
          }}>
            <Typography sx={{
              color: alphaColor(aState),
              fontSize: '0.75rem',
              fontWeight: 800,
              letterSpacing: '0.1em',
            }}>
              {aState ?? 'INIT'}
            </Typography>
          </Box>

          <Box sx={{ flex: 1, textAlign: 'right' }}>
            <Typography sx={{ color: ECAM.DIM, fontSize: '0.6rem' }}>POS SIZE</Typography>
            <Typography sx={{
              color: posMultiplier >= 0.8 ? ECAM.GREEN
                : posMultiplier >= 0.5 ? ECAM.AMBER
                  : posMultiplier > 0 ? ECAM.RED : ECAM.RED,
              fontSize: '1rem',
              fontWeight: 700,
            }}>
              {(posMultiplier * 100).toFixed(0)}%
            </Typography>
          </Box>
        </Box>

        {/* Alpha gauge bar */}
        <Box sx={{ mb: 1 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.3 }}>
            <Typography sx={{ color: ECAM.DIM, fontSize: '0.6rem' }}>1.0</Typography>
            <Typography sx={{ color: ECAM.DIM, fontSize: '0.6rem' }}>ALPHA SCALE</Typography>
            <Typography sx={{ color: ECAM.DIM, fontSize: '0.6rem' }}>10.0</Typography>
          </Box>
          <Box sx={{
            height: 12, width: '100%',
            bgcolor: 'rgba(255,255,255,0.06)',
            borderRadius: 1,
            position: 'relative',
            overflow: 'hidden',
          }}>
            {/* Danger zones */}
            <Box sx={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: '11%', bgcolor: 'rgba(255,34,34,0.25)' }} />
            <Box sx={{ position: 'absolute', left: '11%', top: 0, bottom: 0, width: '4%', bgcolor: 'rgba(255,34,34,0.15)' }} />
            <Box sx={{ position: 'absolute', left: '15%', top: 0, bottom: 0, width: '5%', bgcolor: 'rgba(255,170,0,0.12)' }} />
            {/* Indicator needle */}
            {alpha !== null && (
              <Box sx={{
                position: 'absolute',
                top: 0, bottom: 0,
                left: `${Math.min(100, Math.max(0, ((alpha - 1) / 9) * 100))}%`,
                width: 3,
                bgcolor: alphaColor(aState),
                borderRadius: 1,
                transition: 'left 0.8s ease-out',
                boxShadow: `0 0 6px ${alphaColor(aState)}`,
              }} />
            )}
            {/* Threshold markers */}
            <Box sx={{ position: 'absolute', left: '1.1%', top: -2, bottom: -2, width: 1, bgcolor: ECAM.RED, opacity: 0.6 }} />
            <Box sx={{ position: 'absolute', left: '5.5%', top: -2, bottom: -2, width: 1, bgcolor: ECAM.AMBER, opacity: 0.4 }} />
            <Box sx={{ position: 'absolute', left: '11%', top: -2, bottom: -2, width: 1, bgcolor: ECAM.AMBER, opacity: 0.4 }} />
            <Box sx={{ position: 'absolute', left: '33%', top: -2, bottom: -2, width: 1, bgcolor: ECAM.CYAN, opacity: 0.3 }} />
          </Box>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 0.2 }}>
            <Typography sx={{ color: ECAM.RED, fontSize: '0.5rem' }}>LOCKOUT</Typography>
            <Typography sx={{ color: ECAM.RED, fontSize: '0.5rem' }}>CRIT</Typography>
            <Typography sx={{ color: ECAM.AMBER, fontSize: '0.5rem' }}>HIGH</Typography>
            <Typography sx={{ color: ECAM.CYAN, fontSize: '0.5rem' }}>ELEVATED</Typography>
            <Typography sx={{ color: ECAM.GREEN, fontSize: '0.5rem' }}>SAFE</Typography>
          </Box>
        </Box>

        {/* Key metrics row */}
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 1, mb: 1 }}>
          {[
            { label: 'TAIL RISK', value: (tailRisk * 100).toFixed(0) + '%', color: tailRisk > 0.7 ? ECAM.RED : tailRisk > 0.4 ? ECAM.AMBER : ECAM.GREEN },
            { label: 'FITNESS', value: (fitness * 100).toFixed(0) + '%', color: fitness > 0.6 ? ECAM.GREEN : ECAM.AMBER },
            { label: 'VaR 95', value: (var95 * 100).toFixed(2) + '%', color: ECAM.CYAN },
            { label: 'ES 95', value: (es95 * 100).toFixed(2) + '%', color: ECAM.CYAN },
          ].map(({ label, value, color }) => (
            <Box key={label} sx={{ textAlign: 'center' }}>
              <Typography sx={{ color: ECAM.DIM, fontSize: '0.55rem', mb: 0.2 }}>{label}</Typography>
              <Typography sx={{ color, fontSize: '0.78rem', fontWeight: 700 }}>{value}</Typography>
            </Box>
          ))}
        </Box>

        {/* Alpha History Sparkline */}
        {paretoHistory && paretoHistory.length >= 2 && (
          <Box sx={{ mt: 0.5 }}>
            <Typography sx={{ color: ECAM.DIM, fontSize: '0.55rem', mb: 0.3, letterSpacing: '0.1em' }}>
              ALPHA HISTORY ({paretoHistory.length} pts)
            </Typography>
            <svg width="100%" viewBox="0 0 300 80" style={{ maxHeight: 70 }}>
              <rect x="0" y="0" width="300" height="80" fill="rgba(5,5,10,0.6)" rx="3" />
              {/* Threshold lines */}
              {[
                { y: 80 - ((1.1 - 1) / 9) * 80, color: ECAM.RED, label: '1.1' },
                { y: 80 - ((2.0 - 1) / 9) * 80, color: ECAM.AMBER, label: '2.0' },
                { y: 80 - ((4.0 - 1) / 9) * 80, color: ECAM.CYAN, label: '4.0' },
              ].map(({ y: ty, color, label }) => (
                <g key={label}>
                  <line x1="10" y1={ty} x2="290" y2={ty} stroke={color} strokeWidth="0.5" strokeDasharray="3,3" opacity="0.4" />
                  <text x="295" y={ty + 3} fill={color} fontSize="7" fontFamily="monospace" opacity="0.6">{label}</text>
                </g>
              ))}
              {/* Sparkline */}
              <path
                d={(() => {
                  const w = 280, h = 70, ox = 10, oy = 5;
                  const alphas = paretoHistory.map((p) => p.alpha);
                  const minA = Math.min(...alphas, 1.0);
                  const maxA = Math.max(...alphas, 5.0);
                  const range = maxA - minA || 1;
                  return alphas.map((a, i) => {
                    const x = ox + (i / (alphas.length - 1)) * w;
                    const y = oy + h - ((a - minA) / range) * h;
                    return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
                  }).join(' ');
                })()}
                fill="none"
                stroke={alphaColor(aState)}
                strokeWidth="1.5"
                style={{ transition: 'all 0.5s ease-out' }}
              />
              {/* Current value dot */}
              {alpha !== null && paretoHistory.length > 0 && (() => {
                const w = 280, h = 70, ox = 10, oy = 5;
                const alphas = paretoHistory.map((p) => p.alpha);
                const minA = Math.min(...alphas, 1.0);
                const maxA = Math.max(...alphas, 5.0);
                const range = maxA - minA || 1;
                const lastA = alphas[alphas.length - 1];
                const cx = ox + w;
                const cy = oy + h - ((lastA - minA) / range) * h;
                return <circle cx={cx} cy={cy} r="3" fill={alphaColor(aState)} />;
              })()}
            </svg>
          </Box>
        )}

        {/* Lockout warning */}
        {aState === AlphaRiskState.LOCKOUT && (
          <Box sx={{
            mt: 1, p: 1,
            bgcolor: 'rgba(255,34,34,0.15)',
            border: `1px solid ${ECAM.RED}`,
            borderRadius: 1,
          }}>
            <Typography sx={{ color: ECAM.RED, fontSize: '0.75rem', fontWeight: 800, textAlign: 'center' }}>
              ALPHA LOCKOUT — ALL NEW TRADES BLOCKED
            </Typography>
            <Typography sx={{ color: ECAM.RED, fontSize: '0.65rem', textAlign: 'center', mt: 0.3 }}>
              Infinite mean regime detected (α ≤ 1.1)
            </Typography>
          </Box>
        )}
      </Box>

      {/* ═══ DYNAMIC REGIME DETECTION ═══ */}
      <Box sx={{ bgcolor: ECAM.PANEL, p: 1.5, border: `1px solid ${ECAM.BORDER}` }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
          <Typography sx={{ color: ECAM.WHITE, fontSize: '0.65rem', letterSpacing: '0.15em', fontWeight: 700 }}>
            DYNAMIC REGIME
          </Typography>
          <Typography sx={{
            color: isCalibrated ? ECAM.GREEN : ECAM.AMBER,
            fontSize: '0.6rem',
          }}>
            {isCalibrated ? 'CALIBRATED' : 'WARMING UP'}
          </Typography>
        </Box>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 1 }}>
          <Box sx={{
            px: 1.5, py: 0.6,
            borderRadius: 1,
            bgcolor: 'rgba(255,255,255,0.04)',
            border: `1px solid ${regimeColor(regime)}`,
          }}>
            <Typography sx={{
              color: regimeColor(regime),
              fontSize: '1rem',
              fontWeight: 800,
              letterSpacing: '0.1em',
            }}>
              {regime ?? 'INIT'}
            </Typography>
          </Box>

          <Box sx={{ flex: 1 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.3 }}>
              <Typography sx={{ color: ECAM.DIM, fontSize: '0.6rem' }}>STRENGTH</Typography>
              <Typography sx={{ color: ECAM.WHITE, fontSize: '0.7rem', fontWeight: 600 }}>
                {(regimeStrength * 100).toFixed(0)}%
              </Typography>
            </Box>
            <Box sx={{
              height: 6, width: '100%',
              bgcolor: 'rgba(255,255,255,0.06)',
              borderRadius: 1,
              overflow: 'hidden',
            }}>
              <Box sx={{
                height: '100%',
                width: `${regimeStrength * 100}%`,
                bgcolor: regimeColor(regime),
                borderRadius: 1,
                transition: 'width 0.8s ease-out',
              }} />
            </Box>
          </Box>

          {reversalRisk && (
            <Box sx={{
              px: 1, py: 0.4,
              borderRadius: 1,
              bgcolor: 'rgba(255,170,0,0.15)',
              border: `1px solid ${ECAM.AMBER}`,
            }}>
              <Typography sx={{ color: ECAM.AMBER, fontSize: '0.65rem', fontWeight: 700 }}>
                REVERSAL
              </Typography>
            </Box>
          )}
        </Box>

        {/* Dynamic thresholds display */}
        {dynamicRegime?.thresholds && (
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 0.5 }}>
            {[
              { label: 'VOL HIGH', value: dynamicRegime.thresholds.volatilityHigh.toFixed(3) },
              { label: 'VOL LOW', value: dynamicRegime.thresholds.volatilityLow.toFixed(3) },
              { label: 'MOM HIGH', value: (dynamicRegime.thresholds.momentumHigh * 100).toFixed(2) + '%' },
              { label: 'VOL RATIO', value: dynamicRegime.volatilityRatio.toFixed(3) },
            ].map(({ label, value }) => (
              <Box key={label} sx={{ textAlign: 'center' }}>
                <Typography sx={{ color: ECAM.DIM, fontSize: '0.5rem' }}>{label}</Typography>
                <Typography sx={{ color: ECAM.WHITE, fontSize: '0.68rem', fontWeight: 600 }}>{value}</Typography>
              </Box>
            ))}
          </Box>
        )}
      </Box>

      {/* ═══ MCML: SIGNAL FILTER (Gradient Surprise + HMM) ═══ */}
      {signalFilter && (
        <Box sx={{ bgcolor: ECAM.PANEL, p: 1.5, border: `1px solid ${ECAM.BORDER}` }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
            <Typography sx={{ color: ECAM.WHITE, fontSize: '0.65rem', letterSpacing: '0.15em', fontWeight: 700 }}>
              MCML — SIGNAL FILTER
            </Typography>
            <Typography sx={{
              color: signalFilter.blocked ? ECAM.RED : signalFilter.gradientSurprise.isUnstable ? ECAM.AMBER : ECAM.GREEN,
              fontSize: '0.6rem', fontWeight: 600,
            }}>
              {signalFilter.blocked ? 'BLOCKED' : signalFilter.gradientSurprise.isUnstable ? 'UNSTABLE' : 'PASSING'}
            </Typography>
          </Box>

          {/* Confidence before/after filter */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 1.5 }}>
            <Box sx={{ textAlign: 'center' }}>
              <Typography sx={{ color: ECAM.DIM, fontSize: '0.55rem' }}>ORIGINAL</Typography>
              <Typography sx={{ color: ECAM.WHITE, fontSize: '1rem', fontWeight: 700 }}>
                {(signalFilter.originalConfidence * 100).toFixed(0)}%
              </Typography>
            </Box>
            <Typography sx={{ color: ECAM.DIM, fontSize: '1.2rem' }}>→</Typography>
            <Box sx={{ textAlign: 'center' }}>
              <Typography sx={{ color: ECAM.DIM, fontSize: '0.55rem' }}>FILTERED</Typography>
              <Typography sx={{
                color: signalFilter.filteredConfidence > 0.7 ? ECAM.GREEN
                  : signalFilter.filteredConfidence > 0.4 ? ECAM.AMBER : ECAM.RED,
                fontSize: '1rem', fontWeight: 700,
              }}>
                {(signalFilter.filteredConfidence * 100).toFixed(0)}%
              </Typography>
            </Box>
            <Box sx={{ flex: 1, textAlign: 'right' }}>
              <Typography sx={{ color: ECAM.DIM, fontSize: '0.55rem' }}>HMM ADJ</Typography>
              <Typography sx={{
                color: signalFilter.hmmConfidenceAdj >= 1.0 ? ECAM.GREEN
                  : signalFilter.hmmConfidenceAdj >= 0.7 ? ECAM.CYAN
                    : signalFilter.hmmConfidenceAdj >= 0.4 ? ECAM.AMBER : ECAM.RED,
                fontSize: '1rem', fontWeight: 700,
              }}>
                ×{signalFilter.hmmConfidenceAdj.toFixed(2)}
              </Typography>
            </Box>
          </Box>

          {/* Gradient Surprise gauge */}
          <Box sx={{ mb: 1 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.3 }}>
              <Typography sx={{ color: ECAM.DIM, fontSize: '0.6rem' }}>GRADIENT SURPRISE</Typography>
              <Typography sx={{
                color: signalFilter.gradientSurprise.gradientNorm > 0.85 ? ECAM.RED
                  : signalFilter.gradientSurprise.gradientNorm > 0.6 ? ECAM.AMBER : ECAM.GREEN,
                fontSize: '0.7rem', fontWeight: 600,
              }}>
                {(signalFilter.gradientSurprise.gradientNorm * 100).toFixed(0)}%
              </Typography>
            </Box>
            <Box sx={{
              height: 8, width: '100%',
              bgcolor: 'rgba(255,255,255,0.06)',
              borderRadius: 1, overflow: 'hidden',
            }}>
              <Box sx={{
                height: '100%',
                width: `${Math.min(100, signalFilter.gradientSurprise.gradientNorm * 100)}%`,
                bgcolor: signalFilter.gradientSurprise.gradientNorm > 0.85 ? ECAM.RED
                  : signalFilter.gradientSurprise.gradientNorm > 0.6 ? ECAM.AMBER : ECAM.GREEN,
                borderRadius: 1,
                transition: 'width 0.5s ease-out, background-color 0.3s',
              }} />
            </Box>
          </Box>

          {/* Surprise breakdown metrics */}
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 1, mb: 1 }}>
            {[
              { label: 'FLIP RATE', value: (signalFilter.gradientSurprise.directionFlipRate * 100).toFixed(0) + '%',
                color: signalFilter.gradientSurprise.directionFlipRate > 0.6 ? ECAM.RED : ECAM.GREEN },
              { label: 'CONF σ', value: (signalFilter.gradientSurprise.confidenceVolatility * 100).toFixed(0) + '%',
                color: signalFilter.gradientSurprise.confidenceVolatility > 0.6 ? ECAM.AMBER : ECAM.GREEN },
              { label: 'LOSS ΔR', value: (signalFilter.gradientSurprise.lossRateOfChange * 100).toFixed(0) + '%',
                color: signalFilter.gradientSurprise.lossRateOfChange > 0.5 ? ECAM.AMBER : ECAM.GREEN },
            ].map(({ label, value, color }) => (
              <Box key={label} sx={{ textAlign: 'center' }}>
                <Typography sx={{ color: ECAM.DIM, fontSize: '0.5rem', mb: 0.2 }}>{label}</Typography>
                <Typography sx={{ color, fontSize: '0.72rem', fontWeight: 700 }}>{value}</Typography>
              </Box>
            ))}
          </Box>

          {/* HMM Regime */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 0.5 }}>
            <Typography sx={{ color: ECAM.DIM, fontSize: '0.6rem' }}>HMM REGIME</Typography>
            <Box sx={{
              px: 1, py: 0.3, borderRadius: 0.5,
              bgcolor: 'rgba(255,255,255,0.04)',
              border: `1px solid ${
                signalFilter.hmmRegime === 'trending_up' ? ECAM.GREEN
                : signalFilter.hmmRegime === 'trending_down' ? ECAM.RED
                : signalFilter.hmmRegime === 'volatile' ? ECAM.RED
                : signalFilter.hmmRegime === 'breakout' ? ECAM.CYAN
                : ECAM.AMBER
              }`,
            }}>
              <Typography sx={{
                color: signalFilter.hmmRegime === 'trending_up' ? ECAM.GREEN
                  : signalFilter.hmmRegime === 'trending_down' ? ECAM.RED
                  : signalFilter.hmmRegime === 'volatile' ? ECAM.RED
                  : signalFilter.hmmRegime === 'breakout' ? ECAM.CYAN
                  : ECAM.AMBER,
                fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase',
              }}>
                {signalFilter.hmmRegime}
              </Typography>
            </Box>
            {signalFilter.hmmIsTransition && (
              <Typography sx={{ color: ECAM.MAGENTA, fontSize: '0.6rem', fontWeight: 700 }}>
                TRANSITION
              </Typography>
            )}
            <Box sx={{ flex: 1, textAlign: 'right' }}>
              <Typography sx={{ color: ECAM.DIM, fontSize: '0.55rem' }}>MOM</Typography>
              <Typography sx={{
                color: signalFilter.hmmMomentum > 0 ? ECAM.GREEN : signalFilter.hmmMomentum < 0 ? ECAM.RED : ECAM.DIM,
                fontSize: '0.7rem', fontWeight: 600,
              }}>
                {signalFilter.hmmMomentum > 0 ? '+' : ''}{signalFilter.hmmMomentum.toFixed(3)}
              </Typography>
            </Box>
          </Box>

          {/* Filter reason */}
          {signalFilter.filterReason && (
            <Box sx={{
              mt: 0.5, px: 1, py: 0.5,
              bgcolor: signalFilter.blocked ? 'rgba(255,34,34,0.1)' : 'rgba(255,255,255,0.03)',
              borderRadius: 0.5,
            }}>
              <Typography sx={{
                color: signalFilter.blocked ? ECAM.RED : ECAM.DIM,
                fontSize: '0.6rem', fontStyle: 'italic',
              }}>
                {signalFilter.filterReason}
              </Typography>
            </Box>
          )}
        </Box>
      )}

      {/* ═══ RADAR VECTOR — Background Grid Search ═══ */}
      {radarVector && (
        <Box sx={{ bgcolor: ECAM.PANEL, p: 1.2, border: `1px solid ${ECAM.BORDER}` }}>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.8 }}>
            <Typography sx={{ color: ECAM.WHITE, fontSize: '0.6rem', letterSpacing: '0.12em', fontWeight: 700 }}>
              RADAR VECTOR
            </Typography>
            <Typography sx={{
              color: radarVector.status === 'ESTABLISH' ? ECAM.GREEN
                : radarVector.status === 'SCANNING' ? ECAM.CYAN
                : radarVector.status === 'SEARCHING' ? ECAM.AMBER
                : ECAM.DIM,
              fontSize: '0.65rem', fontWeight: 700, letterSpacing: '0.08em',
              px: 0.8, py: 0.2,
              border: `1px solid ${radarVector.status === 'ESTABLISH' ? ECAM.GREEN : 'rgba(255,255,255,0.1)'}`,
              borderRadius: 0.5,
              bgcolor: radarVector.status === 'ESTABLISH' ? 'rgba(0,255,136,0.1)' : 'transparent',
            }}>
              {radarVector.status}
            </Typography>
          </Box>

          {/* Progress bar for SCANNING */}
          {radarVector.status === 'SCANNING' && (
            <Box sx={{ mb: 1 }}>
              <Box sx={{ height: 3, bgcolor: 'rgba(255,255,255,0.05)', borderRadius: 1, overflow: 'hidden' }}>
                <Box sx={{
                  height: '100%', bgcolor: ECAM.CYAN, borderRadius: 1,
                  width: `${Math.min(100, (radarVector.dataPoints / 100) * 100)}%`,
                  transition: 'width 0.3s',
                }} />
              </Box>
              <Typography sx={{ color: ECAM.DIM, fontSize: '0.5rem', mt: 0.3 }}>
                Collecting data: {radarVector.dataPoints}/100 ticks
              </Typography>
            </Box>
          )}

          {/* Parameters grid — shown when ESTABLISH or NO VECTOR */}
          {radarVector.searchCount > 0 && (
            <>
              <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 0.8, mb: 0.8 }}>
                {[
                  { label: 'TP', value: radarVector.tpPct.toFixed(3) + '%', color: radarVector.status === 'ESTABLISH' ? ECAM.GREEN : ECAM.DIM },
                  { label: 'SL', value: radarVector.slPct.toFixed(3) + '%', color: radarVector.status === 'ESTABLISH' ? ECAM.RED : ECAM.DIM },
                  { label: 'ENTRY OBI', value: radarVector.entryObi.toFixed(1) + '%', color: radarVector.status === 'ESTABLISH' ? ECAM.CYAN : ECAM.DIM },
                  { label: 'MAX DD', value: radarVector.drawdownPct.toFixed(2) + '%', color: radarVector.drawdownPct > 5 ? ECAM.AMBER : radarVector.status === 'ESTABLISH' ? ECAM.GREEN : ECAM.DIM },
                ].map(({ label, value, color }) => (
                  <Box key={label} sx={{ textAlign: 'center' }}>
                    <Typography sx={{ color: ECAM.DIM, fontSize: '0.5rem', mb: 0.2 }}>{label}</Typography>
                    <Typography sx={{ color, fontSize: '0.72rem', fontWeight: 700 }}>{value}</Typography>
                  </Box>
                ))}
              </Box>

              {/* Metrics row */}
              <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 0.8 }}>
                {[
                  { label: 'SHARPE', value: radarVector.sharpe.toFixed(2), color: radarVector.sharpe >= 1.0 ? ECAM.GREEN : radarVector.sharpe >= 0.5 ? ECAM.AMBER : ECAM.RED },
                  { label: 'WIN RATE', value: (radarVector.winRate * 100).toFixed(1) + '%', color: radarVector.winRate >= 0.5 ? ECAM.GREEN : radarVector.winRate >= 0.4 ? ECAM.AMBER : ECAM.RED },
                  { label: 'RETURN', value: (radarVector.totalReturn * 100).toFixed(2) + '%', color: radarVector.totalReturn > 0 ? ECAM.GREEN : ECAM.RED },
                ].map(({ label, value, color }) => (
                  <Box key={label} sx={{ textAlign: 'center' }}>
                    <Typography sx={{ color: ECAM.DIM, fontSize: '0.5rem', mb: 0.2 }}>{label}</Typography>
                    <Typography sx={{ color, fontSize: '0.68rem', fontWeight: 600 }}>{value}</Typography>
                  </Box>
                ))}
              </Box>

              {/* Search metadata */}
              <Box sx={{ mt: 0.8, display: 'flex', justifyContent: 'space-between' }}>
                <Typography sx={{ color: ECAM.DIM, fontSize: '0.48rem' }}>
                  Searches: {radarVector.searchCount} | Combos: {radarVector.totalCombinations} | Valid: {radarVector.validatedCount}/{radarVector.validatedCount + radarVector.rejectedCount}
                </Typography>
                <Typography sx={{ color: ECAM.DIM, fontSize: '0.48rem' }}>
                  {radarVector.lastSearchMs.toFixed(0)}ms | {radarVector.dataPoints} pts
                </Typography>
              </Box>
            </>
          )}
        </Box>
      )}

      {/* ═══ POT (Peaks Over Threshold) ═══ */}
      {paretoState?.pot && paretoState.pot.exceedances > 0 && (
        <Box sx={{ bgcolor: ECAM.PANEL, p: 1.2, border: `1px solid ${ECAM.BORDER}` }}>
          <Typography sx={{ color: ECAM.WHITE, fontSize: '0.6rem', letterSpacing: '0.12em', mb: 0.8, fontWeight: 700 }}>
            POT — EXTREME EVENTS
          </Typography>
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 1 }}>
            {[
              { label: 'THRESHOLD', value: (paretoState.pot.threshold * 100).toFixed(3) + '%', color: ECAM.CYAN },
              { label: 'EXCEEDANCES', value: `${paretoState.pot.exceedances}`, color: paretoState.pot.exceedances > 50 ? ECAM.AMBER : ECAM.GREEN },
              { label: 'GPD ξ', value: paretoState.pot.estimatedXi.toFixed(4), color: paretoState.pot.estimatedXi > 0.5 ? ECAM.AMBER : ECAM.GREEN },
            ].map(({ label, value, color }) => (
              <Box key={label} sx={{ textAlign: 'center' }}>
                <Typography sx={{ color: ECAM.DIM, fontSize: '0.55rem', mb: 0.2 }}>{label}</Typography>
                <Typography sx={{ color, fontSize: '0.72rem', fontWeight: 700 }}>{value}</Typography>
              </Box>
            ))}
          </Box>
        </Box>
      )}
    </Box>
  );
};

export default React.memo(ParetoMonitor);
