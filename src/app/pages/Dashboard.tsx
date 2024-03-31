// Inside pages/Dashboard.tsx
import React from 'react';
import LiquidityRatioCalculator from '../components/LiquidityRatioCalculator'
import SolvencyRatioCalculator from '../components/SolvencyRatioCalculator'
import EfficiencyRatioCalculator from '../components/EfficiencyRatioCalculator'

const Dashboard = () => {
    return (
        <div>
            <h1>Balance Sheet Analysis Dashboard</h1>
            <div className="chart-container">
                <LiquidityRatioCalculator balanceSheetData={balanceSheetData} />
            </div>
            <div className="chart-container">
                <SolvencyRatioCalculator balanceSheetData={balanceSheetData} /> 
            </div>
            <div className="chart-container">
            <EfficiencyRatioCalculator balanceSheetData={balanceSheetData} />
            </div>
        </div>
    );
};

export default Dashboard;
