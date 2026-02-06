// src/components/Dashboard/SidePanel.tsx
import React, { useContext } from 'react';
import { 
  Drawer, 
  List, 
  ListItem, 
  ListItemIcon, 
  ListItemText,
  Divider,
  Box,
  Typography
} from '@mui/material';
import {
  TrendingUp,
  Assessment,
  Timeline,
  Settings
} from '@mui/icons-material';
import { styled } from '@mui/material/styles';
import { OrderBookContext } from '../api/Page';
import MetricsGrid from './sections/MetricsGrid';
import FeatureImportanceSection from './sections/FeatureImportanceSection';

const StyledDrawer = styled(Drawer)(({ theme }) => ({
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

interface SidePanelProps {
  open: boolean;
  activeTab?: number;
}

const SidePanel: React.FC<SidePanelProps> = ({ open, activeTab = 0 }) => {
  const context = useContext(OrderBookContext);
  const secondaryItems = [
    { icon: <TrendingUp />, text: 'Signals' },
    { icon: <Assessment />, text: 'Reports' },
    { icon: <Timeline />, text: 'History' },
    { icon: <Settings />, text: 'Settings' }
  ];

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

      <Box sx={{ p: 2, pb: 1 }}>
        <Typography variant="caption" sx={{ color: 'rgba(255, 255, 255, 0.3)', fontWeight: 700, letterSpacing: '0.1rem' }}>
          REAL-TIME METRICS
        </Typography>
      </Box>
      
      <Box sx={{ px: 1, mb: 0.5 }}>
        <MetricsGrid vertical />
        <FeatureImportanceSection compact />
      </Box>

      <Divider sx={{ bgcolor: 'rgba(255, 255, 255, 0.05)', my: 1 }} />
      
      <Box sx={{ p: 2, pb: 1 }}>
        <Typography variant="caption" sx={{ color: 'rgba(255, 255, 255, 0.3)', fontWeight: 700, letterSpacing: '0.1rem' }}>
          QUICK ACCESS
        </Typography>
      </Box>
      
      <List sx={{ pt: 0 }}>
        {secondaryItems.map((item) => (
          <ListItem
            key={item.text}
            button
            sx={{
              margin: '2px 16px',
              borderRadius: '8px',
              width: 'calc(100% - 32px)',
              py: 1,
              '&:hover': {
                bgcolor: 'rgba(255, 255, 255, 0.05)'
              }
            }}
          >
            <ListItemIcon sx={{ color: 'rgba(255, 255, 255, 0.3)', minWidth: 40 }}>
              {item.icon}
            </ListItemIcon>
            <ListItemText 
              primary={item.text} 
              sx={{ 
                '& .MuiListItemText-primary': {
                  color: 'rgba(255, 255, 255, 0.7)',
                  fontSize: '0.85rem'
                }
              }}
            />
          </ListItem>
        ))}
      </List>
    </StyledDrawer>
  );
};

export default SidePanel;
