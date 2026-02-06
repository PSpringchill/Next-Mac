import { describe, it, expect } from 'vitest';
import DuelingDQN from '../app/components/TradingEngine/DuelingDQN';

const dqn = new DuelingDQN({ stateSize: 78, actionSize: 15, regimeHeads: 5 });

describe('DuelingDQN', () => {
  it('predicts Q-values with expected shape', async () => {
    const qValues = dqn.predict(new Array(78).fill(0), 0);
    const data = await qValues.data();
    expect(data.length).toBe(15);
    qValues.dispose();
  });

  it('trains on a batch', async () => {
    const loss = await dqn.train({
      states: [new Array(78).fill(0)],
      targets: [new Array(15).fill(0)],
      regimeIndex: 0
    });
    expect(Number.isFinite(loss)).toBe(true);
  });
});
