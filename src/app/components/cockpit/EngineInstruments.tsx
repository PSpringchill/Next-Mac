import React from 'react';
import { Box, Typography } from '@mui/material';
import { ECAM, SmoothedTechData } from './ecamTheme';

interface EngineInstrumentsProps {
  smoothedTech: SmoothedTechData;
  isBullish: boolean;
  trendScore: number;
}

const EngineInstruments: React.FC<EngineInstrumentsProps> = ({ smoothedTech, isBullish, trendScore }) => (
  <Box sx={{ bgcolor: ECAM.PANEL, p: 1.5, border: `1px solid ${ECAM.BORDER}`, flex: 1 }}>
    <Typography sx={{ color: ECAM.WHITE, fontSize: '0.65rem', letterSpacing: '0.15em', mb: 1, fontWeight: 700 }}>
      ENGINE INSTRUMENTS
    </Typography>

    {/* RSI Gauge */}
    <Box sx={{ mb: 1 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.3 }}>
        <Typography sx={{ color: ECAM.DIM, fontSize: '0.7rem' }}>RSI(14)</Typography>
        <Typography sx={{
          color: smoothedTech.rsi < 30 ? ECAM.GREEN : smoothedTech.rsi > 70 ? ECAM.RED : ECAM.WHITE,
          fontSize: '0.8rem', fontWeight: 700,
        }}>
          {smoothedTech.rsi.toFixed(1)}
          <Box component="span" sx={{ color: ECAM.DIM, fontSize: '0.65rem', ml: 0.3 }}>
            {smoothedTech.rsi < 30 ? 'OVERSOLD' : smoothedTech.rsi > 70 ? 'OVERBOUGHT' : 'NEUTRAL'}
          </Box>
        </Typography>
      </Box>
      <Box sx={{ height: 6, width: '60%', bgcolor: 'rgba(255,255,255,0.06)', borderRadius: 1, position: 'relative' }}>
        <Box sx={{
          position: 'absolute', top: 0, bottom: 0, left: 0,
          width: `${Math.min(smoothedTech.rsi, 100)}%`,
          bgcolor: smoothedTech.rsi < 30 ? ECAM.GREEN : smoothedTech.rsi > 70 ? ECAM.RED : ECAM.CYAN,
          borderRadius: 1, transition: 'all 0.3s',
        }} />
        <Box sx={{ position: 'absolute', left: '25%', top: -2, bottom: -2, width: 1, bgcolor: 'rgba(255,255,255,0.15)' }} />
        <Box sx={{ position: 'absolute', left: '75%', top: -2, bottom: -2, width: 1, bgcolor: 'rgba(255,255,255,0.15)' }} />
      </Box>
    </Box>

    {/* MACD + Signal */}
    <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
      <Typography sx={{ color: ECAM.DIM, fontSize: '0.7rem' }}>MACD</Typography>
      <Typography sx={{ color: smoothedTech.macd >= 0 ? ECAM.GREEN : ECAM.RED, fontSize: '0.78rem', fontWeight: 600 }}>
        {smoothedTech.macd > 0 ? '+' : ''}{smoothedTech.macd.toFixed(3)}
      </Typography>
      <Typography sx={{ color: smoothedTech.signal === 'bullish' ? ECAM.GREEN : ECAM.RED, fontSize: '0.7rem', fontWeight: 600 }}>
        {smoothedTech.signal.toUpperCase()}
      </Typography>
    </Box>

    {/* EMAs */}
    {[
      { label: 'EMA 20', value: smoothedTech.ema20, compare: smoothedTech.ema50, cmpLabel: '> 50' },
      { label: 'EMA 50', value: smoothedTech.ema50, compare: smoothedTech.ema200, cmpLabel: '> 200' },
      { label: 'EMA 200', value: smoothedTech.ema200, compare: smoothedTech.midPrice, cmpLabel: 'vs MID' },
    ].map(({ label, value, compare, cmpLabel }) => (
      <Box key={label} sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.3 }}>
        <Typography sx={{ color: ECAM.DIM, fontSize: '0.7rem' }}>{label}</Typography>
        <Typography sx={{ color: ECAM.WHITE, fontSize: '0.75rem' }}>
          ${value.toFixed(4)}
        </Typography>
        <Typography sx={{ color: value > compare ? ECAM.GREEN : ECAM.AMBER, fontSize: '0.65rem' }}>
          {value > compare ? '▲' : '▼'} {cmpLabel}
        </Typography>
      </Box>
    ))}

    {/* VWAP */}
    <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
      <Typography sx={{ color: ECAM.DIM, fontSize: '0.7rem' }}>VWAP</Typography>
      <Typography sx={{ color: ECAM.WHITE, fontSize: '0.75rem' }}>${smoothedTech.vwap.toFixed(4)}</Typography>
      <Typography sx={{ color: smoothedTech.midPrice > smoothedTech.vwap ? ECAM.GREEN : ECAM.RED, fontSize: '0.65rem' }}>
        {smoothedTech.midPrice > smoothedTech.vwap ? 'ABOVE' : 'BELOW'}
      </Typography>
    </Box>

    {/* Heikin Ashi + Trend */}
    <Box sx={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      mt: 1, pt: 1, borderTop: `1px solid ${ECAM.BORDER}`,
    }}>
      <Typography sx={{ color: ECAM.DIM, fontSize: '0.7rem' }}>HEIKIN</Typography>
      <Box sx={{ display: 'flex', gap: 0.3 }}>
        {[0, 1, 2, 3].map(i => (
          <Typography key={i} sx={{ color: smoothedTech.heikinAshi ? ECAM.GREEN : ECAM.RED, fontSize: '0.9rem' }}>
            {smoothedTech.heikinAshi ? '▲' : '▼'}
          </Typography>
        ))}
      </Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Typography sx={{
          color: isBullish ? ECAM.GREEN : ECAM.RED,
          fontSize: '0.78rem', fontWeight: 700,
        }}>
          {isBullish ? 'BULLISH' : 'BEARISH'}
        </Typography>
        <Typography sx={{
          color: isBullish ? ECAM.GREEN : ECAM.RED,
          fontSize: '0.9rem', fontWeight: 800,
        }}>
          {trendScore > 0 ? '+' : ''}{trendScore}
        </Typography>
      </Box>
    </Box>
  </Box>
);

export default React.memo(EngineInstruments);
