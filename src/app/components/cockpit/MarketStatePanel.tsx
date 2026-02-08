import React from 'react';
import { Box, Typography } from '@mui/material';
import { ECAM, SmoothedTechData } from './ecamTheme';

interface MarketStatePanelProps {
  smoothedTech: SmoothedTechData;
  wallRangePct: number;
  setWallRangePct: (v: number) => void;
  wallRangeOptions: number[];
}

const MarketStatePanel: React.FC<MarketStatePanelProps> = ({
  smoothedTech, wallRangePct, setWallRangePct, wallRangeOptions,
}) => (
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
);

export default React.memo(MarketStatePanel);
