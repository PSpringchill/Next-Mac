'use client';

import React, { useContext, useState, useEffect } from 'react';
import { OrderBookContext } from '../../api/Page';
import { Card, CardContent, Typography, Box, Grid, useTheme } from '@mui/material';
import {
    GaugeContainer,
    GaugeValueArc,
    GaugeReferenceArc,
    useGaugeState,
} from '@mui/x-charts/Gauge';
import { fetchOpenInterestHistory, fetchVolumeRatio, processOpenInterestData } from '../../api/Page';

interface OpenInterestHistItem {
    symbol: string;
    sumOpenInterest: string;      // total open interest
    sumOpenInterestValue: string; // total open interest value in USDT
    timestamp: string;
}

interface VolumeRatioItem {
    buySellRatio: string;
    buyVol: string;
    sellVol: string;
    timestamp: string;
}

interface ChartData {
    id: number;
    value: number;
    label?: string;
    color: string;
    openInterest?: number;
    openInterestValue?: number;
    buyVol?: number;
    sellVol?: number;
}

interface TimeframeData {
    [key: string]: {
        data: ChartData[] | null;
        volumeData: ChartData[] | null;
        loading: boolean;
    };
}

interface GaugePointerProps {
    value: number;
    color: string;
}

function GaugePointer({ value = 0, color }: GaugePointerProps) {
    const { valueAngle, outerRadius, cx, cy } = useGaugeState();
    const calculatedValueAngle = valueAngle || 0;

    const target = {
        x: (cx || 0) + (outerRadius || 0) * Math.sin(calculatedValueAngle),
        y: (cy || 0) - (outerRadius || 0) * Math.cos(calculatedValueAngle),
    };

    return (
        <g>
            <circle cx={cx} cy={cy} r={5} fill={color} />
            <path
                d={`M ${cx} ${cy} L ${target.x} ${target.y}`}
                stroke={color}
                strokeWidth={3}
            />
        </g>
    );
}

