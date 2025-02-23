import React, { useContext } from 'react';
import './EngineDisplay.css';
import { OrderBookContext } from '../../api/Page';

import {
  GaugeContainer,
  GaugeValueArc,
  GaugeReferenceArc,
  useGaugeState,
} from '@mui/x-charts/Gauge';

function GaugePointer({ value }) {
  const { valueAngle, outerRadius, cx, cy } = useGaugeState();

  const maxAngle = Math.PI * 0.75; // Maximum angle for the gauge arc
  const calculatedValueAngle = valueAngle; // Use the provided valueAngle from the hook

  let strokeColor = "green"; // Default color
  if (value <= 35) {
    strokeColor = "red"; // Red if value is 80% or more
  } else if (value <= 70) {
    strokeColor = "yellow"; // Yellow if value is between 65% and 80%
  }

  const target = {
    x: cx + outerRadius * Math.sin(calculatedValueAngle),
    y: cy - outerRadius * Math.cos(calculatedValueAngle),
  };

  return (
    <g>
      <circle cx={cx} cy={cy} r={5} fill="white" />
      <path
        d={`M ${cx} ${cy} L ${target.x} ${target.y}`}
        stroke={strokeColor}
        strokeWidth={3}
      />
    </g>
  );
}

const EngineDisplay: React.FC = () => {
  const { orderBookData } = useContext(OrderBookContext);

  const bids = orderBookData?.bids || [];
  const asks = orderBookData?.asks || [];

 // Calculate the total quantities of bids and asks for FOB
  const totalBidQuantity = bids.reduce((total, [_, quantity]) => total + parseFloat(quantity), 0);
  const totalAskQuantity = asks.reduce((total, [_, quantity]) => total + parseFloat(quantity), 0);
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
            {bidPercentage.toFixed(1)}
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
            {askPercentage.toFixed(1)}
          </div>
        </div>
      </div>
      <div className="ewd-warning">
        ENG N2 DOUBLE BIDS
      </div>
      <div className="ewd-status1">
        <div className="text-left1">- THR LEVERS ...</div>
        <div className="ewd-info">CRZ ALT</div>
      </div>
      <div className="ewd-status2">
        <div className="text-left2">- STOPLOSS ....</div>
        <div className="ewd-info">OFF</div>
      </div>
      <div className="ewd-status3">
        <div className="text-left3">- TAKEPROFIT ....</div>
        <div className="ewd-info">OFF</div>
      </div>
      <div className="ewd-fob">
        FOB: {totalFOB.toFixed(0)}  KB
      </div>
    </div>
  );
};

export default EngineDisplay;
