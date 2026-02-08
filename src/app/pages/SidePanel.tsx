// src/components/Dashboard/SidePanel.tsx
import React, { useContext } from 'react';
import { Drawer, Divider, Box, Typography } from '@mui/material';
import { styled } from '@mui/material/styles';
import { OrderBookContext } from '../api/Page';
import { useMLEngine } from '../api/MLContext';
import { useRiskManager } from '../api/RiskContext';
import { useTradingStore } from '@stores/tradingStore';
import { AlphaRiskState } from '../components/TradingEngine/ParetoAnalyzer';

// ─── ECAM Colors ───
const C = {
  RED: '#ff2222',
  AMBER: '#ffaa00',
  GREEN: '#00ff88',
  CYAN: '#00ddff',
  WHITE: '#e0e0e0',
  DIM: 'rgba(255,255,255,0.35)',
  PANEL: 'rgba(12,14,20,0.92)',
  BORDER: 'rgba(255,255,255,0.06)',
};

const StyledDrawer = styled(Drawer)(() => ({
  '& .MuiDrawer-paper': {
    width: 260,
    background: 'rgba(10, 10, 10, 0.98)',
    backdropFilter: 'blur(20px)',
    borderRight: '1px solid rgba(255, 255, 255, 0.08)',
    marginTop: 64,
    height: 'calc(100% - 64px)',
    transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
    overflowY: 'auto',
    scrollbarWidth: 'none',
    '&::-webkit-scrollbar': { display: 'none' }
  }
}));

// ─── Status Card ───
const StatusCard: React.FC<{
  title: string;
  status: string;
  statusColor: string;
  rows: Array<{ label: string; value: string; color?: string }>;
  accentColor: string;
}> = ({ title, status, statusColor, rows, accentColor }) => (
  <Box sx={{
    mx: 1.5, mb: 1, p: 1.2,
    bgcolor: C.PANEL,
    border: `1px solid ${C.BORDER}`,
    borderLeft: `3px solid ${accentColor}`,
    borderRadius: 1,
    transition: 'border-color 0.3s',
    '&:hover': { borderColor: 'rgba(255,255,255,0.12)' },
  }}>
    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.8 }}>
      <Typography sx={{ color: C.WHITE, fontSize: '0.62rem', fontWeight: 700, letterSpacing: '0.12em' }}>
        {title}
      </Typography>
      <Typography sx={{ color: statusColor, fontSize: '0.55rem', fontWeight: 700 }}>
        {status}
      </Typography>
    </Box>
    {rows.map(({ label, value, color }) => (
      <Box key={label} sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', py: 0.2 }}>
        <Typography sx={{ color: C.DIM, fontSize: '0.55rem' }}>{label}</Typography>
        <Typography sx={{ color: color ?? C.WHITE, fontSize: '0.65rem', fontWeight: 600, fontFamily: 'monospace' }}>
          {value}
        </Typography>
      </Box>
    ))}
  </Box>
);

interface SidePanelProps {
  open: boolean;
  activeTab?: number;
}

