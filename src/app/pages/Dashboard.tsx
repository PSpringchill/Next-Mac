import React, { useRef, useState, useEffect } from 'react';
import PrimaryFlightDisplay from '../components/PrimaryFlightDisplay/Page';
import EngineDisplay from '../components/EngineDisplay/Page';
import DepthchartDisplay from '../components/DepthChartDisplay/Page';
import { Container, Grid } from '@material-ui/core';
import AutopilotDisplay from '../components/AutopilotDisplay/Page';
import OpenInterestGauge from '../components/PieChart/Page'; 

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
           
            </Grid>

            <div style={{ 
                position: 'fixed',
                bottom: -50,
                right: 0,
                width: '50%',
                padding: '16px',
                backgroundColor: '#000'
            }}>
                <OpenInterestGauge />      
            </div>
        </Container>
    );
};

export default Dashboard;
