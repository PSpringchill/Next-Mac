import React from 'react';
import { Box, Typography } from '@mui/material';
import { ECAM, FeatureWeight } from './ecamTheme';

interface FeatureRadarProps {
  featureWeights: FeatureWeight[];
}

const FeatureRadar: React.FC<FeatureRadarProps> = ({ featureWeights }) => {
  const cx = 170, cy = 185, maxR = 130;
  const n = featureWeights.length;
  const angleStep = n > 0 ? (2 * Math.PI) / n : 0;

  return (
    <Box sx={{ p: 1.5, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <Typography sx={{ color: ECAM.WHITE, fontSize: '0.7rem', letterSpacing: '0.12em', mb: 0.5, fontWeight: 700 }}>
        NAV — FEATURE WEIGHTS
      </Typography>
      <svg width="100%" height="100%" viewBox="0 0 340 380" style={{ maxWidth: 340 }}>
        <rect x="0" y="0" width="340" height="380" fill="rgba(5,5,10,0.9)" rx="4" />

        {n === 0 ? (
          <text x={cx} y={cy} textAnchor="middle" fill={ECAM.DIM} fontSize="12">NO DATA</text>
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
                  <polygon points={pts} fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="0.7" />
                  <text x={cx + 4} y={cy - r + 4} fill="rgba(255,255,255,0.2)" fontSize="7" fontFamily="monospace">{(ring * 100).toFixed(0)}%</text>
                </React.Fragment>
              );
            })}

            {/* Axis lines + labels */}
            {featureWeights.map((fw, i) => {
              const angle = -Math.PI / 2 + i * angleStep;
              const x2 = cx + maxR * Math.cos(angle);
              const y2 = cy + maxR * Math.sin(angle);
              const lx = cx + (maxR + 20) * Math.cos(angle);
              const ly = cy + (maxR + 20) * Math.sin(angle);
              return (
                <React.Fragment key={`axis-${i}`}>
                  <line x1={cx} y1={cy} x2={x2} y2={y2} stroke="rgba(255,255,255,0.08)" strokeWidth="0.7" />
                  <text x={lx} y={ly + 4} textAnchor="middle" fill={ECAM.DIM} fontSize="9" fontFamily="monospace" fontWeight="bold">
                    {fw.label}
                  </text>
                </React.Fragment>
              );
            })}

            {/* Data polygon */}
            <polygon
              points={featureWeights.map((fw, i) => {
                const angle = -Math.PI / 2 + i * angleStep;
                const r = maxR * Math.min(1, Math.max(0.05, fw.value));
                return `${cx + r * Math.cos(angle)},${cy + r * Math.sin(angle)}`;
              }).join(' ')}
              fill="rgba(0,221,255,0.12)" stroke={ECAM.CYAN} strokeWidth="2" style={{ transition: 'all 0.8s ease-out' }}
            />

            {/* Data points with value labels */}
            {featureWeights.map((fw, i) => {
              const angle = -Math.PI / 2 + i * angleStep;
              const clamped = Math.min(1, Math.max(0.05, fw.value));
              const r = maxR * clamped;
              const px = cx + r * Math.cos(angle);
              const py = cy + r * Math.sin(angle);
              const dotColor = fw.value > 1.0 ? ECAM.RED : fw.value > 0.7 ? ECAM.AMBER : fw.value > 0.4 ? ECAM.GREEN : ECAM.CYAN;
              const vlx = cx + (r + 16) * Math.cos(angle);
              const vly = cy + (r + 16) * Math.sin(angle);
              return (
                <React.Fragment key={`dot-${i}`}>
                  <circle cx={px} cy={py} r="4.5" fill={dotColor} style={{ transition: 'cx 0.8s ease-out, cy 0.8s ease-out, fill 0.6s' }} />
                  <text x={vlx} y={vly + 3} textAnchor="middle" fill={dotColor} fontSize="8" fontFamily="monospace" fontWeight="bold" style={{ transition: 'x 0.8s ease-out, y 0.8s ease-out, fill 0.6s' }}>
                    {(fw.value * 100).toFixed(0)}
                  </text>
                </React.Fragment>
              );
            })}
          </>
        )}

        <text x="170" y="370" textAnchor="middle" fill={ECAM.DIM} fontSize="9" fontFamily="monospace">
          TECHNICAL WEIGHT ANALYSIS
        </text>
      </svg>
    </Box>
  );
};

export default React.memo(FeatureRadar);
