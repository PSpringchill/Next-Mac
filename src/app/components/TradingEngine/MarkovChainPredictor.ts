// src/tradingEngine/MarkovChainPredictor.ts
import { OrderBookMicrostructure, MarketStatePrediction } from '@tradingEngine/types';

class MarkovChainPredictor {
  private transitionMatrix: Map<string, Map<string, number>>;
  private stateHistory: string[];
  private maxOrder: number = 3; // 3rd order Markov chain
  private stateQuantizer: StateQuantizer;
  
  private readonly maxTransitions: number = 10000;
  private transitionCounts: Map<string, number> = new Map();

  constructor() {
    this.transitionMatrix = new Map();
    this.stateHistory = [];
    this.stateQuantizer = new StateQuantizer();
  }

  updateTransition(
    microstructure: OrderBookMicrostructure,
    priceChange: number
  ): void {
    const currentState = this.stateQuantizer.quantize(microstructure);
    const nextState = this.stateQuantizer.quantizePriceChange(priceChange);
    
    for (let order = 1; order <= this.maxOrder; order++) {
      if (this.stateHistory.length >= order) {
        const contextStates = this.stateHistory.slice(-order).join('_');
        const key = `${contextStates}_${currentState}`;
        
        if (!this.transitionMatrix.has(key)) {
          this.transitionMatrix.set(key, new Map());
        }
        
        const transitions = this.transitionMatrix.get(key)!;
        const currentCount = transitions.get(nextState) || 0;
        transitions.set(nextState, currentCount + 1);

        // Update global transition counts for normalization
        const countKey = `${key}_total`;
        this.transitionCounts.set(countKey, (this.transitionCounts.get(countKey) || 0) + 1);
      }
    }
    
    this.stateHistory.push(currentState);
    if (this.stateHistory.length > 500) {
      this.stateHistory.shift();
    }
  }

  predictNextState(
    microstructure: OrderBookMicrostructure
  ): MarketStatePrediction {
    const currentState = this.stateQuantizer.quantize(microstructure);
    const predictions: Map<string, number> = new Map();
    
    // Ensemble predictions from different Markov orders
    const weights = [0.2, 0.3, 0.5]; // Higher weight for higher orders
    
    for (let order = 1; order <= this.maxOrder; order++) {
      if (this.stateHistory.length >= order - 1) {
        const contextStates = [
          ...this.stateHistory.slice(-(order - 1)),
          currentState
        ].join('_');
        
        const transitions = this.transitionMatrix.get(contextStates);
        
        if (transitions) {
          const totalTransitions = Array.from(transitions.values())
            .reduce((sum, count) => sum + count, 0);
          
          transitions.forEach((count, state) => {
            const prob = count / totalTransitions;
            const currentProb = predictions.get(state) || 0;
            predictions.set(state, currentProb + prob * weights[order - 1]);
          });
        }
      }
    }
    
    return this.createPrediction(predictions);
  }

  private createPrediction(
    probabilities: Map<string, number>
  ): MarketStatePrediction {
    // Find most likely states and calculate expected price movement
    const sortedStates = Array.from(probabilities.entries())
      .sort((a, b) => b[1] - a[1]);
    
    let expectedMove = 0;
    let totalProb = 0;
    
    sortedStates.forEach(([state, prob]) => {
      const priceMove = this.stateQuantizer.decodePriceChange(state);
      expectedMove += priceMove * prob;
      totalProb += prob;
    });
    
    return {
      mostLikelyState: sortedStates[0]?.[0] || 'neutral',
      probability: sortedStates[0]?.[1] || 0,
      expectedPriceMove: expectedMove / (totalProb || 1),
      stateDistribution: Object.fromEntries(probabilities),
      confidence: this.calculateConfidence(probabilities)
    };
  }

  private calculateConfidence(probabilities: Map<string, number>): number {
    const probs = Array.from(probabilities.values());
    if (probs.length === 0) return 0.5;
    
    let entropy = 0;
    for (const prob of probs) {
      if (prob > 0) {
        entropy -= prob * Math.log(prob);
      }
    }
    
    const maxEntropy = Math.log(probs.length);
    return 1 - (entropy / maxEntropy);
  }
}

class StateQuantizer {
  private readonly imbalanceBins = [-1, -0.5, -0.2, 0, 0.2, 0.5, 1];
  private readonly volumeBins = [0, 0.25, 0.5, 0.75, 1];
  private readonly spreadBins = [0, 0.001, 0.002, 0.005, 0.01];
  
  quantize(microstructure: OrderBookMicrostructure): string {
    // Quantize microstructure into discrete state
    const imbalanceState = this.discretize(
      microstructure.orderImbalance[0],
      this.imbalanceBins
    );
    
    const volumeState = this.discretize(
      microstructure.volumeProfile[0],
      this.volumeBins
    );
    
    const spreadState = this.discretize(
      microstructure.bidAskSpread,
      this.spreadBins
    );
    
    const toxicityState = microstructure.orderFlowToxicity > 0.5 ? 'T' : 'N';
    
    const impactState = this.discretize(
      microstructure.priceImpact,
      [0, 0.001, 0.005, 0.01]
    );
    
    return `${imbalanceState}_${volumeState}_${spreadState}_${toxicityState}_${impactState}`;
  }
  
  quantizePriceChange(priceChange: number): string {
    // Tighter bins for 500ms updates
    const bins = [-0.001, -0.0005, -0.0001, 0, 0.0001, 0.0005, 0.001];
    const state = this.discretize(priceChange, bins);
    return `P${state}`;
  }
  
  decodePriceChange(state: string): number {
    const priceStates: Record<string, number> = {
      'P0': -0.0015, 'P1': -0.00075, 'P2': -0.00025, 
      'P3': 0, 'P4': 0.00025, 'P5': 0.00075, 'P6': 0.0015
    };
    return priceStates[state] || 0;
  }
  
  private discretize(value: number, bins: number[]): number {
    for (let i = 0; i < bins.length - 1; i++) {
      if (value <= bins[i + 1]) return i;
    }
    return bins.length - 1;
  }
}

export default MarkovChainPredictor;