import React from 'react';
import styles from './AutopilotDisplay.module.css'; // Ensure the file name is correct
import PrimaryFlightDisplay from '../PrimaryFlightDisplay/Page';

const AutopilotDisplay: React.FC = () => {
  return (
    <div className={styles['pfd-display']}> {/* Use styles object for class */}
      <div className={styles['pfd-section']}>
        <span className={styles['pfd-text']}>SPEED</span>
      </div>
      <div className={styles['pfd-section']}>
        <span className={styles['pfd-text']}>ALT CRZ</span>
        <div className={`${styles['pfd-alt']} ${styles['pfd-text']}`} style={{ marginTop: '45px' }}>ALT</div>
      </div>
      <div className={styles['pfd-section']}>
        <span className={styles['pfd-text']}>RESIST TRK</span>
      </div>
      {/* <div className={`${styles['pfd-section']} ${styles['pfd-mode']}`}>
        <span className={styles['pfd-text']}>NAV</span>
      </div> */}
      <div className={`${styles['pfd-section']} ${styles['pfd-value']}`}>
        <span className={styles['pfd-text']}>
          1FD2
          </span>
          <div className={`${styles['pfd-alt']} ${styles['pfd-text']}`} style={{ marginTop: '45px', color: 'white' }}>  A/THR</div>
        
          </div>
        </div>
  );
  <div>
      <PrimaryFlightDisplay />
  </div>

};

export default AutopilotDisplay;
