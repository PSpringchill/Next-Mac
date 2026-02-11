import React from 'react';
import { Box, Typography } from '@mui/material';
import { ECAM } from './ecamTheme';
import type { LinRegState } from '../TradingEngine/LinearRegressionTarget';
import type { RadarVectorState } from '../TradingEngine/RadarVector';

interface ILSIndicatorProps {
  linReg?: LinRegState | null;
  currentPrice?: number;
  radarVector?: RadarVectorState | null;
}

// ─── Real ILS-inspired Instrument Landing System indicator ───
// Localizer (horizontal): price deviation from regression beam
// Glide Slope (vertical): slope acceleration health
// Decision Height: R² quality threshold
// Beam quality: R² → beam width

const ILSIndicator: React.FC<ILSIndicatorProps> = ({ linReg, currentPrice, radarVector }) => {
  const lr = linReg;
  const rv = radarVector;
  // ILS establishes ONLY when RadarVector confirms Buy or Sell
  const rvEstablished = rv?.status === 'ESTABLISH';
  const rvHasDirection = rvEstablished && rv?.dominantSide !== 'NEUTRAL';
  const hasData = lr && lr.rSquared > 0 && rvHasDirection;

  // ─── Localizer: price deviation from regression line ───
  // Deviation = (currentPrice - priceTarget) / stdError, clamped to ±2 dots
  const deviation = hasData && lr.stdError > 0 && currentPrice
    ? Math.max(-2, Math.min(2, (currentPrice - lr.priceTarget) / (lr.stdError * 2)))
    : 0;

  // ─── Glide Slope: acceleration health ───
  // Positive accel with positive slope = climbing (good for long)
  // Negative accel with negative slope = descending (good for short)
  // Opposing = unstable
  const accelNorm = hasData
    ? Math.max(-2, Math.min(2, (lr.acceleration / (Math.abs(lr.slope) + 1e-8)) * 50))
    : 0;

  // ─── Beam quality from R² ───
  const rSq = lr?.rSquared ?? 0;
  const beamColor = rSq > 0.85 ? ECAM.GREEN : rSq > 0.5 ? ECAM.CYAN : rSq > 0.2 ? ECAM.AMBER : ECAM.RED;
  const stable = lr?.glideSlopeStable ?? true;

  // ─── Decision Height annunciator ───
  const dhStatus = rSq > 0.85 ? 'CAT III' : rSq > 0.7 ? 'CAT II' : rSq > 0.5 ? 'CAT I' : 'NO APP';
  const dhColor = rSq > 0.85 ? ECAM.GREEN : rSq > 0.7 ? ECAM.CYAN : rSq > 0.5 ? ECAM.AMBER : ECAM.RED;

  // ─── Approach mode ───
  // Direction from RadarVector dominant side when established, fallback to slope
  const slopeDir = rvHasDirection ? (rv!.dominantSide === 'BUY' ? 'LONG' : 'SHORT')
    : (lr?.slope ?? 0) > 0 ? 'LONG' : (lr?.slope ?? 0) < 0 ? 'SHORT' : 'HOLD';
  const slopeDirColor = slopeDir === 'LONG' ? ECAM.GREEN : slopeDir === 'SHORT' ? ECAM.RED : ECAM.DIM;

  const cx = 120, cy = 120; // Center of the ILS cross
  const dotSpacing = 22; // Pixels between dots
  const dotR = 3.5;
  const diamondSize = 7;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <Typography sx={{ color: ECAM.WHITE, fontSize: '0.7rem', letterSpacing: '0.12em', mb: 0.5, fontWeight: 700 }}>
        ILS — PRECISION APPROACH
      </Typography>
      <svg width="100%" height="100%" viewBox="0 0 240 260" style={{ maxWidth: 240 }}>
        <rect x="0" y="0" width="240" height="260" fill="rgba(5,5,10,0.9)" rx="4" />

        {/* ═══ APPROACH MODE ANNUNCIATOR ═══ */}
        <rect x="4" y="4" width="56" height="18" rx="3" fill="rgba(0,0,0,0.7)" stroke={dhColor} strokeWidth="1" />
        <text x="32" y="16" textAnchor="middle" fill={dhColor} fontSize="9" fontFamily="monospace" fontWeight="bold">
          {dhStatus}
        </text>

        {/* Direction badge */}
        <rect x="180" y="4" width="56" height="18" rx="3" fill="rgba(0,0,0,0.7)" stroke={slopeDirColor} strokeWidth="1" />
        <text x="208" y="16" textAnchor="middle" fill={slopeDirColor} fontSize="9" fontFamily="monospace" fontWeight="bold">
          {slopeDir}
        </text>

        {/* Stability badge — center top */}
        <rect x="80" y="4" width="80" height="18" rx="3"
          fill={stable ? 'rgba(0,255,136,0.06)' : 'rgba(255,170,0,0.15)'}
          stroke={stable ? ECAM.GREEN : ECAM.AMBER} strokeWidth="1" />
        <text x="120" y="16" textAnchor="middle"
          fill={stable ? ECAM.GREEN : ECAM.AMBER}
          fontSize="9" fontFamily="monospace" fontWeight="bold">
          {stable ? 'G/S STABLE' : 'G/S UNSTABLE'}
        </text>

        {/* ═══ LOCALIZER SCALE (horizontal — bottom of cross) ═══ */}
        {/* Center reference line (vertical) */}
        <line x1={cx} y1={cy - 55} x2={cx} y2={cy + 55} stroke="rgba(255,255,255,0.12)" strokeWidth="1" />
        {/* Center reference line (horizontal) */}
        <line x1={cx - 55} y1={cy} x2={cx + 55} y2={cy} stroke="rgba(255,255,255,0.12)" strokeWidth="1" />

        {/* ═══ LOCALIZER DOTS (horizontal row) ═══ */}
        {[-2, -1, 1, 2].map(d => (
          <circle key={`loc-${d}`}
            cx={cx + d * dotSpacing} cy={cy}
            r={dotR}
            fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth="1"
          />
        ))}
        {/* Center diamond outline (localizer reference) */}
        <polygon
          points={`${cx},${cy - 5} ${cx + 5},${cy} ${cx},${cy + 5} ${cx - 5},${cy}`}
          fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="1"
        />

        {/* ═══ GLIDE SLOPE DOTS (vertical column) ═══ */}
        {[-2, -1, 1, 2].map(d => (
          <circle key={`gs-${d}`}
            cx={cx} cy={cy + d * dotSpacing}
            r={dotR}
            fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth="1"
          />
        ))}

        {/* ═══ BEAM QUALITY ARCS ═══ */}
        {/* Outer arc — shows R² as arc fill */}
        <circle cx={cx} cy={cy} r={62} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="2" />
        <circle cx={cx} cy={cy} r={62} fill="none"
          stroke={beamColor} strokeWidth="2"
          strokeDasharray={`${rSq * 390} ${390 - rSq * 390}`}
          strokeDashoffset="97.5"
          opacity="0.5"
          style={{ transition: 'stroke-dasharray 0.8s ease-out' }}
        />

        {/* ═══ LOCALIZER DIAMOND (moves horizontally) ═══ */}
        {/* The diamond shows price deviation from regression beam */}
        <polygon
          points={`
            ${cx + deviation * dotSpacing},${cy - diamondSize}
            ${cx + deviation * dotSpacing + diamondSize},${cy}
            ${cx + deviation * dotSpacing},${cy + diamondSize}
            ${cx + deviation * dotSpacing - diamondSize},${cy}
          `}
          fill={Math.abs(deviation) < 0.5 ? ECAM.GREEN : Math.abs(deviation) < 1 ? ECAM.CYAN : ECAM.AMBER}
          stroke={Math.abs(deviation) < 0.5 ? ECAM.GREEN : Math.abs(deviation) < 1 ? ECAM.CYAN : ECAM.AMBER}
          strokeWidth="1.5"
          opacity="0.9"
          style={{ transition: 'all 0.5s ease-out' }}
        />

        {/* ═══ GLIDE SLOPE DIAMOND (moves vertically) ═══ */}
        {/* The diamond shows acceleration health */}
        <polygon
          points={`
            ${cx},${cy - accelNorm * dotSpacing - diamondSize}
            ${cx + diamondSize},${cy - accelNorm * dotSpacing}
            ${cx},${cy - accelNorm * dotSpacing + diamondSize}
            ${cx - diamondSize},${cy - accelNorm * dotSpacing}
          `}
          fill={stable ? ECAM.MAGENTA : ECAM.AMBER}
          stroke={stable ? ECAM.MAGENTA : ECAM.AMBER}
          strokeWidth="1.5"
          opacity="0.9"
          style={{ transition: 'all 0.5s ease-out' }}
        />

        {/* ═══ SCALE LABELS ═══ */}
        <text x={cx - 2 * dotSpacing} y={cy + 16} textAnchor="middle" fill={ECAM.DIM} fontSize="7" fontFamily="monospace">L</text>
        <text x={cx + 2 * dotSpacing} y={cy + 16} textAnchor="middle" fill={ECAM.DIM} fontSize="7" fontFamily="monospace">R</text>
        <text x={cx + 16} y={cy - 2 * dotSpacing + 3} textAnchor="start" fill={ECAM.DIM} fontSize="7" fontFamily="monospace">UP</text>
        <text x={cx + 16} y={cy + 2 * dotSpacing + 3} textAnchor="start" fill={ECAM.DIM} fontSize="7" fontFamily="monospace">DN</text>

        {/* ═══ RUNWAY THRESHOLD VISUALIZATION ═══ */}
        {/* Perspective runway lines at bottom */}
        <line x1={cx - 40} y1={230} x2={cx - 10} y2={195} stroke="rgba(255,255,255,0.15)" strokeWidth="1.5" />
        <line x1={cx + 40} y1={230} x2={cx + 10} y2={195} stroke="rgba(255,255,255,0.15)" strokeWidth="1.5" />
        {/* Threshold dashes */}
        {[-3, -2, -1, 0, 1, 2, 3].map(i => (
          <line key={`rwy-${i}`}
            x1={cx + i * 5} y1={228}
            x2={cx + i * 4} y2={220}
            stroke="rgba(255,255,255,0.2)" strokeWidth="1.5"
          />
        ))}
        {/* Centerline */}
        <line x1={cx} y1={230} x2={cx} y2={195} stroke="rgba(255,255,255,0.1)" strokeWidth="1" strokeDasharray="3,3" />

        {/* ═══ NUMERIC READOUTS ═══ */}
        {/* Slope */}
        <rect x="4" y="232" width="72" height="24" rx="3" fill="rgba(0,0,0,0.7)" stroke={ECAM.BORDER} strokeWidth="0.5" />
        <text x="8" y="243" fill={ECAM.DIM} fontSize="7" fontFamily="monospace">SLOPE</text>
        <text x="72" y="251" textAnchor="end" fill={lr?.slope && lr.slope > 0 ? ECAM.GREEN : lr?.slope && lr.slope < 0 ? ECAM.RED : ECAM.DIM} fontSize="10" fontFamily="monospace" fontWeight="bold">
          {lr?.slope ? (lr.slope > 0 ? '+' : '') + lr.slope.toFixed(4) : '—'}
        </text>

        {/* Acceleration */}
        <rect x="84" y="232" width="72" height="24" rx="3" fill="rgba(0,0,0,0.7)" stroke={ECAM.BORDER} strokeWidth="0.5" />
        <text x="88" y="243" fill={ECAM.DIM} fontSize="7" fontFamily="monospace">ACCEL</text>
        <text x="152" y="251" textAnchor="end" fill={lr?.acceleration && lr.acceleration > 0 ? ECAM.GREEN : lr?.acceleration && lr.acceleration < 0 ? ECAM.RED : ECAM.DIM} fontSize="10" fontFamily="monospace" fontWeight="bold">
          {lr?.acceleration ? (lr.acceleration > 0 ? '+' : '') + lr.acceleration.toFixed(5) : '—'}
        </text>

        {/* R² */}
        <rect x="164" y="232" width="72" height="24" rx="3" fill="rgba(0,0,0,0.7)" stroke={beamColor} strokeWidth="0.8" />
        <text x="168" y="243" fill={ECAM.DIM} fontSize="7" fontFamily="monospace">R²</text>
        <text x="232" y="251" textAnchor="end" fill={beamColor} fontSize="10" fontFamily="monospace" fontWeight="bold">
          {rSq.toFixed(3)}
        </text>
      </svg>
    </Box>
  );
};

export default React.memo(ILSIndicator);
