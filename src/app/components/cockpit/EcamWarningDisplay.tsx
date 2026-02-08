import React from 'react';
import { Box, Typography } from '@mui/material';
import { ECAM, EcamMessage, ChecklistItem, severityColor } from './ecamTheme';

interface EcamWarningDisplayProps {
  ecamMessages: EcamMessage[];
  procedures: { title: string; items: ChecklistItem[] };
  checkedItems: Record<string, boolean>;
  toggleCheck: (key: string) => void;
  resetChecks: () => void;
  regimeTransitions: Array<[string, string, number]>;
}

const EcamWarningDisplay: React.FC<EcamWarningDisplayProps> = ({
  ecamMessages, procedures, checkedItems, toggleCheck, resetChecks, regimeTransitions,
}) => (
  <Box sx={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>

    {/* ECAM MESSAGES */}
    <Box sx={{ bgcolor: ECAM.PANEL, p: 1.5, border: `1px solid ${ECAM.BORDER}`, minHeight: 120 }}>
      <Typography sx={{ color: ECAM.WHITE, fontSize: '0.65rem', letterSpacing: '0.15em', mb: 1, fontWeight: 700 }}>
        E/WD — MESSAGES
      </Typography>

      {ecamMessages.length === 0 ? (
        <Typography sx={{ color: ECAM.GREEN, fontSize: '0.78rem', fontWeight: 600 }}>
          ■ NORMAL — NO ALERTS
        </Typography>
      ) : (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.4 }}>
          {ecamMessages.map((msg, i) => (
            <Box key={i} sx={{ display: 'flex', alignItems: 'flex-start', gap: 0.8 }}>
              <Typography sx={{
                color: severityColor(msg.severity),
                fontSize: '0.72rem',
                fontWeight: 800,
                minWidth: 5,
              }}>
                {msg.severity === 'warning' ? '■' : msg.severity === 'caution' ? '▲' : '●'}
              </Typography>
              <Typography sx={{
                color: severityColor(msg.severity),
                fontSize: '0.72rem',
                fontWeight: msg.severity === 'warning' ? 800 : 600,
                minWidth: 42,
              }}>
                {msg.system}
              </Typography>
              <Typography sx={{
                color: severityColor(msg.severity),
                fontSize: '0.72rem',
                fontWeight: msg.severity === 'warning' ? 700 : 400,
              }}>
                {msg.text}
              </Typography>
            </Box>
          ))}
        </Box>
      )}
    </Box>

    {/* PROCEDURES / CHECKLIST */}
    <Box sx={{ bgcolor: ECAM.PANEL, p: 1.5, border: `1px solid ${ECAM.BORDER}`, flex: 1 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
        <Typography sx={{ color: ECAM.WHITE, fontSize: '0.65rem', letterSpacing: '0.15em', fontWeight: 700 }}>
          PROC — {procedures.title}
        </Typography>
        <Box
          onClick={resetChecks}
          sx={{ cursor: 'pointer', px: 0.8, py: 0.2, borderRadius: 0.5, bgcolor: 'rgba(255,255,255,0.05)', '&:hover': { bgcolor: 'rgba(255,255,255,0.1)' } }}
        >
          <Typography sx={{ color: ECAM.DIM, fontSize: '0.6rem' }}>RESET</Typography>
        </Box>
      </Box>

      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
        {procedures.items.map((item) => {
          const isChecked = checkedItems[item.key] || item.status === 'done';
          return (
            <Box
              key={item.key}
              onClick={() => toggleCheck(item.key)}
              sx={{
                display: 'flex', alignItems: 'center', gap: 1,
                cursor: 'pointer', px: 0.8, py: 0.4,
                borderRadius: 0.5,
                bgcolor: isChecked ? 'rgba(0,255,136,0.04)' : 'transparent',
                '&:hover': { bgcolor: 'rgba(255,255,255,0.03)' },
                transition: 'all 0.15s',
              }}
            >
              <Box sx={{
                width: 14, height: 14, borderRadius: 0.5,
                border: `1.5px solid ${isChecked ? ECAM.GREEN : ECAM.CYAN}`,
                bgcolor: isChecked ? ECAM.GREEN : 'transparent',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexShrink: 0,
              }}>
                {isChecked && (
                  <Typography sx={{ color: ECAM.BG, fontSize: '0.6rem', fontWeight: 900, lineHeight: 1 }}>✓</Typography>
                )}
              </Box>
              <Typography sx={{
                color: isChecked ? ECAM.GREEN : ECAM.CYAN,
                fontSize: '0.72rem',
                textDecoration: isChecked ? 'line-through' : 'none',
                opacity: isChecked ? 0.6 : 1,
              }}>
                {item.action}
              </Typography>
            </Box>
          );
        })}
      </Box>

      {/* Regime Transitions */}
      <Box sx={{ mt: 1.5, pt: 1, borderTop: `1px solid ${ECAM.BORDER}` }}>
        <Typography sx={{ color: ECAM.DIM, fontSize: '0.6rem', letterSpacing: '0.1em', mb: 0.5 }}>
          REGIME TRANSITIONS
        </Typography>
        {regimeTransitions.length === 0 ? (
          <Typography sx={{ color: ECAM.DIM, fontSize: '0.68rem' }}>No transitions recorded</Typography>
        ) : (
          regimeTransitions.slice(-4).map((t, i) => (
            <Typography key={i} sx={{ color: ECAM.MAGENTA, fontSize: '0.68rem' }}>
              {t[0]} → {t[1]}
            </Typography>
          ))
        )}
      </Box>
    </Box>
  </Box>
);

export default React.memo(EcamWarningDisplay);
