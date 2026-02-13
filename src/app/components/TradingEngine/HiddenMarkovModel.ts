// src/tradingEngine/HiddenMarkovModel.ts
import { MarketRegime, OrderBookMicrostructure } from '@tradingEngine/types';

interface GaussianMixture {
  means: number[];
  stds: number[];
  weights: number[];
  likelihood(observations: number[]): number;
}

// Soft regime output: probability distribution over all states
export interface SoftRegimeOutput {
  regime: MarketRegime & { isTransition: boolean };
  probabilities: number[];       // softmax posterior over states
  stateNames: string[];          // ['trending_up', 'trending_down', 'ranging', 'volatile', 'breakout']
  entropy: number;               // Shannon entropy of distribution (0 = certain, high = uncertain)
  dominantProb: number;          // probability of the winning state
}

class HiddenMarkovModel {
  private states: MarketRegime[] = [
    { name: 'trending_up', volatility: 0.02, momentum: 1, isTransition: false },
    { name: 'trending_down', volatility: 0.02, momentum: -1, isTransition: false },
    { name: 'ranging', volatility: 0.01, momentum: 0, isTransition: false },
    { name: 'volatile', volatility: 0.05, momentum: 0, isTransition: false },
    { name: 'breakout', volatility: 0.03, momentum: 0.5, isTransition: false }
  ];
  
  private transitionProbs!: number[][];
  private emissionProbs!: GaussianMixture[];
  private currentState: number = 2; // Start with ranging
  
  private transitionCounts: number[][];
  private observationBuffer: number[][] = [];
  private readonly maxBufferSize: number = 100;
  private rollingMomentum: number = 0;
  private rollingVolatility: number = 0;

  constructor() {
    this.transitionCounts = this.states.map(() => new Array(this.states.length).fill(1)); // Laplace smoothing
    this.initializeTransitionMatrix();
    this.initializeEmissionModels();
  }
  
  private initializeTransitionMatrix() {
    const totalCounts = this.transitionCounts.map(row => row.reduce((a, b) => a + b, 0));
    this.transitionProbs = this.transitionCounts.map((row, i) => 
      row.map(count => count / totalCounts[i])
    );
  }

  private updateTransitionMatrix(fromState: number, toState: number) {
    this.transitionCounts[fromState][toState]++;
    this.initializeTransitionMatrix();
  }
  
  private initializeEmissionModels() {
    // Initialize Gaussian models for each state based on multiple features
    this.emissionProbs = this.states.map((state) => ({
      means: [state.momentum, state.volatility, 0.5], // momentum, volatility, expected toxicity
      stds: [0.1, 0.05, 0.2],
      weights: [1],
      likelihood: (observations: number[]) => {
        // Multi-variate Gaussian likelihood (assuming independence for simplicity)
        let totalLikelihood = 1;
        const means = [state.momentum, state.volatility, state.name === 'volatile' ? 0.8 : 0.2];
        const stds = [0.1, 0.05, 0.2];

        for (let i = 0; i < observations.length; i++) {
          const obs = observations[i] || 0;
          const mean = means[i] || 0;
          const std = stds[i] || 0.1;
          const exponent = -0.5 * Math.pow((obs - mean) / std, 2);
          totalLikelihood *= Math.exp(exponent) / (std * Math.sqrt(2 * Math.PI));
        }
        return totalLikelihood;
      }
    }));
  }
  
  // Last soft output for external consumers
  private lastSoftOutput: SoftRegimeOutput | null = null;