const SidePanel: React.FC<SidePanelProps> = ({ open }) => {
  const context = useContext(OrderBookContext);
  const { regime, learner, enginePerformance, mlPrediction, history } = useMLEngine();
  const { portfolioState } = useRiskManager();
  const paretoState = useTradingStore((s) => s.paretoState);
  const signalFilter = useTradingStore((s) => s.signalFilter);
  const dynamicRegime = useTradingStore((s) => s.dynamicRegime);
  const signal = useTradingStore((s) => s.currentSignal);

  // ─── RISK card data ───
  const alphaState = paretoState?.alphaState;
  const riskStatus = alphaState === AlphaRiskState.LOCKOUT ? 'LOCKOUT'
    : alphaState === AlphaRiskState.CRITICAL ? 'CRITICAL'
    : alphaState === AlphaRiskState.HIGH ? 'HIGH'
    : alphaState === AlphaRiskState.ELEVATED ? 'ELEVATED'
    : alphaState === AlphaRiskState.SAFE ? 'SAFE' : 'INIT';
  const riskColor = alphaState === AlphaRiskState.LOCKOUT || alphaState === AlphaRiskState.CRITICAL ? C.RED
    : alphaState === AlphaRiskState.HIGH ? C.AMBER
    : alphaState === AlphaRiskState.ELEVATED ? C.CYAN
    : alphaState === AlphaRiskState.SAFE ? C.GREEN : C.DIM;

  // ─── ORDER FLOW card data ───
  const hmmRegime = signalFilter?.hmmRegime ?? 'awaiting';
  const hmmColor = hmmRegime === 'trending_up' ? C.GREEN
    : hmmRegime === 'trending_down' ? C.RED
    : hmmRegime === 'volatile' ? C.RED
    : hmmRegime === 'breakout' ? C.CYAN : C.AMBER;
  const gradNorm = signalFilter?.gradientSurprise?.gradientNorm ?? 0;
  const gradColor = gradNorm > 0.85 ? C.RED : gradNorm > 0.6 ? C.AMBER : C.GREEN;

  // ─── RL CORE card data ───
  const metrics = learner.getMetrics();
  const accuracy = metrics.accuracy;
  const accColor = accuracy > 0.6 ? C.GREEN : accuracy > 0.45 ? C.AMBER : C.RED;
  const latency = enginePerformance.latency;
  const latColor = latency < 50 ? C.GREEN : latency < 200 ? C.AMBER : C.RED;

  // ─── STRATEGY card data ───
  const signalDir = mlPrediction?.horizon1ms?.direction ?? 'hold';
  const signalLabel = signalDir === 'buy' ? 'BUY BIAS' : signalDir === 'sell' ? 'SELL BIAS' : 'HOLD';
  const signalColor = signalDir === 'buy' ? C.GREEN : signalDir === 'sell' ? C.RED : C.AMBER;
  const regimeScore = regime ? Math.min(1, Math.max(0, (regime.momentum + 1) / 2)) : 0;
  const policySteps = history.trainingMetrics.length;

  return (
    <StyledDrawer variant="persistent" open={open}>
      {/* Active Symbol Display */}
      <Box sx={{ p: 2, pb: 1 }}>
        <Typography variant="caption" sx={{ color: 'rgba(255, 255, 255, 0.3)', fontWeight: 700, letterSpacing: '0.1rem' }}>
          ACTIVE SYMBOL
        </Typography>
        <Typography sx={{
          color: '#00ff88',
          fontSize: '1.1rem',
          fontWeight: 800,
          fontFamily: 'monospace',
          letterSpacing: '0.05em',
          mt: 0.5
        }}>
          {context?.symbol || 'COLLECTUSDT'}
        </Typography>
        <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.3)', fontSize: '0.6rem' }}>
          BINANCE FUTURES
        </Typography>
      </Box>

      <Divider sx={{ bgcolor: 'rgba(255, 255, 255, 0.05)', my: 1 }} />

      <Box sx={{ p: 2, pb: 0.5 }}>
        <Typography variant="caption" sx={{ color: 'rgba(255, 255, 255, 0.3)', fontWeight: 700, letterSpacing: '0.1rem' }}>
          SYSTEM STATUS
        </Typography>
      </Box>

      {/* ─── RISK Card ─── */}
      <StatusCard
        title="RISK"
        status={riskStatus}
        statusColor={riskColor}
        accentColor={riskColor}
        rows={[
          { label: 'Alpha (α)', value: paretoState?.params?.alpha != null ? paretoState.params.alpha.toFixed(3) : '—', color: riskColor },
          { label: 'Pos Size', value: `×${(paretoState?.positionSizeMultiplier ?? 1).toFixed(2)}`, color: (paretoState?.positionSizeMultiplier ?? 1) >= 0.8 ? C.GREEN : C.AMBER },
          { label: 'Tail Risk', value: `${((paretoState?.params?.tailRisk ?? 0) * 100).toFixed(1)}%`, color: (paretoState?.params?.tailRisk ?? 0) > 0.3 ? C.RED : C.GREEN },
          { label: 'Risk Budget', value: `${(portfolioState.availableRiskBudget * 100).toFixed(0)}%`, color: portfolioState.availableRiskBudget > 0.5 ? C.GREEN : C.AMBER },
        ]}
      />

      {/* ─── ORDER FLOW Card ─── */}
      <StatusCard
        title="ORDER FLOW"
        status={hmmRegime.toUpperCase().replace('_', ' ')}
        statusColor={hmmColor}
        accentColor={hmmColor}
        rows={[
          { label: 'HMM Regime', value: hmmRegime.replace('_', ' '), color: hmmColor },
          { label: 'Momentum', value: (signalFilter?.hmmMomentum ?? 0) > 0 ? `+${(signalFilter?.hmmMomentum ?? 0).toFixed(4)}` : (signalFilter?.hmmMomentum ?? 0).toFixed(4), color: (signalFilter?.hmmMomentum ?? 0) > 0 ? C.GREEN : (signalFilter?.hmmMomentum ?? 0) < 0 ? C.RED : C.DIM },
          { label: 'Grad Surprise', value: `${(gradNorm * 100).toFixed(0)}%`, color: gradColor },
          { label: 'HMM Adj', value: `×${(signalFilter?.hmmConfidenceAdj ?? 1).toFixed(2)}`, color: (signalFilter?.hmmConfidenceAdj ?? 1) >= 1 ? C.GREEN : C.AMBER },
        ]}
      />

      {/* ─── RL CORE Card ─── */}
      <StatusCard
        title="RL CORE"
        status={accuracy > 0.55 ? 'ONLINE' : 'TRAINING'}
        statusColor={accuracy > 0.55 ? C.GREEN : C.AMBER}
        accentColor={C.CYAN}
        rows={[
          { label: 'Accuracy', value: `${(accuracy * 100).toFixed(1)}%`, color: accColor },
          { label: 'Loss', value: metrics.loss.toFixed(4), color: metrics.loss < 0.5 ? C.GREEN : C.AMBER },
          { label: 'Latency', value: `${latency.toFixed(1)}ms`, color: latColor },
          { label: 'Confidence', value: `${((signal?.confidence ?? 0) * 100).toFixed(0)}%`, color: (signal?.confidence ?? 0) > 0.7 ? C.GREEN : C.AMBER },
        ]}
      />

      {/* ─── STRATEGY Card ─── */}
      <StatusCard
        title="STRATEGY"
        status={signalLabel}
        statusColor={signalColor}
        accentColor={signalColor}
        rows={[
          { label: 'Signal', value: signalLabel, color: signalColor },
          { label: 'Regime', value: `${(regimeScore * 100).toFixed(0)}%`, color: C.CYAN },
          { label: 'Policy', value: `${policySteps} steps`, color: C.WHITE },
        ]}
      />
    </StyledDrawer>
  );
};

export default SidePanel;
