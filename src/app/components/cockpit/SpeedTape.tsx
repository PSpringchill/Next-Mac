import React, { useState } from 'react';
import { Box, Typography, IconButton } from '@mui/material';
import { ECAM, SmoothedTechData } from './ecamTheme';
import type { RadarVectorState } from '../TradingEngine/RadarVector';
import type { RegimeResult } from '../TradingEngine/DynamicThresholds';

interface SpeedTapeProps {
  smoothedTech: SmoothedTechData;
  wallRangePct: number;
  priceRoC: number;
  radarVector?: RadarVectorState | null;
  dynamicRegime?: RegimeResult | null;
  onScaleUp?: () => void;
  onScaleDown?: () => void;
}

const SpeedTape: React.FC<SpeedTapeProps> = ({ smoothedTech, wallRangePct, priceRoC, radarVector, dynamicRegime, onScaleUp, onScaleDown }) => {
  const [hiDec, setHiDec] = useState(false);
  const fmt = (p: number) => hiDec ? p.toFixed(4) : p.toFixed(2);
  const rv = radarVector;
  const rvEstablished = rv?.status === 'ESTABLISH';
  const mid = smoothedTech.midPrice;
  const rangePct = wallRangePct / 100;
  const tapeRange = mid * rangePct;
  const tapeTop = mid + tapeRange;
  const tapeBot = mid - tapeRange;
  const tapeH = 320;
  const tapeY0 = 30;
  const steps = 12;

  const priceToY = (p: number) => tapeY0 + ((tapeTop - p) / (tapeTop - tapeBot)) * tapeH;

  const elements: React.ReactNode[] = [];

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
          {fmt(price)}
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

  // TP / SL price-level markers from Radar Vector (render before price so price is on top)
  if (rv && rv.searchCount > 0 && rv.tpPct > 0) {
    const isSell = rv.dominantSide === 'SELL'
      || (rv.dominantSide === 'NEUTRAL' && (dynamicRegime?.momentum ?? 0) < 0);
    const tpPrice = isSell ? mid * (1 - rv.tpPct / 100) : mid * (1 + rv.tpPct / 100);
    const slPrice = isSell ? mid * (1 + rv.slPct / 100) : mid * (1 - rv.slPct / 100);
    const tpY = priceToY(tpPrice);
    const slY = priceToY(slPrice);
    const tpColor = rvEstablished ? ECAM.GREEN : ECAM.DIM;
    const slColor = rvEstablished ? ECAM.RED : ECAM.DIM;

    if (tpY > tapeY0 && tpY < tapeY0 + tapeH) {
      elements.push(<line key="tp-line" x1="58" y1={tpY} x2="140" y2={tpY} stroke={tpColor} strokeWidth="1.5" strokeDasharray="6,3" opacity="0.7" style={{ transition: 'y1 0.8s ease-out, y2 0.8s ease-out' }} />);
      elements.push(
        <g key="tp-tag" style={{ transition: 'transform 0.8s ease-out' }}>
          <rect x="0" y={tpY - 14} width="56" height="28" rx="3" fill="rgba(0,0,0,0.9)" stroke={tpColor} strokeWidth="1.2" style={{ transition: 'y 0.8s ease-out' }} />
          <text x="5" y={tpY - 3} fill={tpColor} fontSize="9" fontFamily="monospace" fontWeight="bold" style={{ transition: 'y 0.8s ease-out' }}>TP {rv.tpPct.toFixed(2)}%</text>
          <text x="5" y={tpY + 10} fill={tpColor} fontSize="10" fontFamily="monospace" fontWeight="bold" style={{ transition: 'y 0.8s ease-out' }}>{fmt(tpPrice)}</text>
        </g>
      );
    }
    if (slY > tapeY0 && slY < tapeY0 + tapeH) {
      elements.push(<line key="sl-line" x1="58" y1={slY} x2="140" y2={slY} stroke={slColor} strokeWidth="1.5" strokeDasharray="6,3" opacity="0.7" style={{ transition: 'y1 0.8s ease-out, y2 0.8s ease-out' }} />);
      elements.push(
        <g key="sl-tag" style={{ transition: 'transform 0.8s ease-out' }}>
          <rect x="0" y={slY - 14} width="56" height="28" rx="3" fill="rgba(0,0,0,0.9)" stroke={slColor} strokeWidth="1.2" style={{ transition: 'y 0.8s ease-out' }} />
          <text x="5" y={slY - 3} fill={slColor} fontSize="9" fontFamily="monospace" fontWeight="bold" style={{ transition: 'y 0.8s ease-out' }}>SL {rv.slPct.toFixed(2)}%</text>
          <text x="5" y={slY + 10} fill={slColor} fontSize="10" fontFamily="monospace" fontWeight="bold" style={{ transition: 'y 0.8s ease-out' }}>{fmt(slPrice)}</text>
        </g>
      );
    }
  }

  // Transition price markers from DynamicRegime
  if (dynamicRegime && dynamicRegime.transitionPriceUp > 0) {
    const trColor = '#ff44ff';
    const tUpY = priceToY(dynamicRegime.transitionPriceUp);
    const tDnY = priceToY(dynamicRegime.transitionPriceDown);
    if (tUpY > tapeY0 && tUpY < tapeY0 + tapeH) {
      elements.push(<line key="tr-up-line" x1="60" y1={tUpY} x2="140" y2={tUpY} stroke={trColor} strokeWidth="1" strokeDasharray="3,4" opacity="0.6" style={{ transition: 'y1 0.8s ease-out, y2 0.8s ease-out' }} />);
      elements.push(<text key="tr-up-lbl" x="144" y={tUpY + 4} fill={trColor} fontSize="8" fontFamily="monospace" fontWeight="bold" opacity="0.8" style={{ transition: 'y 0.8s ease-out' }}>T▲</text>);
    }
    if (tDnY > tapeY0 && tDnY < tapeY0 + tapeH) {
      elements.push(<line key="tr-dn-line" x1="60" y1={tDnY} x2="140" y2={tDnY} stroke={trColor} strokeWidth="1" strokeDasharray="3,4" opacity="0.6" style={{ transition: 'y1 0.8s ease-out, y2 0.8s ease-out' }} />);
      elements.push(<text key="tr-dn-lbl" x="144" y={tDnY + 4} fill={trColor} fontSize="8" fontFamily="monospace" fontWeight="bold" opacity="0.8" style={{ transition: 'y 0.8s ease-out' }}>T▼</text>);
    }
  }

  // Current price marker (centered on tape, rendered last for z-priority)
  const midY = priceToY(mid);
  const pxL = hiDec ? 56 : 62;   // wider diamond for 4-digit mode
  const pxLi = hiDec ? 66 : 72;
  const pxRi = hiDec ? 134 : 128;
  const pxR = hiDec ? 144 : 138;
  const pxFs = hiDec ? 11 : 13;
  elements.push(
    <g key="price-marker" style={{ transition: 'transform 0.8s ease-out' }}>
      <polygon points={`${pxL},${midY} ${pxLi},${midY - 11} ${pxRi},${midY - 11} ${pxR},${midY} ${pxRi},${midY + 11} ${pxLi},${midY + 11}`} fill="rgba(0,0,0,0.95)" stroke={ECAM.GREEN} strokeWidth="2" style={{ transition: 'all 0.8s ease-out' }} />
      <text x="100" y={midY + 5} textAnchor="middle" fill={ECAM.GREEN} fontSize={pxFs} fontWeight="bold" fontFamily="monospace" style={{ transition: 'y 0.8s ease-out' }}>
        {fmt(mid)}
      </text>
    </g>
  );

  // Rate of change gauge
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

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.5 }}>
        <IconButton
          onClick={onScaleUp}
          size="small"
          sx={{ width: 18, height: 18, color: ECAM.CYAN, border: `1px solid ${ECAM.BORDER}`, borderRadius: '3px', fontSize: '0.7rem', p: 0, '&:hover': { bgcolor: 'rgba(0,221,255,0.1)' } }}
        >+</IconButton>
        <Typography sx={{ color: ECAM.WHITE, fontSize: '0.7rem', letterSpacing: '0.12em', fontWeight: 700 }}>
          SPEED — PRICE
        </Typography>
        <IconButton
          onClick={onScaleDown}
          size="small"
          sx={{ width: 18, height: 18, color: ECAM.CYAN, border: `1px solid ${ECAM.BORDER}`, borderRadius: '3px', fontSize: '0.7rem', p: 0, '&:hover': { bgcolor: 'rgba(0,221,255,0.1)' } }}
        >−</IconButton>
      </Box>
      <svg width="100%" height="100%" viewBox="0 0 200 380" style={{ maxWidth: 200 }}>
        <rect x="0" y="0" width="200" height="380" fill="rgba(5,5,10,0.9)" rx="4" />
        {elements}
        {/* D toggle — bottom left */}
        <foreignObject x="4" y="356" width="20" height="18">
          <button
            onClick={() => setHiDec(d => !d)}
            style={{
              width: 20, height: 18, padding: 0, margin: 0, border: `1.2px solid ${hiDec ? ECAM.CYAN : 'rgba(255,255,255,0.2)'}`,
              borderRadius: 3, background: hiDec ? 'rgba(0,221,255,0.15)' : 'rgba(255,255,255,0.04)',
              color: hiDec ? ECAM.CYAN : 'rgba(255,255,255,0.4)', fontSize: 10, fontFamily: 'monospace', fontWeight: 'bold',
              cursor: 'pointer', lineHeight: '16px',
            }}
          >D</button>
        </foreignObject>
      </svg>
    </Box>
  );
};

export default React.memo(SpeedTape);
