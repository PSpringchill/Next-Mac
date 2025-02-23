import React, { useEffect, useState, useRef, useContext } from 'react';
import Highcharts from 'highcharts';
import { OrderBookContext } from '../../api/Page';
import AutopilotDisplay from '../AutopilotDisplay/Page';
import { Container } from '@mui/material';
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
                            value: 0.1523,
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
                    valueDecimals: 2,
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
                        color: '#fc5857',
                    },
                ],
            });

            setChart(newChart);
        }

        // Update chart data when order book data changes
        if (orderBookData && chart) {
            const bids = orderBookData.bids.map(bid => [parseFloat(bid[0]), parseFloat(bid[1])] as [number, number]);
            const asks = orderBookData.asks.map(ask => [parseFloat(ask[0]), parseFloat(ask[1])] as [number, number]);

            const highestBid = bids[0] ? bids[0][0] : 0;
            const lowestAsk = asks[0] ? asks[0][0] : 0;

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
        <div style={{ display: 'flex', justifyContent: 'center', marginLeft: '-100px' }}>
            <div>
                <div ref={chartRef} id="depthchart"></div>
                <div
                    style={{
                        fontFamily: 'Consolas, Courier New, monospace',
                        display: 'flex',
                        justifyContent: 'space-between',
                    }}
                >
                <div style={{ textAlign: 'left' }}>
                        <h3>Top 3 Bids</h3>
                        {top3Bids.map((bid, index) => (
                            <div key={index}>
                                <div style={{ color: bid[1] === highestSize ? 'yellow' : 'red' }}>
                                    {`${bid[0]}`}
                                </div>
                                <div style={{ textAlign: 'left', color: 'grey' }}>{bid[1]}</div>
                            </div>
                        ))}
                    </div>
                    {/* Display top 3 bids and asks */}
                    <div style={{ textAlign: 'right' }}>
                        <h3>Top 3 Asks</h3>
                        {top3Asks.map((ask, index) => (
                            <div key={index}>
                                <div style={{ color: ask[1] === highestSize ? 'yellow' : 'green' }}>
                                    {`${ask[0]}`}
                                </div>
                                <div style={{ textAlign: 'right', color: 'grey' }}>{ask[1]}</div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default DepthchartDisplay;
