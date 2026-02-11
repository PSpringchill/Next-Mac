import React from 'react';
import { Box, Typography } from '@mui/material';
import { ECAM, VolumeBin } from './ecamTheme';
import type { RadarVectorState } from '../TradingEngine/RadarVector';
import type { RegimeResult } from '../TradingEngine/DynamicThresholds';

interface AttitudeIndicatorProps {
  volumeProfile: { bins: VolumeBin[]; totalBidVol: number; totalAskVol: number };
  volRoC: number;
  radarVector?: RadarVectorState | null;
  dynamicRegime?: RegimeResult | null;
}

const REGIME_COLOR: Record<string, string> = {
  TRENDING: '#00ff88',
  VOLATILE: '#ff2222',
  RANGING: '#ffaa00',
  CALM: '#00ddff',
};

const AttitudeIndicator: React.FC<AttitudeIndicatorProps> = ({ volumeProfile, volRoC, radarVector, dynamicRegime }) => {
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
      <svg width="100%" height="100%" viewBox="0 0 420 405" style={{ maxWidth: 420 }}>
        <rect x="0" y="0" width="420" height="405" fill="rgba(5,5,10,0.9)" rx="4" />

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
            <rect x="4" y="340" width="148" height="34" rx="3" fill="rgba(0,0,0,0.7)" stroke={dynamicRegime.reversalRisk ? ECAM.AMBER : 'rgba(255,255,255,0.15)'} strokeWidth="1" />
            <text x="10" y="354" fill={dynamicRegime.reversalRisk ? ECAM.AMBER : ECAM.DIM} fontSize="8" fontFamily="monospace" fontWeight="bold">TRANSITION</text>
            <text x="10" y="368" fill={ECAM.GREEN} fontSize="9" fontFamily="monospace">▲{dynamicRegime.transitionPriceUp.toFixed(4)}</text>
            <text x="82" y="368" fill={ECAM.RED} fontSize="9" fontFamily="monospace">▼{dynamicRegime.transitionPriceDown.toFixed(4)}</text>
          </g>
        )}

        {/* Volume summary */}
        <text x="180" y="390" textAnchor="middle" fill={ECAM.DIM} fontSize="10" fontFamily="monospace">
          BID {volumeProfile.totalBidVol.toFixed(1)} | ASK {volumeProfile.totalAskVol.toFixed(1)}
        </text>
      </svg>
    </Box>
  );
};

export default React.memo(AttitudeIndicator);
