import * as tf from '@tensorflow/tfjs';
import * as Comlink from 'comlink';

class MLWorker {
  private model: tf.LayersModel | null = null;

  async loadModel(modelUrl: string): Promise<void> {
    this.model = await tf.loadLayersModel(modelUrl);
  }

  async predict(features: number[][]): Promise<number[]> {
    if (!this.model) throw new Error('Model not loaded');
    
    const input = tf.tensor2d(features);
    const output = this.model.predict(input) as tf.Tensor;
    const result = await output.array();
    
    input.dispose();
    output.dispose();
    
    return result as number[];
  }

  async train(data: any, epochs: number = 10): Promise<void> {
    // Training logic here
  }
}

Comlink.expose(new MLWorker());
