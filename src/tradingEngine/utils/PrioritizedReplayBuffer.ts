import { Experience } from '@tradingEngine/types';

interface SampleResult {
  samples: Experience[];
  indices: number[];
  weights: number[];
}

class PrioritizedReplayBuffer {
  private buffer: Experience[] = [];
  private priorities: number[] = [];
  private maxSize: number;
  private alpha: number;
  private beta: number;
  private epsilon: number;

  constructor(maxSize: number, alpha: number = 0.6, beta: number = 0.4, epsilon: number = 1e-4) {
    this.maxSize = maxSize;
    this.alpha = alpha;
    this.beta = beta;
    this.epsilon = epsilon;
  }

  add(experience: Experience, priority: number = 1): void {
    const adjusted = Math.abs(priority) + this.epsilon;
    if (this.buffer.length >= this.maxSize) {
      this.buffer.shift();
      this.priorities.shift();
    }
    this.buffer.push(experience);
    this.priorities.push(adjusted);
  }

  sample(batchSize: number): SampleResult {
    const size = Math.min(batchSize, this.buffer.length);
    const probabilities = this.getProbabilities();
    const indices: number[] = [];
    const samples: Experience[] = [];

    for (let i = 0; i < size; i += 1) {
      const index = this.weightedSample(probabilities);
      indices.push(index);
      samples.push(this.buffer[index]);
    }

    const weights = indices.map(index => this.computeWeight(probabilities[index]));

    return { samples, indices, weights };
  }

  updatePriorities(indices: number[], priorities: number[]): void {
    indices.forEach((index, idx) => {
      if (this.priorities[index] !== undefined) {
        this.priorities[index] = Math.abs(priorities[idx]) + this.epsilon;
      }
    });
  }

  size(): number {
    return this.buffer.length;
  }

  clear(): void {
    this.buffer = [];
    this.priorities = [];
  }

  private getProbabilities(): number[] {
    const scaled = this.priorities.map(priority => Math.pow(priority, this.alpha));
    const sum = scaled.reduce((acc, value) => acc + value, 0) || 1;
    return scaled.map(value => value / sum);
  }

  private weightedSample(probabilities: number[]): number {
    const rand = Math.random();
    let cumulative = 0;
    for (let i = 0; i < probabilities.length; i += 1) {
      cumulative += probabilities[i];
      if (rand <= cumulative) return i;
    }
    return probabilities.length - 1;
  }

  private computeWeight(probability: number): number {
    const weight = Math.pow(this.buffer.length * probability, -this.beta);
    return Number.isFinite(weight) ? weight : 0;
  }
}

export default PrioritizedReplayBuffer;
export type { SampleResult };
