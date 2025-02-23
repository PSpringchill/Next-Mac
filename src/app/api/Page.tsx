'use client';

import React, { useState, useEffect, createContext, ReactNode } from 'react';

interface OrderBookData {
    lastUpdateId: number;
    bids: [string, string][];
    asks: [string, string][];
}

interface OpenInterestData {
    openInterest: string;
    symbol: string;
    time: number;
}

interface OpenInterestHistData {
    symbol: string;
    sumOpenInterest: string;
    sumOpenInterestValue: string;
    timestamp: string;
}

interface OrderBookContextType {
    orderBookData: OrderBookData | null;
    openInterestData: OpenInterestData | null;
    openInterestHistData: OpenInterestHistData[] | null;
    loading: boolean;
    error: Error | null;
}

const OrderBookContext = createContext<OrderBookContextType | null>(null);

const BASE_URL = 'https://fapi.binance.com/fapi/v1';
const DEFAULT_SYMBOL = 'KAITOUSDT';
const DEFAULT_LIMIT = 100;

export function OrderBookProvider({ symbol = DEFAULT_SYMBOL, limit = DEFAULT_LIMIT, children }: { symbol?: string, limit?: number, children: ReactNode }) {
    const [orderBookData, setOrderBookData] = useState<OrderBookData | null>(null);
    const [openInterestData, setOpenInterestData] = useState<OpenInterestData | null>(null);
    const [openInterestHistData, setOpenInterestHistData] = useState<OpenInterestHistData[] | null>(null);
    const [loading, setLoading] = useState<boolean>(true);
    const [error, setError] = useState<Error | null>(null);

    useEffect(() => {
        let orderBookIntervalId: NodeJS.Timeout | null = null;
        let openInterestIntervalId: NodeJS.Timeout | null = null;

        const fetchOrderBook = async () => {
            try {
                const queryParams = new URLSearchParams({ symbol, limit: limit.toString() });
                const response = await fetch(`${BASE_URL}/depth?${queryParams.toString()}`);

                if (!response.ok) {
                    throw new Error(`API request failed with status ${response.status}`);
                }

                const data = await response.json();
                console.log('Order book data fetched:', data);
                setOrderBookData(data);
                setLoading(false);
            } catch (error) {
                console.error('Error fetching order book data:', error);
                setError(error instanceof Error ? error : new Error('Failed to fetch order book data'));
                setLoading(false);
            }
        };

        const fetchOpenInterest = async () => {
            try {
                const response = await fetch(`${BASE_URL}/openInterest?symbol=${symbol}`);
                if (!response.ok) {
                    throw new Error(`API request failed with status ${response.status}`);
                }
                const data = await response.json();
                console.log('Open interest data fetched:', data);
                setOpenInterestData(data);

                // Fetch historical data
                const histResponse = await fetch(`${BASE_URL}/futures/data/openInterestHist?symbol=${symbol}&period=1h&limit=24`);
                if (!histResponse.ok) {
                    throw new Error(`API request failed with status ${histResponse.status}`);
                }
                const histData = await histResponse.json();
                setOpenInterestHistData(histData);
            } catch (error) {
                console.error('Error fetching open interest data:', error);
                setError(error instanceof Error ? error : new Error('Failed to fetch open interest data'));
            }
        };

        // Initial fetches
        fetchOrderBook();
        fetchOpenInterest();

        // Set up intervals
        orderBookIntervalId = setInterval(fetchOrderBook, 500);
        openInterestIntervalId = setInterval(fetchOpenInterest, 500);

        // Cleanup function
        return () => {
            if (orderBookIntervalId) {
                clearInterval(orderBookIntervalId);
            }
            if (openInterestIntervalId) {
                clearInterval(openInterestIntervalId);
            }
        };
    }, [symbol, limit]);

    return (
        <OrderBookContext.Provider value={{ 
            orderBookData, 
            openInterestData, 
            openInterestHistData,
            loading, 
            error 
        }}>
            {children}
        </OrderBookContext.Provider>
    );
}

export function OrderBookConsumer({ children }: { children: ReactNode }) {
    return (
        <OrderBookContext.Consumer>
            {(value) => (
                // Render the children directly here
                <>{children}</>
            )}
        </OrderBookContext.Consumer>
    );
}

export async function fetchOpenInterestHistory(symbol: string, period: string) {
    try {
        const response = await fetch(`/api/openInterestHistory?symbol=${symbol}&period=${period}`);
        if (!response.ok) {
            throw new Error('Failed to fetch open interest history');
        }
        return await response.json();
    } catch (error) {
        console.error('Error fetching open interest history:', error);
        return null;
    }
}

export async function fetchVolumeRatio(symbol: string, period: string) {
    try {
        const response = await fetch(`/api/volumeRatio?symbol=${symbol}&period=${period}`);
        if (!response.ok) {
            throw new Error('Failed to fetch volume ratio');
        }
        return await response.json();
    } catch (error) {
        console.error('Error fetching volume ratio:', error);
        return null;
    }
}

export function processOrderBookData(orderBookData: OrderBookData | null) {
    if (!orderBookData) return [];

    const heatmapData = [];

    orderBookData.bids.forEach((bid, index) => {
        heatmapData.push([
            parseFloat(bid[0]), // Price
            index,              // Y-index for bid
            parseFloat(bid[1])  // Quantity 
        ]);
    });

    orderBookData.asks.forEach((ask, index) => {
        heatmapData.push([
            parseFloat(ask[0]), // Price
            index + orderBookData.bids.length, // Y-index for ask
            parseFloat(ask[1])  // Quantity 
        ]);
    });

    return heatmapData;
}

export function processOpenInterestData(openInterestData: OpenInterestData | null) {
    if (!openInterestData) return null;

    return {
        openInterest: parseFloat(openInterestData.openInterest),
        symbol: openInterestData.symbol,
        time: new Date(openInterestData.time),
        formattedTime: new Date(openInterestData.time).toLocaleString()
    };
}

export function processOpenInterestHistData(histData: OpenInterestHistData[] | null) {
    if (!histData || histData.length === 0) return null;

    const processedData = histData.map(item => ({
        timestamp: new Date(parseInt(item.timestamp)),
        openInterest: parseFloat(item.sumOpenInterest),
        openInterestValue: parseFloat(item.sumOpenInterestValue),
    }));

    // Calculate some statistics
    const latestValue = processedData[processedData.length - 1].openInterest;
    const oldestValue = processedData[0].openInterest;
    const percentageChange = ((latestValue - oldestValue) / oldestValue) * 100;
    const maxValue = Math.max(...processedData.map(d => d.openInterest));
    const minValue = Math.min(...processedData.map(d => d.openInterest));

    return {
        data: processedData,
        stats: {
            percentageChange,
            maxValue,
            minValue,
            latestValue,
            oldestValue
        }
    };
}

// Export OrderBookContext
export { OrderBookContext };
