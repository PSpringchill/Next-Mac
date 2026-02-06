import React, { useContext } from 'react';
import styles from './AutopilotDisplay.module.css';
import { useMLEngine } from '../../api/MLContext';
import { OrderBookContext } from '../../api/Page';

const AutopilotDisplay: React.FC = () => {
  const { regime, prediction } = useMLEngine();
  const orderBookContext = useContext(OrderBookContext);
  
  const currentPrice = orderBookContext?.orderBookData?.asks?.[0]?.[0] || '0';
  const momentum = regime?.momentum || 0;
  
  return (
    <div className={styles['pfd-display']}>
      <div className={styles['pfd-section']}>
        <span className={styles['pfd-text']} style={{ color: '#00ff88' }}>
          {momentum > 0.01 ? 'THR CLB' : momentum < -0.01 ? 'THR IDLE' : 'SPEED'}
        </span>
      </div>
      <div className={styles['pfd-section']}>
        <span className={styles['pfd-text']}>ALT {regime?.name.split('_')[0].toUpperCase() || 'CRZ'}</span>
        <div className={`${styles['pfd-alt']} ${styles['pfd-text']}`} style={{ marginTop: '45px' }}>
          {parseFloat(currentPrice).toFixed(4)}
        </div>
      </div>
      <div className={styles['pfd-section']}>
        <span className={styles['pfd-text']}>
          {regime?.isTransition ? 'REG CHG' : 'NAV TRK'}
        </span>
      </div>
      <div className={`${styles['pfd-section']} ${styles['pfd-value']}`}>
        <span className={styles['pfd-text']}>
          {prediction?.mostLikelyState.toUpperCase() || '1FD2'}
        </span>
        <div className={`${styles['pfd-alt']} ${styles['pfd-text']}`} style={{ marginLeft: '-40px' , marginTop: '45px', color: '#00aaff' }}>
          A/THR
        </div>
      </div>
    </div>
  );
};

export default AutopilotDisplay;
