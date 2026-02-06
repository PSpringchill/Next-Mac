import React, { useState } from 'react';
import PrimaryFlightDisplay from '../components/PrimaryFlightDisplay/Page';
import EngineDisplay from '../components/EngineDisplay/Page';
import DepthchartDisplay from '../components/DepthChartDisplay/Page';
import { Container, Grid } from '@mui/material';
import AutopilotDisplay from '../components/AutopilotDisplay/Page';
import AdvancedVisualizationDashboard from '../components/TradingEngine/AdvancedVisualizationDashboard';

const Dashboard = () => {
    const [cacheBuster, setCacheBuster] = useState(0);

    return (
        <Container style={{ backgroundColor: '#000', minHeight: '100vh', position: 'relative' }}>

  
            <Grid 
                container 
                spacing={5} 
         
                alignItems="flex-start"
                style={{ marginBottom: '100px' }}
            >

                
                <Grid item xs={8} md={9}>
                    <div style={{ marginBottom: '16px' }}>
                        <AutopilotDisplay />
                        <DepthchartDisplay />
                    </div>
                    <div>
                        <EngineDisplay />
                    </div>
                </Grid>
                <PrimaryFlightDisplay />   

        {/* Main Visualization Dashboard */}
        <Grid item xs={12}>
      
    <AdvancedVisualizationDashboard />  
       
        </Grid>
        
 
 
      </Grid> 
   

 
        </Container>
    );
};

export default Dashboard;
