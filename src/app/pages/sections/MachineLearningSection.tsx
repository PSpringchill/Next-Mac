// src/components/Dashboard/sections/MachineLearningSection.tsx
import React from 'react';
import { Grid, Box } from '@mui/material';
import { DashboardCard } from './DashboardCard';
import AdaptiveMLDashboard from '../../components/TradingEngine/AdaptiveMLDashboard';
import InteractiveFeatureImportance from '../../components/TradingEngine/InteractiveFeatureImportance';
import LearningProgressVisualizer from '../../components/TradingEngine/LearningProgressVisualizer';
import StrategyEngineDashboard from '../../components/TradingEngine/StrategyEngineDashboard';
import AdvancedVisualizationDashboard from '../../components/TradingEngine/AdvancedVisualizationDashboard';
import RLBotAnalytics from '../../components/TradingEngine/RLBotAnalytics';

const MachineLearningSection: React.FC = () => {
  return (
    <Grid container spacing={2}>
      {/* RL Bot Analytics & Performance — Learning Curves */}
      <Grid item xs={12}>
        <DashboardCard title="RL Bot — Real-Time Analytics & Performance" height="auto" gradient>
          <RLBotAnalytics />
        </DashboardCard>
      </Grid>

      {/* ML Model Status Bar */}
      <Grid item xs={12}>
        <DashboardCard title="Adaptive ML Model Status" height="120px" gradient>
          <AdaptiveMLDashboard />
        </DashboardCard>
      </Grid>

      {/* Strategy Engine + RL Core (merged, full width) */}
      <Grid item xs={12}>
        <DashboardCard title="Engine & RL Core Status" height="220px">
          <StrategyEngineDashboard />
        </DashboardCard>
      </Grid>
      
      {/* Learning Progress & Feature Importance (side by side) */}
      <Grid item xs={12} lg={6}>
        <DashboardCard title="Model Learning Progress" height="550px">
          <LearningProgressVisualizer />
        </DashboardCard>
      </Grid>
      
      <Grid item xs={12} lg={6}>
        <DashboardCard title="Feature Importance Analysis" height="550px">
          <InteractiveFeatureImportance />
        </DashboardCard>
      </Grid>

      {/* Deep Analytics: Order Flow + Heatmap + Correlations */}
      <Grid item xs={12}>
        <DashboardCard title="Deep Analytics — Order Flow & Correlations" height="750px">
          <AdvancedVisualizationDashboard />
        </DashboardCard>
      </Grid>
    </Grid>
  );
};

export default MachineLearningSection;