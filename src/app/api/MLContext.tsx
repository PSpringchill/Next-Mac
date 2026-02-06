'use client';

import React, { createContext, useContext, useEffect, useState, useRef, useMemo, ReactNode } from 'react';
import { OrderBookContext } from './Page';
import AdaptiveMarketLearner from '../components/TradingEngine/AdaptiveMarketLearner';
import { 
  MarketStatePrediction, 
  MultiHorizonPrediction, 
  MarketRegime 
} from '@tradingEngine/types';

interface MLContextType {
  learner: AdaptiveMarketLearner;
  prediction: MarketStatePrediction | null;
  mlPrediction: MultiHorizonPrediction | null;
  regime: MarketRegime | null;
  isTraining: boolean;
  dataStagnant: boolean;
  enginePerformance: {
    latency: number;
    throughput: number;
  };
  history: {
    learningCurve: Array<{ epoch: number; accuracy: number; loss: number }>;
    importanceHistory: number[][];
    historyLabels: string[];
    regimeTransitions: Array<[string, string, number]>;
    sampleCount: number;
    trainingMetrics: Array<{
      step: number;
      accuracy: number;
      loss: number;
      gradientNorm: number;
      weightsDistribution: number[];
    }>;
    logs: Array<{
      timestamp: string;
      type: 'TRAINING' | 'FEATURE' | 'ERROR' | 'INFO';
      message: string;
      data?: any;
    }>;
  };
}

const MLEngineContext = createContext<MLContextType | null>(null);

