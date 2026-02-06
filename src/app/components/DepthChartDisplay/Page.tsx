import React, { useEffect, useState, useRef, useContext } from 'react';
import Highcharts from 'highcharts';
import { OrderBookContext } from '../../api/Page';
import AutopilotDisplay from '../AutopilotDisplay/Page';
import { Container, Box, Typography } from '@mui/material';
import './DepthchartDisplay.css';

const DepthchartDisplay: React.FC = () => {
    const context = useContext(OrderBookContext);
    
    if (!context) {
        return <div>Loading...</div>;
    }
    
    const { orderBookData } = context;
    const [chart, setChart] = useState<Highcharts.Chart | null>(null); // State to hold the Highcharts instance
    const chartRef = useRef<HTMLDivElement>(null); // Reference to the chart container
    const [top3Bids, setTop3Bids] = useState<[number, number][]>([]);
    const [top3Asks, setTop3Asks] = useState<[number, number][]>([]);
    const [highestSize, setHighestSize] = useState<number | null>(null); // State to hold the highest bid/ask size

    useEffect(() => {
        // Initialize the chart when the component mounts
        if (!chart && chartRef.current) {
            const newChart = Highcharts.chart(chartRef.current, {
                chart: {
                    type: 'area',
                    zoomType: 'xy',
                    backgroundColor: '#000000',
                },
                title: {
                    text: 'Market Depth',
                    style: {
                        color: '#ffffff', // Change text color here
                    },
                },
                xAxis: {
                    minPadding: 0,
                    maxPadding: 0,
                    plotLines: [
                        {
                            color: '#fff',
                            value: orderBookData?.bids?.[0]?.[0] ? parseFloat(orderBookData.bids[0][0]) : 0,
                            width: 1,
                            label: {
                                text: 'Actual price',
                                style: {
                                    color: '#ffffff',
                                },
                                rotation: 90,
                            },
                        },
                    ],
                    title: {
                        text: 'Price',
                        style: {
                            color: '#ffffff', // Change text color here
                        },
                    },
                    labels: {
                        formatter: function(this: Highcharts.AxisLabelsFormatterContextObject) {
                            return (this.value as number).toFixed(4);
                        },
                        style: {
                            color: '#ffffff'
                        }
                    }
                },
                yAxis: [
                    {
                        lineWidth: 1,
                        gridLineWidth: 1,
                        title: null,
                        tickWidth: 1,
                        tickLength: 5,
                        tickPosition: 'inside',
                        labels: {
                            text: 'Actual price',
                            style: {
                                color: '#ffffff',
                            },
                            align: 'left',
                            x: 8,
                        },
                    },
                    {
                        opposite: true,
                        linkedTo: 0,
                        lineWidth: 1,
                        gridLineWidth: 0,
                        title: null,
                        tickWidth: 1,
                        tickLength: 3,
                        tickPosition: 'inside',
                        labels: {
                            style: {
                                color: '#ffffff', // Change text color here
                            },
                            align: 'right',
                            x: -8,
                        },
                    },
                ],
                legend: {
                    enabled: false,
                },
                plotOptions: {
                    area: {
                        fillOpacity: 0.6,
                        lineWidth: 0.5,
                        step: 'center',
                    },
                },
                tooltip: {
                    headerFormat: '<span style="font-size: 10px;">Price: {point.key}</span><br/>',
                    valueDecimals: 4,
                },
                series: [
                    {
                        name: 'Bids',
                        data: [],
                        color: '#0099ff',
                    },
                    {
                        name: 'Asks',
                        data: [],
                        color: '#ff4444',
                    },
                ],
            } as any);

            setChart(newChart);
        }

        // Update chart data and plotLines when order book data changes
        if (orderBookData && chart) {
            const bids = orderBookData.bids.map(bid => [parseFloat(bid[0]), parseFloat(bid[1])] as [number, number]);
            const asks = orderBookData.asks.map(ask => [parseFloat(ask[0]), parseFloat(ask[1])] as [number, number]);

            const currentPrice = bids[0] ? bids[0][0] : 0;
            
            // Update the vertical line (Actual price)
            chart.xAxis[0].removePlotLine('price-line');
            chart.xAxis[0].addPlotLine({
                id: 'price-line',
                value: currentPrice,
                color: '#fff',
                width: 1,
                label: {
                    text: 'Actual price',
                    style: { color: '#ffffff' },
                    rotation: 90
                }
            });

            // Sort bids and asks arrays based on quantity (second element of the array) in descending order
            bids.sort((a, b) => b[1] - a[1]);
            asks.sort((a, b) => b[1] - a[1]);

            // Select the top 3 bid and ask values
            const top3BidValues = bids.slice(0, 3);
            const top3AskValues = asks.slice(0, 3);

            // Update states for top bids and asks and highest size
            setTop3Bids(top3BidValues);
            setTop3Asks(top3AskValues);

            const topBidSize = top3BidValues.length > 0 ? Math.max(...top3BidValues.map(bid => bid[1])) : 0;
            const topAskSize = top3AskValues.length > 0 ? Math.max(...top3AskValues.map(ask => ask[1])) : 0;
            setHighestSize(Math.max(topBidSize, topAskSize));

            // Update the chart series data
            chart.series[0].setData(top3BidValues);
            chart.series[1].setData(top3AskValues);
        }
    }, [chart, orderBookData]);

    return (
        <Box sx={{ p: 1, height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <Box 
                ref={chartRef} 
                id="depthchart" 
                sx={{ 
                    flex: 1, 
                    width: '100%', 
                    minHeight: 0,
                    '& .highcharts-container': {
                        borderRadius: '8px',
                        overflow: 'hidden',
                        height: '100% !important'
                    },
                    '& svg': {
                        height: '100% !important'
                    }
                }} 
            />
            
            <Box sx={{ 
                mt: 1, 
                display: 'flex', 
                justifyContent: 'space-between',
                gap: 2,
                fontFamily: "'JetBrains Mono', 'Fira Code', monospace"
            }}>
                {/* Bids Column */}
                <Box sx={{ flex: 1 }}>
                    <Typography variant="overline" sx={{ color: 'rgba(255,255,255,0.4)', fontWeight: 800, mb: 0.5, display: 'block', fontSize: '0.6rem', lineHeight: 1 }}>
                        Top 3 Bids
                    </Typography>
                    {top3Bids.map((bid, index) => (
                        <Box key={index} sx={{ 
                            display: 'flex', 
                            justifyContent: 'space-between', 
                            py: 0.25,
                            borderBottom: '1px solid rgba(255,255,255,0.05)',
                            '&:last-child': { borderBottom: 'none' }
                        }}>
                            <Typography sx={{ 
                                color: bid[1] === highestSize ? '#00ff88' : '#0099ff', 
                                fontWeight: 700,
                                fontSize: '0.75rem'
                            }}>
                                {bid[0].toFixed(4)}
                            </Typography>
                            <Typography sx={{ color: 'rgba(255,255,255,0.4)', fontSize: '0.75rem' }}>
                                {bid[1].toFixed(4)}
                            </Typography>
                        </Box>
                    ))}
                </Box>

                {/* Asks Column */}
                <Box sx={{ flex: 1 }}>
                    <Typography variant="overline" sx={{ color: 'rgba(255,255,255,0.4)', fontWeight: 800, mb: 0.5, display: 'block', textAlign: 'right', fontSize: '0.6rem', lineHeight: 1 }}>
                        Top 3 Asks
                    </Typography>
                    {top3Asks.map((ask, index) => (
                        <Box key={index} sx={{ 
                            display: 'flex', 
                            justifyContent: 'space-between', 
                            py: 0.25,
                            borderBottom: '1px solid rgba(255,255,255,0.05)',
                            '&:last-child': { borderBottom: 'none' }
                        }}>
                            <Typography sx={{ color: 'rgba(255,255,255,0.4)', fontSize: '0.75rem' }}>
                                {ask[1].toFixed(4)}
                            </Typography>
                            <Typography sx={{ 
                                color: ask[1] === highestSize ? '#ffaa00' : '#ff4444', 
                                fontWeight: 700,
                                fontSize: '0.75rem'
                            }}>
                                {ask[0].toFixed(4)}
                            </Typography>
                        </Box>
                    ))}
                </Box>
            </Box>
        </Box>
    );
};

export default DepthchartDisplay;
