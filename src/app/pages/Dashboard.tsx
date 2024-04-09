import React, { useRef, useState, useEffect } from 'react';
import PrimaryFlightDisplay from '../components/PrimaryFlightDisplay/Page';
import EngineDisplay from '../components/EngineDisplay/Page';
import DepthchartDisplay from '../components/DepthChartDisplay/Page';
import { Container, Grid, CardMedia } from '@material-ui/core';
import AutopilotDisplay from '../components/AutopilotDisplay/Page';

const Dashboard = () => {
    const [cacheBuster, setCacheBuster] = useState(0);

    return (
        <Container>
            <Grid container spacing={3} justifyContent="center" alignItems="center">

                <Grid item>
                <AutopilotDisplay />
                    <DepthchartDisplay />
                </Grid>
                <Grid item>
                    <PrimaryFlightDisplay />
                </Grid>
                <Grid item>
              
                <CardMedia
                        component="img"
                        alt="predict price"
                        image={`./predict.png?cache=${cacheBuster}`}
                        style={{ width: '200px', height: 'auto', maginRight: '20px' }} // Set the desired width and auto height
                    />
                  <EngineDisplay />
                </Grid>
                </Grid>
        </Container>
    );
};

export default Dashboard;
