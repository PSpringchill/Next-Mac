'use client';

import React, { createContext, useContext, useMemo, ReactNode, useState } from 'react';
import DuelingDQN from '../components/TradingEngine/DuelingDQN';
import RewardCalculator from '../components/TradingEngine/RewardCalculator';
import RiskManager from '../components/TradingEngine/RiskManager';
import PrioritizedReplayBuffer from '@tradingEngine/utils/PrioritizedReplayBuffer';

interface StrategyContextType {
  dqn: DuelingDQN;
  rewardCalculator: RewardCalculator;
  replayBuffer: PrioritizedReplayBuffer;
}

const StrategyContext = createContext<StrategyContextType | null>(null);

export const StrategyProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [riskManager] = useState(() => new RiskManager());
  const [dqn] = useState(() => new DuelingDQN({ stateSize: 78, actionSize: 15, regimeHeads: 5 }));
  const [rewardCalculator] = useState(() => new RewardCalculator(riskManager));
  const [replayBuffer] = useState(() => new PrioritizedReplayBuffer(20000));

  const value = useMemo(() => ({ dqn, rewardCalculator, replayBuffer }), [dqn, rewardCalculator, replayBuffer]);

  return (
    <StrategyContext.Provider value={value}>
      {children}
    </StrategyContext.Provider>
  );
};

export const useStrategyEngine = () => {
  const context = useContext(StrategyContext);
  if (!context) {
    throw new Error('useStrategyEngine must be used within a StrategyProvider');
  }
  return context;
};