const OpenInterestGauge: React.FC = () => {
    const theme = useTheme();
    const context = useContext(OrderBookContext);
    const [timeframeData, setTimeframeData] = useState<TimeframeData>({
        '5m': { data: null, volumeData: null, loading: false },
        '15m': { data: null, volumeData: null, loading: false }
    });

    useEffect(() => {
        const fetchTimeframeData = async (period: string) => {
            if (!context?.openInterestData?.symbol) return;

            setTimeframeData(prev => ({
                ...prev,
                [period]: { ...prev[period], loading: true }
            }));

            try {
                // Fetch both open interest and volume ratio data
                const [histData, volumeData] = await Promise.all([
                    fetchOpenInterestHistory(context.openInterestData.symbol, period),
                    fetchVolumeRatio(context.openInterestData.symbol, period)
                ]);

                if (!histData || histData.length === 0 || !volumeData || volumeData.length === 0) {
                    throw new Error('No data available');
                }

                // Process open interest data
                const currentValue = parseFloat(histData[0]?.sumOpenInterest || '0');
                const currentValueUSDT = parseFloat(histData[0]?.sumOpenInterestValue || '0');
                const previousValues = histData.slice(1).map((item: OpenInterestHistItem) => parseFloat(item.sumOpenInterest));
                const avgPreviousValue = previousValues.reduce((a: number, b: number) => a + b, 0) / previousValues.length;

                let percentageChange = ((currentValue - avgPreviousValue) / avgPreviousValue) * 100;
                let percentage = 50 + (percentageChange / 2);
                percentage = Math.min(100, Math.max(1, percentage));

                const changeIndicator = percentageChange >= 0 ? '+' : '';

                // Process volume ratio data
                const currentBuyVol = parseFloat(volumeData[0]?.buyVol || '0');
                const currentSellVol = parseFloat(volumeData[0]?.sellVol || '0');
                const totalVol = currentBuyVol + currentSellVol;
                const buyPercentage = (currentBuyVol / totalVol) * 100;

                setTimeframeData(prev => ({
                    ...prev,
                    [period]: { 
                        data: [{
                            id: 0,
                            value: percentage,
                            label: `${percentage.toFixed(1)}%\n${changeIndicator}${percentageChange.toFixed(1)}%`,
                            color: percentageChange >= 0 ? theme.palette.success.main : theme.palette.error.main,
                            openInterest: currentValue,
                            openInterestValue: currentValueUSDT
                        }, {
                            id: 1,
                            value: 100 - percentage,
                            color: theme.palette.grey[800]
                        }],
                        volumeData: [{
                            id: 0,
                            value: buyPercentage,
                            label: `Buy: ${buyPercentage.toFixed(1)}%`,
                            color: theme.palette.success.main,
                            buyVol: currentBuyVol,
                            sellVol: currentSellVol
                        }, {
                            id: 1,
                            value: 100 - buyPercentage,
                            color: theme.palette.error.main
                        }],
                        loading: false 
                    }
                }));
            } catch (error) {
                console.error(`Error fetching ${period} data:`, error);
                setTimeframeData(prev => ({
                    ...prev,
                    [period]: { ...prev[period], loading: false }
                }));
            }
        };

        // Fetch data for each timeframe
        fetchTimeframeData('5m');
        fetchTimeframeData('15m');

        const intervals = {
            '5m': 300,   // 5 minutes
            '15m': 900   // 15 minutes
        };

        // Set up intervals for each timeframe
        const intervalIds = Object.entries(intervals).map(([period, interval]) => {
            return setInterval(() => fetchTimeframeData(period), interval);
        });

        return () => {
            intervalIds.forEach(id => clearInterval(id));
        };
    }, [context?.openInterestData?.symbol, theme.palette]);

    if (!context || !context.openInterestData) {
        return (
            <Box sx={{ 
                p: 2,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
            }}>
                <Typography variant="body2" color="rgba(255,255,255,0.4)">
                    Loading Market Sentiment...
                </Typography>
            </Box>
        );
    }

    const processedData = processOpenInterestData(context.openInterestData);
    if (!processedData) return null;

    const formatValue = (value: number) => {
        if (value >= 1000000) {
            return `${(value / 1000000).toFixed(4)}M`;
        } else if (value >= 1000) {
            return `${(value / 1000).toFixed(4)}K`;
        }
        return value.toFixed(4);
    };

    const renderGauge = (period: string, title: string) => {
        const timeframe = timeframeData[period];
        const data = timeframe.data;
        const volumeData = timeframe.volumeData;
        
        if (!data || !volumeData) return null;

        return (
            <Box sx={{ 
                display: 'flex', 
                flexDirection: 'column', 
                alignItems: 'center',
                p: 1.5,
                bgcolor: 'rgba(255,255,255,0.02)',
                borderRadius: 2,
                border: '1px solid rgba(255,255,255,0.05)'
            }}>
                <Typography 
                    variant="caption" 
                    sx={{ 
                        color: 'rgba(255,255,255,0.5)',
                        fontWeight: 700,
                        textTransform: 'uppercase',
                        letterSpacing: '0.05rem',
                        mb: 1
                    }}
                >
                    {title}
                </Typography>
                <Grid container spacing={1}>
                    <Grid item xs={6}>
                        <Box sx={{ position: 'relative', display: 'flex', justifyContent: 'center' }}>
                            <GaugeContainer
                                width={100}
                                height={100}
                                startAngle={-110}
                                endAngle={110}
                                value={data[0].value}
                            >
                                <GaugeReferenceArc style={{ stroke: 'rgba(255,255,255,0.05)' }} />
                                <GaugeValueArc style={{ stroke: data[0].color }} />
                                <GaugePointer value={data[0].value} color={data[0].color} />
                            </GaugeContainer>
                            <Box sx={{ 
                                position: 'absolute',
                                top: '40%',
                                color: data[0].color,
                                fontSize: '0.65rem',
                                fontWeight: 800
                            }}>
                                {data[0].value.toFixed(1)}%
                            </Box>
                        </Box>
                    </Grid>
                    <Grid item xs={6}>
                        <Box sx={{ position: 'relative', display: 'flex', justifyContent: 'center' }}>
                            <GaugeContainer
                                width={100}
                                height={100}
                                startAngle={-110}
                                endAngle={110}
                                value={volumeData[0].value}
                            >
                                <GaugeReferenceArc style={{ stroke: 'rgba(255,255,255,0.05)' }} />
                                <GaugeValueArc style={{ stroke: volumeData[0].color }} />
                                <GaugePointer value={volumeData[0].value} color={volumeData[0].color} />
                            </GaugeContainer>
                            <Box sx={{ 
                                position: 'absolute',
                                top: '40%',
                                color: volumeData[0].color,
                                fontSize: '0.65rem',
                                fontWeight: 800
                            }}>
                                {volumeData[0].value.toFixed(1)}%
                            </Box>
                        </Box>
                    </Grid>
                </Grid>
            </Box>
        );
    };

    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, p: 1 }}>
            <Box sx={{ 
                display: 'flex', 
                justifyContent: 'space-between', 
                alignItems: 'center', 
                pb: 1,
                borderBottom: '1px solid rgba(255,255,255,0.05)'
            }}>
                <Typography variant="subtitle2" sx={{ color: '#fff', fontWeight: 800 }}>
                    SENTIMENT ANALYSIS
                </Typography>
                <Typography variant="caption" sx={{ color: 'rgba(0, 255, 136, 0.8)', fontWeight: 700, fontFamily: 'monospace' }}>
                    {processedData.symbol}
                </Typography>
            </Box>

            <Grid container spacing={2}>
                <Grid item xs={12} md={6}>
                    {renderGauge('5m', '5m window')}
                </Grid>
                <Grid item xs={12} md={6}>
                    {renderGauge('15m', '15m window')}
                </Grid>
            </Grid>

            <Typography 
                variant="caption" 
                sx={{ 
                    textAlign: 'right', 
                    color: 'rgba(255, 255, 255, 0.2)',
                    fontFamily: 'monospace',
                    fontSize: '0.6rem'
                }}
            >
                Last Sync: {processedData.formattedTime || 'Real-time'}
            </Typography>
        </Box>
    );
};

export default OpenInterestGauge;
