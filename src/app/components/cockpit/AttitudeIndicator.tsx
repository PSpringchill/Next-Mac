import React from 'react';
import { Box, Typography } from '@mui/material';
import { ECAM, VolumeBin } from './ecamTheme';
import type { RadarVectorState } from '../TradingEngine/RadarVector';
import type { RegimeResult } from '../TradingEngine/DynamicThresholds';
import type { LinRegState } from '../TradingEngine/LinearRegressionTarget';
import type { CircuitBreakerState } from '../TradingEngine/RiskManager';

interface AttitudeIndicatorProps {
  volumeProfile: { bins: VolumeBin[]; totalBidVol: number; totalAskVol: number };
  volRoC: number;
  radarVector?: RadarVectorState | null;
  dynamicRegime?: RegimeResult | null;
  linReg?: LinRegState | null;
  currentPrice?: number;
  circuitBreaker?: CircuitBreakerState | null;
}

const REGIME_COLOR: Record<string, string> = {
  TRENDING: '#00ff88',
  VOLATILE: '#ff2222',
  RANGING: '#ffaa00',
  CALM: '#00ddff',
};

const AttitudeIndicator: React.FC<AttitudeIndicatorProps> = ({ volumeProfile, volRoC, radarVector, dynamicRegime, linReg, currentPrice, circuitBreaker }) => {
  const rv = radarVector;
  const rvEstablished = rv?.status === 'ESTABLISH';
  const rvStatusColor = rvEstablished ? ECAM.GREEN
    : rv?.status === 'SCANNING' ? ECAM.CYAN
    : rv?.status === 'SEARCHING' ? ECAM.AMBER : ECAM.DIM;
  const acx = 180, acy = 185, ar = 145;
  const tiltDeg = Math.max(-30, Math.min(30, volRoC * 0.6));
  const maxVol = Math.max(1, ...volumeProfile.bins.map(b => Math.max(b.bidVol, b.askVol)));

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1 }}>
      <Typography sx={{ color: ECAM.WHITE, fontSize: '0.7rem', letterSpacing: '0.12em', mb: 0.5, fontWeight: 700 }}>
        ATT — VOLUME PROFILE
      </Typography>
      <svg width="100%" height="100%" viewBox="0 0 415 420" style={{ maxWidth: 415 }}>
        <rect x="0" y="0" width="415" height="420" fill="rgba(5,5,10,0.9)" rx="4" />

        {/* Circuit Breaker — top right */}
        {(() => {
          const cb = circuitBreaker;
          const cbLvl = cb?.level ?? 0;
          const cbCol = cbLvl === 0 ? ECAM.GREEN : cbLvl === 1 ? ECAM.AMBER : ECAM.RED;
          const cbLabel = cbLvl === 0 ? 'CB NORM' : `CB L${cbLvl}`;
          return (
            <g>
              <rect x="341" y="4" width="72" height="20" rx="3"
                fill={cbLvl >= 2 ? 'rgba(255,0,0,0.12)' : cbLvl === 1 ? 'rgba(255,170,0,0.08)' : 'rgba(0,0,0,0.5)'}
                stroke={cbCol} strokeWidth={cbLvl >= 2 ? 1.5 : 1} />
              <text x="377" y="17" textAnchor="middle" fill={cbCol} fontSize="10" fontFamily="monospace" fontWeight="bold">
                {cbLabel}
              </text>
            </g>
          );
        })()}

        {/* Dynamic Regime badge — top center */}
        {dynamicRegime && (
          <g>
            <rect x="115" y="4" width="130" height="20" rx="4" fill="rgba(0,0,0,0.7)" stroke={REGIME_COLOR[dynamicRegime.regime] ?? ECAM.DIM} strokeWidth="1.2" />
            <text x="180" y="17" textAnchor="middle" fill={REGIME_COLOR[dynamicRegime.regime] ?? ECAM.DIM} fontSize="11" fontFamily="monospace" fontWeight="bold">
              {dynamicRegime.regime}
            </text>
            <text x="250" y="17" textAnchor="start" fill={ECAM.DIM} fontSize="9" fontFamily="monospace">
              {(dynamicRegime.strength * 100).toFixed(0)}%
            </text>
            {dynamicRegime.reversalRisk && (
              <text x="110" y="17" textAnchor="end" fill={ECAM.AMBER} fontSize="9" fontFamily="monospace" fontWeight="bold">REV</text>
            )}
          </g>
        )}

        {/* Attitude circle */}
        <defs>
          <clipPath id="attClip">
            <circle cx={acx} cy={acy} r={ar} />
          </clipPath>
        </defs>
        <circle cx={acx} cy={acy} r={ar} fill="none" stroke="rgba(255,255,255,0.14)" strokeWidth="2" />

        {/* Sky / Ground split */}
        <g clipPath="url(#attClip)" style={{ transition: 'transform 0.8s ease-out' }}>
          <rect x="-20" y={-100} width="400" height={285 + 100} fill="rgba(0,80,180,0.25)"
            transform={`rotate(${tiltDeg}, ${acx}, ${acy})`} style={{ transition: 'transform 0.8s ease-out' }} />
          <rect x="-20" y={acy} width="400" height="300" fill="rgba(140,80,20,0.25)"
            transform={`rotate(${tiltDeg}, ${acx}, ${acy})`} style={{ transition: 'transform 0.8s ease-out' }} />
          <line x1="-20" y1={acy} x2="400" y2={acy} stroke={ECAM.GREEN} strokeWidth="2"
            transform={`rotate(${tiltDeg}, ${acx}, ${acy})`} style={{ transition: 'transform 0.8s ease-out' }} />
        </g>

        {/* Volume profile bars */}
        {volumeProfile.bins.map((bin, i) => {
          const y = 55 + i * 26;
          const bidW = Math.max(1, (bin.bidVol / maxVol) * 90);
          const askW = Math.max(1, (bin.askVol / maxVol) * 90);
          return (
            <React.Fragment key={`vol-${i}`}>
              <rect x={acx - bidW} y={y} width={bidW} height={14} fill={ECAM.GREEN} opacity="0.4" rx="2" style={{ transition: 'x 0.8s ease-out, width 0.8s ease-out, opacity 0.8s' }} />
              <rect x={acx} y={y} width={askW} height={14} fill={ECAM.RED} opacity="0.4" rx="2" style={{ transition: 'width 0.8s ease-out, opacity 0.8s' }} />
              <line x1={acx - 95} y1={y + 15} x2={acx + 95} y2={y + 15} stroke="rgba(255,255,255,0.04)" strokeWidth="1" />
            </React.Fragment>
          );
        })}

        {/* Aircraft symbol */}
        <g>
          <line x1={acx - 50} y1={acy} x2={acx - 20} y2={acy} stroke={ECAM.AMBER} strokeWidth="3" />
          <line x1={acx + 20} y1={acy} x2={acx + 50} y2={acy} stroke={ECAM.AMBER} strokeWidth="3" />
          <rect x={acx - 7} y={acy - 7} width="14" height="14" fill="none" stroke={ECAM.AMBER} strokeWidth="3" />
        </g>

        {/* Pitch ladder */}
        {[-20, -10, 10, 20].map(deg => {
          const yOff = -(deg / 30) * 120;
          const y = acy + yOff;
          if (y <= 50 || y >= 320) return null;
          return (
            <g key={`pitch-${deg}`} transform={`rotate(${tiltDeg}, ${acx}, ${acy})`}>
              <line x1={acx - 38} y1={y} x2={acx - 18} y2={y} stroke="rgba(255,255,255,0.35)" strokeWidth="1" />
              <line x1={acx + 18} y1={y} x2={acx + 38} y2={y} stroke="rgba(255,255,255,0.35)" strokeWidth="1" />
              <text x={acx - 48} y={y + 4} textAnchor="end" fill="rgba(255,255,255,0.3)" fontSize="10" fontFamily="monospace">{Math.abs(deg)}</text>
            </g>
          );
        })}

        {/* Bank angle arc */}
        <g>
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

        {/* Volume RoC gauge */}
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

        {/* Radar Vector: OBI & DD overlay (top-left) */}
        {rv && (
          <g>
            {/* Status badge */}
            <rect x="8" y="8" width={rv.status.length * 7.5 + 12} height="16" rx="3"
              fill={rvEstablished ? 'rgba(0,255,136,0.15)' : 'rgba(255,255,255,0.04)'}
              stroke={rvStatusColor} strokeWidth="0.8" />
            <text x="14" y="19" fill={rvStatusColor} fontSize="9" fontFamily="monospace" fontWeight="bold">
              {rv.status}
            </text>

            {/* OBI & DD values */}
            {rv.searchCount > 0 && (
              <>
                <text x="12" y="38" fill={ECAM.DIM} fontSize="7" fontFamily="monospace">OBI</text>
                <text x="12" y="49" fill={rvEstablished ? ECAM.CYAN : ECAM.DIM} fontSize="11" fontFamily="monospace" fontWeight="bold">
                  {rv.entryObi.toFixed(1)}%
                </text>
                <text x="12" y="62" fill={ECAM.DIM} fontSize="7" fontFamily="monospace">DD</text>
                <text x="12" y="73" fill={rv.drawdownPct > 5 ? ECAM.AMBER : rvEstablished ? ECAM.GREEN : ECAM.DIM} fontSize="11" fontFamily="monospace" fontWeight="bold">
                  {rv.drawdownPct.toFixed(2)}%
                </text>
                {/* Dominant trade side */}
                <text x="12" y="90" fill={ECAM.DIM} fontSize="7" fontFamily="monospace">SIDE</text>
                <text x="12" y="101" fill={
                  rv.dominantSide === 'BUY' ? ECAM.GREEN
                  : rv.dominantSide === 'SELL' ? ECAM.RED
                  : ECAM.AMBER
                } fontSize="11" fontFamily="monospace" fontWeight="bold">
                  {rv.dominantSide}
                </text>
              </>
            )}
          </g>
        )}

        {/* Transition status — bottom left */}
        {dynamicRegime && dynamicRegime.transitionPriceUp > 0 && (
          <g>
            <rect x="4" y="340" width="160" height="36" rx="3" fill="rgba(0,0,0,0.7)" stroke={dynamicRegime.reversalRisk ? ECAM.AMBER : 'rgba(255,255,255,0.15)'} strokeWidth="1" />
            <text x="10" y="356" fill={dynamicRegime.reversalRisk ? ECAM.AMBER : ECAM.DIM} fontSize="10" fontFamily="monospace" fontWeight="bold">TRANSITION</text>
            <text x="10" y="372" fill={ECAM.GREEN} fontSize="11" fontFamily="monospace" fontWeight="bold">▲{dynamicRegime.transitionPriceUp.toFixed(4)}</text>
            <text x="88" y="372" fill={ECAM.RED} fontSize="11" fontFamily="monospace" fontWeight="bold">▼{dynamicRegime.transitionPriceDown.toFixed(4)}</text>
          </g>
        )}

        {/* ═══ ILS OVERLAY — Precision Approach ═══ */}
        {/* Localizer (horizontal) inside bottom of circle, GS (vertical) inside right of circle */}
        {(() => {
          const lr = linReg;
          const hasILS = lr && lr.rSquared > 0;
          const dotSp = 16;
          const dotR = 2.5;
          const dSz = 5;

          // Localizer: inside bottom of circle (y = acy + ar - 20)
          const locY = acy + ar - 20;
          const locDev = hasILS && lr.stdError > 0 && currentPrice
            ? Math.max(-2, Math.min(2, (currentPrice - lr.priceTarget) / (lr.stdError * 2)))
            : 0;

          // Glide slope: inside right of circle (x = acx + ar - 20)
          const gsX = acx + ar - 20;
          const gsDev = hasILS
            ? Math.max(-2, Math.min(2, (lr.acceleration / (Math.abs(lr.slope) + 1e-8)) * 50))
            : 0;

          const rSq = lr?.rSquared ?? 0;
          const beamCol = rSq > 0.85 ? ECAM.GREEN : rSq > 0.5 ? ECAM.CYAN : rSq > 0.2 ? ECAM.AMBER : ECAM.RED;
          const stable = lr?.glideSlopeStable ?? true;
          const dhLabel = rSq > 0.85 ? 'III' : rSq > 0.7 ? 'II' : rSq > 0.5 ? 'I' : '—';
          const dhCol = rSq > 0.85 ? ECAM.GREEN : rSq > 0.7 ? ECAM.CYAN : rSq > 0.5 ? ECAM.AMBER : ECAM.RED;
          const sDir = (lr?.slope ?? 0) > 0 ? 'LONG' : (lr?.slope ?? 0) < 0 ? 'SHORT' : 'HOLD';
          const sDirCol = sDir === 'LONG' ? ECAM.GREEN : sDir === 'SHORT' ? ECAM.RED : ECAM.DIM;

          return (
            <g opacity={hasILS ? 1 : 0.3}>
              {/* ─── LOCALIZER (horizontal, inside bottom of circle) ─── */}
              <line x1={acx - 2 * dotSp - 4} y1={locY} x2={acx + 2 * dotSp + 4} y2={locY}
                stroke={ECAM.MAGENTA} strokeWidth="1.5" opacity="0.5" />
              {[-2, -1, 0, 1, 2].map(d => (
                <circle key={`loc-${d}`} cx={acx + d * dotSp} cy={locY} r={dotR}
                  fill="none" stroke={d === 0 ? ECAM.WHITE : 'rgba(255,255,255,0.3)'} strokeWidth={d === 0 ? 1.2 : 0.8} />
              ))}
              <polygon
                points={`${acx + locDev * dotSp},${locY - dSz} ${acx + locDev * dotSp + dSz},${locY} ${acx + locDev * dotSp},${locY + dSz} ${acx + locDev * dotSp - dSz},${locY}`}
                fill={ECAM.MAGENTA} opacity="0.9"
                style={{ transition: 'all 0.5s ease-out' }} />

              {/* ─── GLIDE SLOPE (vertical, inside right of circle) ─── */}
              <line x1={gsX} y1={acy - 2 * dotSp - 4} x2={gsX} y2={acy + 2 * dotSp + 4}
                stroke={ECAM.MAGENTA} strokeWidth="1.5" opacity="0.5" />
              {[-2, -1, 0, 1, 2].map(d => (
                <circle key={`gs-${d}`} cx={gsX} cy={acy + d * dotSp} r={dotR}
                  fill="none" stroke={d === 0 ? ECAM.WHITE : 'rgba(255,255,255,0.3)'} strokeWidth={d === 0 ? 1.2 : 0.8} />
              ))}
              <polygon
                points={`${gsX},${acy - gsDev * dotSp - dSz} ${gsX + dSz},${acy - gsDev * dotSp} ${gsX},${acy - gsDev * dotSp + dSz} ${gsX - dSz},${acy - gsDev * dotSp}`}
                fill={ECAM.MAGENTA} opacity="0.9"
                style={{ transition: 'all 0.5s ease-out' }} />

              {/* ─── BOTTOM-LEFT: LONG/SHORT + STABLE/UNSTABLE (above TRANSITION) ─── */}
              <rect x="4" y="322" width="52" height="18" rx="3" fill="rgba(0,0,0,0.7)" stroke={sDirCol} strokeWidth="1.2" />
              <text x="30" y="335" textAnchor="middle" fill={sDirCol} fontSize="11" fontFamily="monospace" fontWeight="bold">{sDir}</text>

              <rect x="60" y="322" width="44" height="18" rx="3"
                fill={stable ? 'rgba(0,255,136,0.06)' : 'rgba(255,170,0,0.12)'}
                stroke={stable ? ECAM.GREEN : ECAM.AMBER} strokeWidth="1" />
              <text x="82" y="335" textAnchor="middle" fill={stable ? ECAM.GREEN : ECAM.AMBER} fontSize="11" fontFamily="monospace" fontWeight="bold">
                {stable ? 'G/S✓' : 'G/S!'}
              </text>

              {/* ─── BOTTOM-RIGHT: CAT badge (below VOL RoC gauge) ─── */}
              <rect x="350" y="340" width="44" height="16" rx="3" fill="rgba(0,0,0,0.7)" stroke={dhCol} strokeWidth="1" />
              <text x="372" y="352" textAnchor="middle" fill={dhCol} fontSize="10" fontFamily="monospace" fontWeight="bold">C{dhLabel}</text>

              {/* ─── ILS READOUTS (bottom-left, below TRANSITION) ─── */}
              <text x="6" y="392" fill={ECAM.DIM} fontSize="9" fontFamily="monospace">SLOPE</text>
              <text x="50" y="392" fill={lr?.slope && lr.slope > 0 ? ECAM.GREEN : lr?.slope && lr.slope < 0 ? ECAM.RED : ECAM.DIM} fontSize="11" fontFamily="monospace" fontWeight="bold">
                {lr?.slope ? (lr.slope > 0 ? '+' : '') + lr.slope.toFixed(3) : '—'}
              </text>
              <text x="6" y="406" fill={ECAM.DIM} fontSize="9" fontFamily="monospace">ACCEL</text>
              <text x="50" y="406" fill={lr?.acceleration && lr.acceleration > 0 ? ECAM.GREEN : lr?.acceleration && lr.acceleration < 0 ? ECAM.RED : ECAM.DIM} fontSize="11" fontFamily="monospace" fontWeight="bold">
                {lr?.acceleration ? (lr.acceleration > 0 ? '+' : '') + lr.acceleration.toFixed(4) : '—'}
              </text>
              <text x="120" y="392" fill={ECAM.DIM} fontSize="9" fontFamily="monospace">R²</text>
              <text x="138" y="392" fill={beamCol} fontSize="11" fontFamily="monospace" fontWeight="bold">
                {rSq.toFixed(3)}
              </text>
            </g>
          );
        })()}

        {/* Volume summary */}
        <text x="240" y="415" textAnchor="middle" fill={ECAM.DIM} fontSize="10" fontFamily="monospace">
          BID {volumeProfile.totalBidVol.toFixed(1)} | ASK {volumeProfile.totalAskVol.toFixed(1)}
        </text>
      </svg>
    </Box>
  );
};

export default React.memo(AttitudeIndicator);