export const MLEngineProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const orderBookContext = useContext(OrderBookContext);
  const [learner] = useState(() => new AdaptiveMarketLearner());
  const [prediction, setPrediction] = useState<MarketStatePrediction | null>(null);
  const [mlPrediction, setMLPrediction] = useState<MultiHorizonPrediction | null>(null);
  const [regime, setRegime] = useState<MarketRegime | null>(null);
  const [isTraining, setIsTraining] = useState(false);
  const [enginePerformance, setEnginePerformance] = useState({ latency: 0, throughput: 0 });
  const [history, setHistory] = useState<MLContextType['history']>({
    learningCurve: [],
    importanceHistory: [],
    historyLabels: [],
    regimeTransitions: [],
    sampleCount: 0,
    trainingMetrics: [],
    logs: []
  });
  
  const [dataStagnant, setDataStagnant] = useState(false);
  const stagnantCountRef = useRef<number>(0);
  
  const trainingStepRef = useRef<number>(0);
  
  const isProcessingRef = useRef<boolean>(false);
  const lastUpdateRef = useRef<number>(0);
  const lastPriceRef = useRef<number>(0);
  const processCountRef = useRef<number>(0);
  const startTimeRef = useRef<number>(Date.now());

  useEffect(() => {
    if (!orderBookContext?.orderBookData) return;

    const processData = async () => {
      if (isProcessingRef.current) return;
      
      try {
        const now = Date.now();
        if (now - lastUpdateRef.current < 1000) return; // Throttle to 1Hz
        lastUpdateRef.current = now;
        isProcessingRef.current = true;

        const processStart = performance.now();
        const orderBook = orderBookContext.orderBookData!;
        
        if (!orderBook?.asks?.length || !orderBook?.bids?.length) {
          return;
        }

        const currentPrice = parseFloat(orderBook.asks[0][0]);
        if (isNaN(currentPrice)) return;
        
        // Data stagnancy check
        if (currentPrice === lastPriceRef.current && currentPrice !== 0) {
          stagnantCountRef.current++;
          if (stagnantCountRef.current > 20) { // 10 seconds of no change at 2Hz
            if (!dataStagnant) {
              setDataStagnant(true);
              setHistory(h => ({
                ...h,
                logs: [...h.logs.slice(-499), {
                  timestamp: new Date().toLocaleTimeString(),
                  type: 'ERROR',
                  message: 'CRITICAL: Market data feed stagnant. No price changes detected for 10s.'
                }]
              }));
            }
          }
        } else {
          stagnantCountRef.current = 0;
          if (dataStagnant) setDataStagnant(false);
        }

        const priceChange = lastPriceRef.current !== 0 
          ? (currentPrice - lastPriceRef.current) / lastPriceRef.current 
          : 0;
        
        lastPriceRef.current = currentPrice;

        await learner.learnFromLevel2Data(orderBook, priceChange);
        
        const [statePred, multiPred] = await Promise.all([
          learner.predictMarketState(),
          learner.predictMultiHorizon()
        ]);

        const processEnd = performance.now();
        processCountRef.current++;
        
        const elapsed = (now - startTimeRef.current) / 1000;
        setEnginePerformance({
          latency: processEnd - processStart,
          throughput: processCountRef.current / elapsed
        });

        if (statePred) setPrediction({ ...statePred });
        if (multiPred) {
          setMLPrediction({ ...multiPred });
          
          // Update importance history if available
          if (multiPred.featureImportance) {
            const currentImportance = Array.from(multiPred.featureImportance.values());
            const nowLabel = new Date().toLocaleTimeString();
            
            setHistory(prev => ({
              ...prev,
              importanceHistory: [...prev.importanceHistory.slice(-9), currentImportance],
              historyLabels: [...prev.historyLabels.slice(-9), nowLabel]
            }));
          }
        }
        
        const currentRegime = learner.getCurrentRegime();
        if (currentRegime) {
          setRegime(prevRegime => {
            if (prevRegime?.name !== currentRegime.name) {
              setHistory(h => ({
                ...h,
                sampleCount: learner.getMetrics().sampleCount,
                regimeTransitions: [...h.regimeTransitions.slice(-19), [prevRegime?.name || 'unknown', currentRegime.name, 1]]
              }));
            } else {
              setHistory(h => ({ ...h, sampleCount: learner.getMetrics().sampleCount }));
            }
            return { ...currentRegime };
          });
        }

      } catch (error) {
        console.error('ML Processing Error:', error);
      } finally {
        isProcessingRef.current = false;
      }
    };

    processData();
  }, [orderBookContext?.orderBookData, learner]);

  useEffect(() => {
    const handleTrainingStep = async (data: any) => {
      const weights = await learner.getWeightDistribution();
      const timestamp = new Date().toLocaleTimeString();
      
      setHistory(prev => ({
        ...prev,
        learningCurve: [...prev.learningCurve.slice(-99), {
          epoch: data.epoch,
          accuracy: data.accuracy,
          loss: data.loss
        }],
        trainingMetrics: [...prev.trainingMetrics.slice(-99), {
          step: data.epoch,
          accuracy: data.accuracy,
          loss: data.loss,
          gradientNorm: data.gradientNorm,
          weightsDistribution: weights
        }],
        logs: [...prev.logs.slice(-499), {
          timestamp,
          type: 'TRAINING',
          message: `Epoch ${data.epoch} completed. Accuracy: ${(data.accuracy * 100).toFixed(4)}%, Loss: ${data.loss.toFixed(6)}`
        }]
      }));
    };

    const handlePrediction = (data: any) => {
      const timestamp = new Date().toLocaleTimeString();
      setHistory(prev => ({
        ...prev,
        logs: [...prev.logs.slice(-499), {
          timestamp,
          type: 'FEATURE',
          message: `New prediction: ${data.prediction > 0 ? 'LONG' : data.prediction < 0 ? 'SHORT' : 'HOLD'} (Confidence: ${(data.prediction * 100).toFixed(4)}%)`,
          data: data.orderBookState
        }]
      }));
    };

    const handleTrainingStatus = (data: any) => {
      const timestamp = new Date().toLocaleTimeString();
      setHistory(prev => ({
        ...prev,
        logs: [...prev.logs.slice(-499), {
          timestamp,
          type: 'INFO',
          message: data.message
        }]
      }));
    };

    learner.on('training_step', handleTrainingStep);
    learner.on('training_status', handleTrainingStatus);
    learner.on('prediction', handlePrediction);

    const trainingInterval = setInterval(async () => {
      setIsTraining(true);
      trainingStepRef.current += 1;
      await learner.train([], trainingStepRef.current);
      setIsTraining(false);
    }, 5000);

    return () => {
      learner.off('training_step', handleTrainingStep);
      learner.off('training_status', handleTrainingStatus);
      learner.off('prediction', handlePrediction);
      clearInterval(trainingInterval);
    };
  }, [learner]);

  // Memoize provider value to prevent unnecessary consumer re-renders
  const contextValue = useMemo(() => ({
    learner,
    prediction,
    mlPrediction,
    regime,
    isTraining,
    dataStagnant,
    enginePerformance,
    history
  }), [learner, prediction, mlPrediction, regime, isTraining, dataStagnant, enginePerformance, history]);

  return (
    <MLEngineContext.Provider value={contextValue}>
      {children}
    </MLEngineContext.Provider>
  );
};

export const useMLEngine = () => {
  const context = useContext(MLEngineContext);
  if (!context) {
    throw new Error('useMLEngine must be used within an MLEngineProvider');
  }
  return context;
};
