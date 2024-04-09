'use client';

import React, { useState, useEffect, createContext, ReactNode } from 'react';
const OrderBookContext = createContext(null);
const BASE_URL = 'https://fapi.binance.com/fapi/v1/depth';
const DEFAULT_SYMBOL = 'ENAUSDT';
const DEFAULT_LIMIT = 50;

export function OrderBookProvider({ symbol = DEFAULT_SYMBOL, limit = DEFAULT_LIMIT, children }: { symbol?: string, limit?: number, children: ReactNode }) {
    const [orderBookData, setOrderBookData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        let intervalId = null;
        const fetchOrderBook = async () => {
            try {
                const queryParams = new URLSearchParams({ symbol, limit: limit.toString() });
                const response = await fetch(`${BASE_URL}?${queryParams.toString()}`);

                if (!response.ok) {
                    throw new Error(`API request failed with status ${response.status}`);
                }

                const data = await response.json();
                console.log('Order book data fetched:', data); 
                setOrderBookData(data);
                setLoading(false);
            } catch (error) {
                console.error('Error fetching order book data:', error);
                setError(error);
                setLoading(false);
            }
        };

        fetchOrderBook();

        intervalId = setInterval(fetchOrderBook, 500);
        // Cleanup function to cancel fetch if component unmounts before fetch completes
        return () => {
            if (intervalId) {
                clearInterval(intervalId);
            }
        };
    }, [symbol, limit]);

    return (
        <OrderBookContext.Provider value={{ orderBookData, loading, error }}>
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

export function processOrderBookData(orderBookData: any) {
    const heatmapData = [];

    orderBookData.bids.forEach((bid: any, index: number) => {
        heatmapData.push([
            parseFloat(bid[0]), // Price
            index,              // Y-index for bid
            parseFloat(bid[1])  // Quantity 
        ]);
    });

    orderBookData.asks.forEach((ask: any, index: number) => {
        heatmapData.push([
            parseFloat(ask[0]), // Price
            index + orderBookData.bids.length, // Y-index for ask
            parseFloat(ask[1])  // Quantity 
        ]);
    });
    return heatmapData;
}

// Export OrderBookContext
export { OrderBookContext };
