'use client';

import { useContext, useEffect, useRef } from 'react';
import { OrderBookContext, OrderBookContextType } from '../../api/Page';
import { useMLEngine } from '../../api/MLContext';
import { useStrategyEngine } from '../../api/StrategyContext';
import { useRiskManager } from '../../api/RiskContext';
import UnifiedStateEncoder from './UnifiedStateEncoder';
import Level2FeatureExtractor from './Level2FeatureExtractor';
import { MarketRegime } from '@tradingEngine/types';

const DEFAULT_REGIME: MarketRegime = {
  name: 'unknown',
  volatility: 0.01,
  momentum: 0,
  isTransition: false,
  transitionProbabilities: [0, 0, 0, 0, 0]
};

const mapActionToSignal = (action: number) => {
  if (action <= 4) return { direction: -1, scale: (5 - action) / 5 };
  if (action <= 9) return { direction: 0, scale: 0 };
  return { direction: 1, scale: (action - 9) / 5 };
};

const MDP2TrainingBridge = () => {
  const context = useContext(OrderBookContext) as OrderBookContextType | null;

  const { mlPrediction, prediction, regime } = useMLEngine();
  const { dqn, replayBuffer } = useStrategyEngine();
  const { portfolioState } = useRiskManager();

  const encoderRef = useRef(new UnifiedStateEncoder());
  const featureExtractorRef = useRef(new Level2FeatureExtractor());

  const lastPriceRef = useRef(0);
  const lastUpdateRef = useRef(0);
  const prevStateRef = useRef<number[] | null>(null);
  const prevActionRef = useRef<number | null>(null);
  const trainStepRef = useRef(0);

  useEffect(() => {
    const orderBook = context?.orderBookData;
    if (!orderBook?.asks?.length || !orderBook?.bids?.length) return;

    const now = Date.now();
    if (now - lastUpdateRef.current < 500) return;
    lastUpdateRef.current = now;

    const currentPrice = parseFloat(orderBook.asks[0][0]);
    if (!Number.isFinite(currentPrice)) return;

    const priceChange = lastPriceRef.current
      ? (currentPrice - lastPriceRef.current) / lastPriceRef.current
      : 0;
    lastPriceRef.current = currentPrice;

    const microstructure = featureExtractorRef.current.extractMicrostructure(orderBook);
    const resolvedRegime = regime ?? DEFAULT_REGIME;

    const state = encoderRef.current.encode({
      microstructure,
      regime: resolvedRegime,
      portfolio: portfolioState,
      signals: {
        multiHorizon: mlPrediction,
        markov: prediction
      }
    });

    const qValues = dqn.predict(state, 0);
    const qArray = Array.from(qValues.dataSync());
    qValues.dispose();

    let action = 0;
    let maxValue = qArray[0] ?? 0;
    for (let i = 1; i < qArray.length; i += 1) {
      if (qArray[i] > maxValue) {
        maxValue = qArray[i];
        action = i;
      }
    }

    if (prevStateRef.current && prevActionRef.current !== null) {
      const { direction, scale } = mapActionToSignal(prevActionRef.current);
      const reward = priceChange * direction * scale;
      replayBuffer.add({
        state: prevStateRef.current,
        action: prevActionRef.current,
        reward,
        nextState: state,
        done: false
      }, Math.abs(reward));
    }

    prevStateRef.current = state;
    prevActionRef.current = action;

    if (replayBuffer.size() >= 64 && trainStepRef.current % 10 === 0) {
      const batch = replayBuffer.sample(32);
      const targets = batch.samples.map((sample) => {
        const nextQ = dqn.predict(sample.nextState, 0);
        const nextValues = Array.from(nextQ.dataSync());
        nextQ.dispose();
        const maxNext = Math.max(...nextValues);
        const currentQ = dqn.predict(sample.state, 0);
        const currentValues = Array.from(currentQ.dataSync());
        currentQ.dispose();

        const updated = [...currentValues];
        updated[sample.action] = sample.reward + 0.95 * maxNext;
        return updated;
      });

      dqn.train({
        states: batch.samples.map((sample) => sample.state),
        targets,
        regimeIndex: 0
      });
    }

    trainStepRef.current += 1;
  }, [context, mlPrediction, prediction, regime, dqn, replayBuffer, portfolioState]);

  return null;
};

export default MDP2TrainingBridge;
