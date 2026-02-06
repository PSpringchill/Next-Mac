// src/components/Dashboard/DashboardLayout.tsx
import React, { useState } from 'react';
import { 
  Container, 
  Box, 
  useTheme,
  useMediaQuery
} from '@mui/material';
import { styled } from '@mui/material/styles';

// Components
import CockpitPanel from '../components/CockpitPanel';
import MachineLearningSection from './sections/MachineLearningSection';
import TradingSignalsSection from './sections/TradingSignalsSection';
import PerformanceMetricsSection from './sections/PerformanceMetricsSection';
import SidePanel from './SidePanel';
import TopBar from './TopBar';
import { MLEngineProvider } from '../api/MLContext';
import { RiskProvider } from '../api/RiskContext';
import { StrategyProvider } from '../api/StrategyContext';
import MDP2TrainingBridge from '../components/TradingEngine/MDP2TrainingBridge';
import LiveExecutionBridge from '../components/TradingEngine/LiveExecutionBridge';

const StyledContainer = styled(Container)(({ theme }) => ({
  backgroundColor: '#000000',
  minHeight: '100vh',
  padding: 0,
  maxWidth: '100% !important',
  background: 'linear-gradient(180deg, #000000 0%, #0a0a0a 100%)',
  position: 'relative',
  overflow: 'hidden',
  '&::before': {
    content: '""',
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: '100%',
    background: 'radial-gradient(circle at 20% 50%, rgba(0, 255, 136, 0.03) 0%, transparent 50%)',
    pointerEvents: 'none'
  }
}));

const MainContent = styled(Box)(({ theme }) => ({
  padding: theme.spacing(1.5),
  marginTop: 64,
  minHeight: 'calc(100vh - 64px)',
  transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
  [theme.breakpoints.down('sm')]: {
    marginLeft: 0,
    padding: theme.spacing(2)
  }
}));

const TabPanel = ({ children, value, index }: any) => (
  <Box 
    role="tabpanel"
    hidden={value !== index} 
    sx={{ 
      display: value === index ? 'flex' : 'none',
      flexDirection: 'column',
      flex: 1,
      minHeight: 0,
      animation: value === index ? 'fadeIn 0.3s' : 'none' 
    }}
  >
    {value === index && children}
  </Box>
);

const DashboardLayout: React.FC = () => {
  const [activeTab, setActiveTab] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen();
      setFullscreen(true);
    } else {
      document.exitFullscreen();
      setFullscreen(false);
    }
  };

  return (
    <StyledContainer>
      <MLEngineProvider>
        <RiskProvider>
          <StrategyProvider>
            <MDP2TrainingBridge />
            <LiveExecutionBridge />
            {/* Top Navigation Bar */}
            <TopBar 
              onMenuClick={() => setSidebarOpen(!sidebarOpen)}
              onFullscreenToggle={toggleFullscreen}
              isFullscreen={fullscreen}
              activeTab={activeTab}
              onTabChange={setActiveTab}
            />
            
            {/* Side Navigation */}
            <SidePanel 
              open={sidebarOpen} 
            />
            
            {/* Main Content Area */}
            <MainContent sx={{ 
              marginLeft: sidebarOpen && !isMobile ? '260px' : '0px',
              width: sidebarOpen && !isMobile ? 'calc(100% - 260px)' : '100%',
              minHeight: 'calc(100vh - 64px)',
              display: 'flex',
              flexDirection: 'column',
              overflowY: 'auto',
              bgcolor: '#000'
            }}>
              <TabPanel value={activeTab} index={0}>
                <CockpitPanel />
              </TabPanel>
              
              <TabPanel value={activeTab} index={1}>
                <MachineLearningSection />
              </TabPanel>
              
              <TabPanel value={activeTab} index={2}>
                <PerformanceMetricsSection />
              </TabPanel>
            </MainContent>
          </StrategyProvider>
        </RiskProvider>
      </MLEngineProvider>
    </StyledContainer>
  );
};

export default DashboardLayout;