  async detectRegime(
    microstructure: OrderBookMicrostructure,
    priceChange: number
  ): Promise<MarketRegime & { isTransition: boolean }> {
    // Calculate observation likelihoods for each state
    const observations = this.extractObservations(microstructure);
    
    // Update rolling metrics for more dynamic reporting
    this.observationBuffer.push([...observations, priceChange]);
    if (this.observationBuffer.length > this.maxBufferSize) {
      this.observationBuffer.shift();
    }

    if (this.observationBuffer.length > 5) {
      // Calculate true momentum from price changes
      const recentPriceChanges = this.observationBuffer.map(obs => obs[3] || 0);
      const priceMomentum = (recentPriceChanges.reduce((a, b) => a + b, 0) / recentPriceChanges.length) * 1000;
      
      // Calculate micro-momentum from order book imbalance (predictive of next tick)
      // obs[0] is priceImpact, obs[1] is bidAskSpread, obs[2] is orderFlowToxicity
      // We'll also use microstructure.orderImbalance[0] from detectRegime call
      const imbalanceMomentum = microstructure.orderImbalance[0] * 0.5;

      // Blend them: price-based is reactive, imbalance-based is proactive
      this.rollingMomentum = priceMomentum * 0.4 + imbalanceMomentum * 0.6;

      // bidAskSpread as proxy for volatility
      this.rollingVolatility = this.observationBuffer.reduce((sum, obs) => sum + obs[1], 0) / this.observationBuffer.length;
    }

    const likelihoods = this.states.map((state, i) => 
      this.emissionProbs[i].likelihood(observations)
    );
    
    // Compute soft regime probabilities (posterior via softmax of log-likelihoods)
    const probabilities = this.computeSoftProbabilities(likelihoods);

    // Viterbi algorithm for most likely state sequence
    const newState = this.viterbiStep(likelihoods);
    const isTransition = newState !== this.currentState;
    
    if (isTransition) {
      this.updateTransitionMatrix(this.currentState, newState);
      console.log(`Regime change detected: ${this.states[this.currentState].name} -> ${this.states[newState].name}`);
    }
    
    this.currentState = newState;
    
    const stateInfo = this.states[newState];
    
    const regime = {
      ...stateInfo,
      // Blend state values with real-time rolling metrics
      // Use priceChange-based momentum for ranging state to show micro-trends
      momentum: stateInfo.name === 'ranging' ? this.rollingMomentum : (stateInfo.momentum * 0.7 + this.rollingMomentum * 0.3),
      volatility: stateInfo.volatility * 0.5 + this.rollingVolatility * 0.5,
      isTransition
    };

    // Cache soft output
    this.lastSoftOutput = {
      regime,
      probabilities,
      stateNames: this.states.map(s => s.name),
      entropy: this.shannonEntropy(probabilities),
      dominantProb: probabilities[newState],
    };

    return regime;
  }

  // Soft regime probabilities: posterior distribution via softmax
  private computeSoftProbabilities(likelihoods: number[]): number[] {
    // Multiply by transition probs from current state for proper Bayesian posterior
    const logProbs = likelihoods.map((l, j) => {
      const prior = this.transitionProbs[this.currentState][j];
      const safeLikelihood = Math.max(l, 1e-300);
      return Math.log(safeLikelihood) + Math.log(Math.max(prior, 1e-10));
    });

    // Softmax for numerical stability
    const maxLog = Math.max(...logProbs);
    const exps = logProbs.map(lp => Math.exp(lp - maxLog));
    const sumExp = exps.reduce((a, b) => a + b, 0);
    return exps.map(e => e / sumExp);
  }

  // Shannon entropy: H = -sum(p * log(p))
  private shannonEntropy(probs: number[]): number {
    let h = 0;
    for (const p of probs) {
      if (p > 1e-10) h -= p * Math.log(p);
    }
    return h;
  }

  // Public accessor for soft regime output
  getSoftRegime(): SoftRegimeOutput | null {
    return this.lastSoftOutput;
  }
  
  private viterbiStep(likelihoods: number[]): number {
    const probs = new Float32Array(this.states.length);
    
    for (let j = 0; j < this.states.length; j++) {
      let maxProb = 0;
      for (let i = 0; i < this.states.length; i++) {
        const prob = this.transitionProbs[this.currentState][j] * likelihoods[j];
        if (prob > maxProb) maxProb = prob;
      }
      probs[j] = maxProb;
    }
    
    // Find state with maximum probability
    let maxIdx = 0;
    let maxVal = probs[0];
    for (let i = 1; i < probs.length; i++) {
      if (probs[i] > maxVal) {
        maxVal = probs[i];
        maxIdx = i;
      }
    }
    
    return maxIdx;
  }

  private extractObservations(microstructure: OrderBookMicrostructure): number[] {
    return [
      microstructure.priceImpact, // Proxies momentum/impact
      microstructure.bidAskSpread, // Proxies volatility/liquidity
      microstructure.orderFlowToxicity // Proxies toxicity
    ];
  }
}

export default HiddenMarkovModel;