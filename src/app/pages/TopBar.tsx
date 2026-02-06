// src/components/Dashboard/TopBar.tsx
import React, { useContext, useState, useEffect, useRef, useCallback } from 'react';
import { 
  AppBar, 
  Toolbar, 
  IconButton, 
  Typography, 
  Box, 
  Chip,
  Badge,
  InputBase
} from '@mui/material';
import {
  Menu as MenuIcon,
  Fullscreen,
  FullscreenExit,
  Notifications,
  AccountCircle,
  FiberManualRecord,
  Search as SearchIcon
} from '@mui/icons-material';
import { styled } from '@mui/material/styles';
import { useMLEngine } from '../api/MLContext';
import { OrderBookContext, Timeframe } from '../api/Page';

const StyledAppBar = styled(AppBar)(({ theme }) => ({
  background: 'rgba(10, 10, 10, 0.95)',
  backdropFilter: 'blur(20px)',
  borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
  boxShadow: '0 4px 30px rgba(0, 0, 0, 0.5)',
  zIndex: theme.zIndex.drawer + 1
}));

interface TopBarProps {
  onMenuClick: () => void;
  onFullscreenToggle: () => void;
  isFullscreen: boolean;
  activeTab: number;
  onTabChange: (tab: number) => void;
}

const TopBar: React.FC<TopBarProps> = ({ 
  onMenuClick, 
  onFullscreenToggle, 
  isFullscreen,
  activeTab,
  onTabChange
}) => {
  const { regime, learner, dataStagnant } = useMLEngine();
  const context = useContext(OrderBookContext);
  const metrics = learner.getMetrics();
  const [currentTime, setCurrentTime] = useState<string>('');
  const [mounted, setMounted] = useState(false);
  const [symbolInput, setSymbolInput] = useState(context?.symbol || 'COLLECTUSDT');
  const [symbolFocused, setSymbolFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Sync input when context symbol changes externally
  useEffect(() => {
    if (context?.symbol && !symbolFocused) {
      setSymbolInput(context.symbol);
    }
  }, [context?.symbol, symbolFocused]);

  useEffect(() => {
    setMounted(true);
    const updateTime = () => {
      setCurrentTime(new Date().toLocaleString('en-US', { 
        weekday: 'short', 
        day: 'numeric', 
        month: 'short', 
        hour: '2-digit', 
        minute: '2-digit',
        hour12: true 
      }));
    };
    
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  const handleSymbolSubmit = useCallback(() => {
    const cleaned = symbolInput.toUpperCase().trim();
    if (cleaned && context?.setSymbol) {
      context.setSymbol(cleaned);
      inputRef.current?.blur();
    }
  }, [symbolInput, context]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSymbolSubmit();
    } else if (e.key === 'Escape') {
      setSymbolInput(context?.symbol || '');
      inputRef.current?.blur();
    }
  }, [handleSymbolSubmit, context?.symbol]);
  
  return (
    <StyledAppBar position="fixed" elevation={0}>
      <Toolbar sx={{ justifyContent: 'space-between' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <IconButton onClick={onMenuClick} sx={{ color: '#fff', mr: -1 }}>
            <MenuIcon />
          </IconButton>
          
          <Typography variant="h6" sx={{ 
            fontWeight: 800,
            letterSpacing: '0.1rem',
            background: 'linear-gradient(45deg, #00ff88, #00aaff)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            cursor: 'pointer',
            mr: 1
          }} onClick={() => onTabChange(0)}>
            MTMD
          </Typography>

          {/* Symbol Input */}
          <Box sx={{
            display: 'flex',
            alignItems: 'center',
            bgcolor: symbolFocused ? 'rgba(0, 170, 255, 0.08)' : 'rgba(255, 255, 255, 0.04)',
            border: `1px solid ${symbolFocused ? 'rgba(0, 170, 255, 0.4)' : 'rgba(255, 255, 255, 0.1)'}`,
            borderRadius: '6px',
            px: 1,
            py: 0.25,
            transition: 'all 0.2s',
            minWidth: 160,
            '&:hover': {
              bgcolor: 'rgba(255, 255, 255, 0.06)',
              borderColor: 'rgba(255, 255, 255, 0.2)'
            }
          }}>
            <SearchIcon sx={{ color: symbolFocused ? '#00aaff' : 'rgba(255,255,255,0.3)', fontSize: 16, mr: 0.5 }} />
            <InputBase
              inputRef={inputRef}
              value={symbolInput}
              onChange={(e) => setSymbolInput(e.target.value.toUpperCase())}
              onFocus={() => setSymbolFocused(true)}
              onBlur={() => { setSymbolFocused(false); handleSymbolSubmit(); }}
              onKeyDown={handleKeyDown}
              placeholder="BTCUSDT"
              sx={{
                color: '#fff',
                fontSize: '0.75rem',
                fontWeight: 700,
                fontFamily: 'monospace',
                letterSpacing: '0.05em',
                '& input': { p: 0 },
                '& input::placeholder': { color: 'rgba(255,255,255,0.25)', opacity: 1 }
              }}
            />
          </Box>

          {/* Timeframe Selector */}
          <Box sx={{ display: 'flex', alignItems: 'center', bgcolor: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', overflow: 'hidden' }}>
            {(['5m', '15m', '1h'] as Timeframe[]).map((tf) => (
              <Box
                key={tf}
                onClick={() => context?.setTimeframe(tf)}
                sx={{
                  px: 1.2,
                  py: 0.4,
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                  bgcolor: context?.timeframe === tf ? 'rgba(0, 170, 255, 0.15)' : 'transparent',
                  borderRight: tf !== '1h' ? '1px solid rgba(255,255,255,0.08)' : 'none',
                  '&:hover': { bgcolor: context?.timeframe === tf ? 'rgba(0, 170, 255, 0.2)' : 'rgba(255,255,255,0.06)' },
                }}
              >
                <Typography variant="caption" sx={{
                  fontWeight: 700,
                  fontSize: '0.65rem',
                  fontFamily: 'monospace',
                  letterSpacing: '0.03em',
                  color: context?.timeframe === tf ? '#00aaff' : 'rgba(255,255,255,0.4)',
                }}>
                  {tf.toUpperCase()}
                </Typography>
              </Box>
            ))}
          </Box>

          {/* Navigation Links */}
          <Box sx={{ display: { xs: 'none', lg: 'flex' }, alignItems: 'center', gap: 0.5, ml: 1 }}>
            {[
              { label: 'COCKPIT', index: 0 },
              { label: 'ML ANALYTICS', index: 1 },
              { label: 'PERFORMANCE', index: 2 }
            ].map((item) => (
              <Box
                key={item.index}
                onClick={() => onTabChange(item.index)}
                sx={{
                  px: 1.5,
                  py: 1,
                  cursor: 'pointer',
                  borderRadius: '4px',
                  transition: 'all 0.2s',
                  position: 'relative',
                  '&:hover': {
                    bgcolor: 'rgba(255, 255, 255, 0.05)',
                  },
                  ...(activeTab === item.index && {
                    '&::after': {
                      content: '""',
                      position: 'absolute',
                      bottom: 0,
                      left: '20%',
                      right: '20%',
                      height: '2px',
                      bgcolor: '#00ff88',
                      boxShadow: '0 0 10px #00ff88'
                    }
                  })
                }}
              >
                <Typography
                  variant="caption"
                  sx={{
                    fontWeight: 700,
                    letterSpacing: '0.05rem',
                    color: activeTab === item.index ? '#00ff88' : 'rgba(255, 255, 255, 0.5)',
                  }}
                >
                  {item.label}
                </Typography>
              </Box>
            ))}
          </Box>
          
          <Box sx={{ display: { xs: 'none', md: 'flex' }, alignItems: 'center', gap: 1.5 }}>
            <Chip 
              icon={<FiberManualRecord sx={{ color: (dataStagnant ? '#ff4444' : '#00ff88') + ' !important', fontSize: '12px !important' }} />}
              label={dataStagnant ? 'STAGNANT' : 'LIVE'}
              size="small"
              sx={{ 
                bgcolor: dataStagnant ? 'rgba(255, 68, 68, 0.1)' : 'rgba(0, 255, 136, 0.1)',
                color: dataStagnant ? '#ff4444' : '#00ff88',
                fontWeight: 'bold',
                border: `1px solid ${dataStagnant ? 'rgba(255, 68, 68, 0.3)' : 'rgba(0, 255, 136, 0.3)'}`,
                height: 24
              }}
            />
          </Box>
        </Box>
        
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <Typography variant="caption" sx={{ 
            color: 'rgba(255, 255, 255, 0.6)', 
            mr: 2,
            fontFamily: 'monospace',
            display: { xs: 'none', sm: 'block' },
            minWidth: '180px',
            textAlign: 'right'
          }}>
            {mounted ? currentTime : ''}
          </Typography>
          
          <IconButton onClick={onFullscreenToggle} sx={{ color: '#fff' }}>
            {isFullscreen ? <FullscreenExit /> : <Fullscreen />}
          </IconButton>
          
          <IconButton sx={{ color: '#fff' }}>
            <Badge badgeContent={3} color="error">
              <Notifications />
            </Badge>
          </IconButton>
          
          <IconButton sx={{ color: '#fff' }}>
            <AccountCircle />
          </IconButton>
        </Box>
      </Toolbar>
    </StyledAppBar>
  );
};

export default TopBar;