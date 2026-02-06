import * as tf from '@tensorflow/tfjs';

interface DuelingConfig {
  stateSize: number;
  actionSize: number;
  regimeHeads: number;
  learningRate?: number;
}

interface TrainBatch {
  states: number[][];
  targets: number[][];
  regimeIndex: number;
}

class DuelingDQN {
  private config: DuelingConfig;
  private sharedModel: tf.LayersModel;
  private headModels: tf.LayersModel[] = [];
  private pfx: string;

  constructor(config: DuelingConfig) {
    this.config = config;
    this.pfx = `dqn${Math.random().toString(36).slice(2, 8)}_`;
    this.sharedModel = this.buildSharedModel();
    this.headModels = this.buildHeads();
  }

  predict(state: number[], regimeIndex: number): tf.Tensor {
    const input = tf.tensor2d([state]);
    const base = this.sharedModel.predict(input) as tf.Tensor;
    const head = this.headModels[this.clampRegime(regimeIndex)];
    const qValues = head.predict(base) as tf.Tensor;
    input.dispose();
    base.dispose();
    return qValues;
  }

  async train(batch: TrainBatch): Promise<number> {
    const head = this.headModels[this.clampRegime(batch.regimeIndex)];
    const states = tf.tensor2d(batch.states);
    const targets = tf.tensor2d(batch.targets);

    const base = this.sharedModel.predict(states) as tf.Tensor;
    const history = await head.fit(base, targets, { epochs: 1, verbose: 0 });

    states.dispose();
    targets.dispose();
    base.dispose();

    const lossHistory = history.history.loss as unknown;
    const isTensor = (value: unknown): value is tf.Tensor => {
      return !!value && typeof (value as tf.Tensor).dataSync === 'function' && typeof (value as tf.Tensor).dispose === 'function';
    };
    if (Array.isArray(lossHistory)) {
      const first = lossHistory[0];
      if (typeof first === 'number') return first;
      if (isTensor(first)) {
        const value = first.dataSync()[0] ?? 0;
        first.dispose();
        return value;
      }
      return 0;
    }
    if (typeof lossHistory === 'number') return lossHistory;
    if (isTensor(lossHistory)) {
      const value = lossHistory.dataSync()[0] ?? 0;
      lossHistory.dispose();
      return value;
    }
    return 0;
  }

  private buildSharedModel(): tf.LayersModel {
    const input = tf.input({ shape: [this.config.stateSize], name: `${this.pfx}shared_input` });
    const dense1 = tf.layers.dense({ name: `${this.pfx}shared_d1`, units: 256, activation: 'relu' }).apply(input);
    const dense2 = tf.layers.dense({ name: `${this.pfx}shared_d2`, units: 128, activation: 'relu' }).apply(dense1 as tf.SymbolicTensor);

    return tf.model({ inputs: input, outputs: dense2 as tf.SymbolicTensor });
  }

  private buildHeads(): tf.LayersModel[] {
    return Array.from({ length: this.config.regimeHeads }, (_, index) => {
      const hp = `${this.pfx}h${index}_`;
      const input = tf.input({ shape: [128], name: `${hp}input` });
      const value = tf.layers.dense({ name: `${hp}val`, units: 64, activation: 'relu' }).apply(input);
      const advantage = tf.layers.dense({ name: `${hp}adv`, units: 64, activation: 'relu' }).apply(input);

      const valueOut = tf.layers.dense({ name: `${hp}val_out`, units: 1 }).apply(value as tf.SymbolicTensor);
      const advantageOut = tf.layers.dense({ name: `${hp}adv_out`, units: this.config.actionSize }).apply(advantage as tf.SymbolicTensor);

      const qValues = tf.layers.add({ name: `${hp}q` }).apply([valueOut as tf.SymbolicTensor, advantageOut as tf.SymbolicTensor]);

      const model = tf.model({ inputs: input, outputs: qValues as tf.SymbolicTensor });
      model.compile({
        optimizer: tf.train.adam(this.config.learningRate ?? 0.0005),
        loss: 'meanSquaredError'
      });
      return model;
    });
  }

  private clampRegime(regimeIndex: number): number {
    if (regimeIndex < 0) return 0;
    if (regimeIndex >= this.headModels.length) return this.headModels.length - 1;
    return regimeIndex;
  }
}

export default DuelingDQN;
export type { DuelingConfig, TrainBatch };
