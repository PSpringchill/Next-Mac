// src/app/pages/sections/MarketAnalysisSection.tsx
import React from 'react';
import { Grid, Box } from '@mui/material';
import { DashboardCard } from './DashboardCard';
import TechnicalDataPanel from '../../components/TechnicalDataPanel';

const MarketAnalysisSection: React.FC = () => {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <Grid container spacing={3}>
        {/* Technical Data Panel Row */}
        <Grid item xs={12}>
          <DashboardCard title="Technical Market Analysis" height="auto">
            <TechnicalDataPanel />
          </DashboardCard>
        </Grid>

      </Grid>
    </Box>
  );
};

export default MarketAnalysisSection;
