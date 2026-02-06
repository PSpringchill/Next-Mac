import React, { useMemo, useEffect, useState } from 'react';
import { Box, Typography } from '@mui/material';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import { useMLEngine } from '../../api/MLContext';

const FeatureImportanceSection: React.FC<{ compact?: boolean }> = ({ compact = false }) => {
  const { mlPrediction } = useMLEngine();
  const [featureImportance, setFeatureImportance] = useState<Array<{ feature: string; importance: number; category: string }>>([]);
  const [isClient, setIsClient] = useState(false);

  useEffect(() => {
    setIsClient(true);
  }, []);

  useEffect(() => {
    if (!mlPrediction?.featureImportance) return;
    const features = Array.from(mlPrediction.featureImportance.entries()).map(([name, importance]) => {
      let category = 'base';
      if (name.startsWith('imbalance')) category = 'imbalance';
      else if (name.startsWith('vol_prof')) category = 'volume';
      else if (name.startsWith('liq_depth')) category = 'liquidity';
      return { feature: name, importance, category };
    });
    setFeatureImportance(features);
  }, [mlPrediction]);

  const categoryData = useMemo(() => {
    const dummyData = [
      { name: 'Base', value: 25, color: '#00ff88' },
      { name: 'Imbalance', value: 25, color: '#00aaff' },
      { name: 'Volume', value: 25, color: '#ffaa00' },
      { name: 'Liquidity', value: 25, color: '#bb88ff' }
    ];
    if (featureImportance.length === 0) return dummyData;
    
    const counts: any = { 'base': 0, 'imbalance': 0, 'volume': 0, 'liquidity': 0 };
    featureImportance.forEach(f => {
      if (counts[f.category] !== undefined) counts[f.category] += f.importance || 0;
    });
    
    const total = Object.values(counts).reduce((a: any, b: any) => a + b, 0) as number;
    if (total <= 0) return dummyData;
    
    return Object.entries(counts).map(([name, value]: [string, any]) => ({
      name: name.charAt(0).toUpperCase() + name.slice(1),
      value: (value / total) * 100,
      color: name === 'base' ? '#00ff88' : name === 'imbalance' ? '#00aaff' : name === 'volume' ? '#ffaa00' : '#bb88ff'
    })).filter(item => item.value > 0);
  }, [featureImportance]);

  if (!isClient) {
    return (
      <Box sx={{ width: '100%', height: compact ? 160 : 250, mt: 0.5, px: 1 }} />
    );
  }

  return (
    <Box sx={{ width: '100%', height: compact ? 160 : 250, mt: 0.5, px: 1 }}>
      {!compact && (
        <Typography variant="caption" sx={{ color: 'rgba(255, 255, 255, 0.3)', fontWeight: 700, mb: 0.5, display: 'block', fontSize: '0.6rem' }}>
          FEATURE DISTRIBUTION
        </Typography>
      )}
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={categoryData}
            cx="50%"
            cy="50%"
            innerRadius={compact ? 35 : 50}
            outerRadius={compact ? 55 : 75}
            fill="#8884d8"
            paddingAngle={2}
            dataKey="value"
            isAnimationActive={false}
          >
            {categoryData.map((entry, index) => (
              <Cell key={`cell-${index}`} fill={entry.color} />
            ))}
          </Pie>
          <Tooltip 
            contentStyle={{ backgroundColor: '#000', border: '1px solid #333', fontSize: '10px', padding: '4px 8px' }}
            itemStyle={{ color: '#fff', padding: 0 }}
            formatter={(value: any) => [`${parseFloat(value).toFixed(1)}%`]}
          />
        </PieChart>
      </ResponsiveContainer>
    </Box>
  );
};

export default FeatureImportanceSection;
