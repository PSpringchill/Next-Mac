import { describe, it, expect } from 'vitest';
import PrioritizedReplayBuffer from '../tradingEngine/utils/PrioritizedReplayBuffer';

const createExperience = (reward: number) => ({
  state: [0, 1],
  action: 1,
  reward,
  nextState: [1, 0],
  done: false
});

describe('PrioritizedReplayBuffer', () => {
  it('samples entries and returns weights', () => {
    const buffer = new PrioritizedReplayBuffer(10);
    buffer.add(createExperience(1), 1);
    buffer.add(createExperience(2), 2);

    const result = buffer.sample(2);
    expect(result.samples.length).toBe(2);
    expect(result.indices.length).toBe(2);
    expect(result.weights.length).toBe(2);
  });

  it('updates priorities safely', () => {
    const buffer = new PrioritizedReplayBuffer(10);
    buffer.add(createExperience(1), 1);
    buffer.add(createExperience(2), 2);

    const { indices } = buffer.sample(2);
    buffer.updatePriorities(indices, [5, 6]);

    expect(buffer.size()).toBe(2);
  });
});
