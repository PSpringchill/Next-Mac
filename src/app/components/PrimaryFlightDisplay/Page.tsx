import React, { useState, useMemo, useContext, useEffect } from 'react';
import './PrimaryFlightDisplay.css';
import { OrderBookContext } from '../../api/Page';

const displayRange = 20; // Define the range of the scale display in percent (%)

const PrimaryFlightDisplay: React.FC = () => {
    const [tapePosition, setTapePosition] = useState<string>('0%');
    const [scaleMode, setScaleMode] = useState<'large' | 'small'>('large');

    const contextValue = useContext(OrderBookContext);
    const { orderBookData } = contextValue || {};

    const bids = orderBookData?.bids || [];
    const asks = orderBookData?.asks || [];

    const lastBid = bids.length > 0 ? parseFloat(bids[0][0]) : 0;
    const lastAsk = asks.length > 0 ? parseFloat(asks[0][0]) : 0;

    const generateScaleMarkers = (currentValue: number, range: number, numMarkers: number) => {
        const markers = [];
        const halfRange = range / 2;
        const increment = range / (numMarkers - 1);

        for (let i = 0; i < numMarkers; i++) {
            const value = currentValue + halfRange - (i * increment);
            const position = i * (100 / (numMarkers - 1));
            markers.push({
                value: scaleMode === 'large' ? value.toFixed(0) : value.toFixed(4),
                position: position.toFixed(2) + '%'
            });
        }

        return markers;
    };

    useEffect(() => {
        // Calculate the offset to center the tape on the last bid value
        const step = displayRange / 10; // Divide display range into steps
        const indexForCurrentValue = Math.round((lastBid % displayRange) / step);
        const centeredIndex = 5; // Assuming we want to center around the 5th index
        const offsetIndex = centeredIndex - indexForCurrentValue;
        const offsetPercentage = (offsetIndex * 10).toFixed(2); // Each step is 10%
        setTapePosition(`${offsetPercentage}%`);
      }, [lastBid]);

    const calculateSpread = useMemo(() => {
        // Calculate spread and ensure that lastBid and lastAsk are numbers
        return  (lastAsk - lastBid).toFixed(4);
    }, [lastBid, lastAsk]);

    const scaleMarkers = useMemo(() => {
        const range = scaleMode === 'large' ? 50 : 0.05;
        const numMarkers = 10;
        return generateScaleMarkers(lastBid, range, numMarkers);
    }, [lastBid, scaleMode]);

    const calculateOffsetForCenter = useMemo(() => {
        const valuesToShow = 10;
        const step = displayRange / valuesToShow;
        const indexForCurrentValue = Math.floor(lastBid / step);
        const centeredIndex = (valuesToShow - 1) / 2;
        const offset = (indexForCurrentValue - centeredIndex) * step;
        return offset.toFixed(2) + '%';
    }, [lastBid]);


    return (
        <div id="altimeter" className="altimeter">
            <div className="scale-mode-selector">
                <select value={scaleMode} onChange={(e) => setScaleMode(e.target.value as 'large' | 'small')}>
                    <option value="large">00. </option>
                    <option value="small">.00 </option>
                </select>
            </div>
            <div className="tape-container">
                <div className="tape" style={{ top: tapePosition }}>
                    {scaleMarkers.map((marker, index) => (
                        <div key={index} className="tape-marker" style={{ top: marker.position }}>
                            <span>{marker.value}</span>
                        </div>
                    ))}
                </div>
            </div>
            <div className="altitude-indicator">
                <span>{scaleMode === 'large' ? lastBid.toFixed(2) : lastBid.toFixed(6)}</span>
            </div>
            <div className="pressure-setting">
                <span>{calculateSpread} STD </span>
            </div>
        </div>
    );
};

export default PrimaryFlightDisplay;
