'use client';

import React, { useState, useEffect, useRef, useCallback, useMemo, createContext, ReactNode } from 'react';

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

export type Timeframe = '5m' | '15m' | '1h';

export interface OrderBookContextType {
    orderBookData: OrderBookData | null; 
    openInterestData: OpenInterestData | null;
    openInterestHistData: OpenInterestHistData[] | null;
    loading: boolean;
    error: Error | null;
    symbol: string;
    setSymbol: (symbol: string) => void;
    timeframe: Timeframe;
    setTimeframe: (tf: Timeframe) => void;
}

const OrderBookContext = createContext<OrderBookContextType | null>(null);

const BASE_URL = 'https://fapi.binance.com/fapi/v1';
const DEFAULT_SYMBOL = 'BNBUSDT';
const DEFAULT_LIMIT = 50;

// Shallow-compare top-of-book to skip redundant setState
function orderBookChanged(prev: OrderBookData | null, next: OrderBookData): boolean {
    if (!prev) return true;
    if (prev.lastUpdateId === next.lastUpdateId) return false;
    // Check top-of-book prices — if unchanged, skip the update
    if (
        prev.bids[0]?.[0] === next.bids[0]?.[0] &&
        prev.bids[0]?.[1] === next.bids[0]?.[1] &&
        prev.asks[0]?.[0] === next.asks[0]?.[0] &&
        prev.asks[0]?.[1] === next.asks[0]?.[1] &&
        prev.bids.length === next.bids.length &&
        prev.asks.length === next.asks.length
    ) return false;
    return true;
}

export function OrderBookProvider({ symbol: initialSymbol = DEFAULT_SYMBOL, limit = DEFAULT_LIMIT, children }: { symbol?: string, limit?: number, children: ReactNode }) {
    const [activeSymbol, setActiveSymbol] = useState<string>(initialSymbol);
    const [timeframe, setTimeframe] = useState<Timeframe>('5m');
    const [orderBookData, setOrderBookData] = useState<OrderBookData | null>(null);
    const [openInterestData, setOpenInterestData] = useState<OpenInterestData | null>(null);
    const [openInterestHistData, setOpenInterestHistData] = useState<OpenInterestHistData[] | null>(null);
    const [loading, setLoading] = useState<boolean>(true);
    const [error, setError] = useState<Error | null>(null);
    const prevOrderBookRef = useRef<OrderBookData | null>(null);

    const handleSetSymbol = useCallback((newSymbol: string) => {
        const upper = newSymbol.toUpperCase().trim();
        if (upper && upper !== activeSymbol) {
            setActiveSymbol(upper);
            setOrderBookData(null);
            setOpenInterestData(null);
            setOpenInterestHistData(null);
            prevOrderBookRef.current = null;
            setLoading(true);
            setError(null);
        }
    }, [activeSymbol]);

    useEffect(() => {
        let orderBookIntervalId: NodeJS.Timeout | null = null;
        let openInterestIntervalId: NodeJS.Timeout | null = null;
        let isFetchingOB = false;

        const fetchOrderBook = async () => {
            if (isFetchingOB) return; // skip if previous fetch still in-flight
            isFetchingOB = true;
            try {
                const queryParams = new URLSearchParams({ symbol: activeSymbol, limit: limit.toString() });
                const response = await fetch(`${BASE_URL}/depth?${queryParams.toString()}`);

                if (!response.ok) {
                    throw new Error(`API request failed with status ${response.status}`);
                }

                const data: OrderBookData = await response.json();
                // Only trigger re-render if data actually changed
                if (orderBookChanged(prevOrderBookRef.current, data)) {
                    prevOrderBookRef.current = data;
                    setOrderBookData(data);
                }
                setLoading(false);
            } catch (error) {
                console.error('Error fetching order book data:', error);
                setError(error instanceof Error ? error : new Error('Failed to fetch order book data'));
                setLoading(false);
            } finally {
                isFetchingOB = false;
            }
        };

        const fetchOpenInterest = async () => {
            try {
                const response = await fetch(`/api/openInterestHistory?symbol=${activeSymbol}&period=1h&limit=24`);
                if (!response.ok) {
                    throw new Error(`API request failed with status ${response.status}`);
                }
                const data = await response.json();
                
                if (Array.isArray(data) && data.length > 0) {
                    const latest = data[0];
                    setOpenInterestData({
                        openInterest: latest.sumOpenInterest,
                        symbol: latest.symbol,
                        time: parseInt(latest.timestamp)
                    });
                    setOpenInterestHistData(data);
                } else if (data && !Array.isArray(data)) {
                    setOpenInterestData(data);
                    setOpenInterestHistData([data]);
                }
                setLoading(false);
            } catch (error) {
                console.error('Error fetching open interest data:', error);
                setError(error instanceof Error ? error : new Error('Failed to fetch open interest data'));
            }
        };

        // Initial fetches
        fetchOrderBook();
        fetchOpenInterest();

        // 1s poll for order book (was 500ms — halved frequency)
        orderBookIntervalId = setInterval(fetchOrderBook, 1000);
        openInterestIntervalId = setInterval(fetchOpenInterest, 10000);

        // Cleanup function
        return () => {
            if (orderBookIntervalId) {
                clearInterval(orderBookIntervalId);
            }
            if (openInterestIntervalId) {
                clearInterval(openInterestIntervalId);
            }
        };
    }, [activeSymbol, limit]);

    // Memoize context value so consumers only re-render when data actually changes
    const contextValue = useMemo(() => ({
        orderBookData,
        openInterestData,
        openInterestHistData,
        loading,
        error,
        symbol: activeSymbol,
        setSymbol: handleSetSymbol,
        timeframe,
        setTimeframe
    }), [orderBookData, openInterestData, openInterestHistData, loading, error, activeSymbol, handleSetSymbol, timeframe]);

    return (
        <OrderBookContext.Provider value={contextValue}>
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

export function processOrderBookData(orderBookData: OrderBookData | null): number[][] {
    if (!orderBookData) return [];

    const heatmapData: number[][] = [];

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
    if (!openInterestData || !openInterestData.time) return null;

    const timestamp = typeof openInterestData.time === 'string' ? parseInt(openInterestData.time) : openInterestData.time;
    const date = new Date(timestamp > 1e12 ? timestamp : timestamp * 1000);
    
    return {
        openInterest: parseFloat(openInterestData.openInterest),
        symbol: openInterestData.symbol,
        time: date,
        formattedTime: isNaN(date.getTime()) ? 'Real-time' : date.toLocaleTimeString()
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
