import React, { useContext } from 'react';
import './EngineDisplay.css';
import { OrderBookContext } from '../../api/Page';
import { useMLEngine } from '../../api/MLContext';

import {
  GaugeContainer,
  GaugeValueArc,
  GaugeReferenceArc,
  useGaugeState,
} from '@mui/x-charts/Gauge';

function GaugePointer({ value }: { value: number | null }) {
  const { valueAngle, outerRadius, cx, cy } = useGaugeState();

  const maxAngle = Math.PI * 0.75; // Maximum angle for the gauge arc
  const calculatedValueAngle = valueAngle; // Use the provided valueAngle from the hook

  let strokeColor = "green"; // Default color
  if (value !== null && value <= 35) {
    strokeColor = "red"; // Red if value is 80% or more
  } else if (value !== null && value <= 70) {
    strokeColor = "yellow"; // Yellow if value is between 65% and 80%
  } else {
    strokeColor = "green"; // Green for values above 80%
  }

  const targetX = cx + outerRadius * Math.cos(maxAngle - (value !== null ? value / 100 * maxAngle : 0));
  const targetY = cy - outerRadius * Math.sin(maxAngle - (value !== null ? value / 100 * maxAngle : 0));

  return (
    <g>
      <circle cx={cx} cy={cy} r={5} fill="white" />
      <path
        d={`M ${cx} ${cy} L ${targetX} ${targetY}`}
        stroke={strokeColor}
        strokeWidth={3}
      />
    </g>
  );
}

const EngineDisplay: React.FC = () => {
  const context = useContext(OrderBookContext);
  const { regime, prediction } = useMLEngine();
  const orderBookData = context?.orderBookData;

  const bids = orderBookData?.bids || [];
  const asks = orderBookData?.asks || [];

  // Calculate the total quantities of bids and asks for FOB
  const totalBidQuantity = bids.reduce((total: number, [_, quantity]: [string, string]) => total + parseFloat(quantity), 0);
  const totalAskQuantity = asks.reduce((total: number, [_, quantity]: [string, string]) => total + parseFloat(quantity), 0);
  const totalFOB = totalBidQuantity + totalAskQuantity; // This should be a number, not a string

  // Get the top bid and ask quantities
  const topBidQuantity = bids.length > 0 ? parseFloat(bids[0][1]) : 0;
  const topAskQuantity = asks.length > 0 ? parseFloat(asks[0][1]) : 0;

  // Ensure totalFOB is greater than 0 to avoid division by zero
  const bidPercentage = (totalBidQuantity / totalFOB) * 100;
  const askPercentage = (totalAskQuantity / totalFOB) * 100;

  return (
    <div className="ewd-container">
      {/* Gauge components */}
      <div className="ewd-row">
        <div className="ewd-column ewd-gauge">
            <GaugeContainer
              width={120}
              height={120}
              startAngle={-110}
              endAngle={110}
              value={bidPercentage} // Pass the correct value here
            >
              <GaugeReferenceArc />
              <GaugeValueArc />
              <GaugePointer value={bidPercentage} /> {/* Pass the value prop */}
            </GaugeContainer>
            N1
          <div className={`ewd-gauge-value-box`}>
            {bidPercentage.toFixed(4)}
          </div>
        </div>
        <div className="ewd-column ewd-gauge">
             <GaugeContainer
              width={120}
              height={120}
              startAngle={-110}
              endAngle={110}
              value={askPercentage} // Pass the correct value here
            >
              <GaugeReferenceArc />
              <GaugeValueArc />
              <GaugePointer value={askPercentage} /> {/* Pass the value prop */}
            </GaugeContainer>
            N2
          <div className={`ewd-gauge-value-box`}>
            {askPercentage.toFixed(4)}
          </div>
        </div>
      </div>
      <div className="ewd-warning">
        {regime?.isTransition ? 'REGIME TRANSITION DETECTED' : regime?.name === 'volatile' ? 'CAUTION: HIGH VOLATILITY' : 'ENG NORMAL - ALL SYSTEMS GREEN'}
      </div>
      <div className="ewd-status1">
        <div className="text-left1">- {prediction?.mostLikelyState.toUpperCase() || 'SCANNING'} ...</div>
        <div className="ewd-info">{regime?.name.split('_')[0].toUpperCase() || 'CRZ'}</div>
      </div>
      <div className="ewd-status2">
        <div className="text-left2">- VOLATILITY ....</div>
        <div className="ewd-info">{(regime?.volatility ? regime.volatility * 100 : 0).toFixed(4)}%</div>
      </div>
      <div className="ewd-status3">
        <div className="text-left3">- MOMENTUM ....</div>
        <div className="ewd-info">{regime?.momentum.toFixed(4) || '0.0000'}</div>
      </div>
      <div className="ewd-fob">
        FOB: {totalFOB.toFixed(0)}  KB
      </div>
    </div>
  );
};

export default EngineDisplay;
