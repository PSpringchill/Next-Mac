import React, { useEffect, useState, useRef, useContext } from 'react';
import Highcharts from 'highcharts';
import { OrderBookContext } from '../../api/Page';
import AutopilotDisplay from '../AutopilotDisplay/AutopilotDisplay';
import { Container } from '@mui/material/Container';
import './DepthchartDisplay.css';

const DepthchartDisplay: React.FC = () => {
    const { orderBookData } = useContext(OrderBookContext);
    const [chart, setChart] = useState<any>(null); // State to hold the Highcharts instance
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
        if (chart && orderBookData) {
            // Separate bids and asks from the fetched data and calculate top bids and asks
            const bids = orderBookData.bids.map((bid: [string, string]) => [
                parseFloat(bid[0]),
                parseFloat(bid[1]),
            ]);
            const asks = orderBookData.asks.map((ask: [string, string]) => [
                parseFloat(ask[0]),
                parseFloat(ask[1]),
            ]);

            // Assuming the order book data is already sorted by price
            const highestBid = bids[0] ? bids[0][0] : 0;
            const lowestAsk = asks[0] ? asks[0][0] : 0;

            // Sort bids and asks arrays based on quantity (second element of the array) in descending order
            bids.sort((a, b) => b[1] - a[1]);
            asks.sort((a, b) => b[1] - a[1]);

            // Select the top 3 bid and ask values
            const top3Bids = bids.slice(0, 3);
            const top3Asks = asks.slice(0, 3);

            // Update states for top bids and asks and highest size
            setTop3Bids(top3Bids);
            setTop3Asks(top3Asks);
            const topBidSize = top3Bids.length > 0 ? Math.max(...top3Bids.map((bid) => bid[1])) : null;
            const topAskSize = top3Asks.length > 0 ? Math.max(...top3Asks.map((ask) => ask[1])) : null;
            setHighestSize(Math.max(topBidSize, topAskSize));

            // Update the chart series data
            chart.series[0].setData(top3Bids);
            chart.series[1].setData(top3Asks);
        }
    }, [chart, orderBookData,]);

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
                        <h3>Top 3 Asks</h3>
                        {top3Asks.map((ask, index) => (
                            <div key={index}>
                                <div style={{ color: ask[1] === highestSize ? 'yellow' : 'red' }}>
                                    {`${ask[0]}`}
                                </div>
                                <div style={{ textAlign: 'left', color: 'grey' }}>{ask[1]}</div>
                            </div>
                        ))}
                    </div>
                    {/* Display top 3 bids and asks */}
                    <div style={{ textAlign: 'right' }}>
                        <h3>Top 3 Bids</h3>
                        {top3Bids.map((bid, index) => (
                            <div key={index}>
                                <div style={{ color: bid[1] === highestSize ? 'yellow' : 'green' }}>
                                    {`${bid[0]}`}
                                </div>
                                <div style={{ textAlign: 'right', color: 'grey' }}>{bid[1]}</div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default DepthchartDisplay;
