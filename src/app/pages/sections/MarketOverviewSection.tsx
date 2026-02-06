// src/components/Dashboard/sections/MarketOverviewSection.tsx
import React from 'react';
import { Grid, Box } from '@mui/material';
import { DashboardCard } from './DashboardCard';
import PrimaryFlightDisplay from '../../components/PrimaryFlightDisplay/Page';
import DepthchartDisplay from '../../components/DepthChartDisplay/Page';
import Level2Section from './Level2Section';
import AdvancedVisualizationDashboard from '../../components/TradingEngine/AdvancedVisualizationDashboard';

const MarketOverviewSection: React.FC = () => {
  return (
    <Box sx={{ 
      display: 'flex', 
      flexDirection: 'column', 
      gap: 2, 
      width: '100%',
      p: 2,
      bgcolor: '#000',
      minHeight: '100%'
    }}>
      {/* Row 1: Depth and L2 */}
      <Box sx={{ 
        display: 'flex', 
        gap: 2, 
        width: '100%',
        flexWrap: { xs: 'wrap', md: 'nowrap' },
        minHeight: '600px'
      }}>
        <Box sx={{ flex: { xs: '1 1 100%', md: '0 0 60%' }, minWidth: 0 }}>
          <DashboardCard title="Depth & Navigation" height="100%">
            <Box sx={{ 
              display: 'flex', 
              flexDirection: 'row',
              height: '100%',
              gap: 1
            }}>
              <Box sx={{ flex: 1, minWidth: 0, height: '100%', display: 'flex', flexDirection: 'column' }}>
                <DepthchartDisplay />
              </Box>
              <Box sx={{ 
                flex: '0 0 100px', 
                borderLeft: '1px solid rgba(255, 255, 255, 0.08)',
                pl: 1,
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                height: '100%'
              }}>
                <PrimaryFlightDisplay />
              </Box>
            </Box>
          </DashboardCard>
        </Box>

        <Box sx={{ flex: { xs: '1 1 100%', md: '0 0 calc(40% - 16px)' }, minWidth: 0 }}>
          <DashboardCard title="L2 Analysis" height="100%">
            <Level2Section />
          </DashboardCard>
        </Box>
      </Box>

      {/* Row 2: Analytics */}
      <Box sx={{ width: '100%', minHeight: '850px', flex: '0 0 auto' }}>
        <DashboardCard title="Market Flow & Distribution" height="100%">
          <AdvancedVisualizationDashboard distributionOnly embedded />
        </DashboardCard>
      </Box>
    </Box>
  );
};

export default MarketOverviewSection;