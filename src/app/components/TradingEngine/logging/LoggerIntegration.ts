// src/tradingEngine/logging/LoggerIntegration.ts
import { MLReinforcementLogger } from './MLReinforcementLogger';
import AdaptiveMarketLearner from '../AdaptiveMarketLearner';

export class MLTrainingWithLogging {
  private logger: MLReinforcementLogger;
  private learner: AdaptiveMarketLearner;
  
  constructor() {
    this.logger = new MLReinforcementLogger();
    this.learner = new AdaptiveMarketLearner();
    
    // Set up event listeners
    this.setupLogging();
  }
  
  private setupLogging(): void {
    // Log every training step
    this.learner.on('training_step', (data: { epoch: number; loss: number; accuracy: number; learningRate: number; gradientNorm: number; rewards: any }) => {
      this.logger.logTrainingEpoch(
        data.epoch,
        data.loss,
        data.accuracy,
        data.learningRate,
        data.gradientNorm,
        data.rewards
      );
    });
    
    // Log feature importance after each prediction
    this.learner.on('prediction', (data: { features: any; actualPriceMove: any; prediction: any; marketRegime: any; orderBookState: any }) => {
      this.logger.logFeatureImportance(
        data.features,
        data.actualPriceMove,
        data.prediction,
        data.marketRegime,
        data.orderBookState
      );
    });
    
    // Log performance updates
    this.learner.on('performance_update', (metrics: any) => {
      this.logger.logPerformance(metrics);
    });
    
    // Log errors
    this.learner.on('error', (error: Error) => {
      this.logger.log(`ERROR: ${error.message}`, error, 'ERROR');
    });
  }
  
  public async trainWithLogging(
    trainingData: any[],
    epochs: number
  ): Promise<void> {
    this.logger.log('Starting training session', {
      dataSize: trainingData.length,
      epochs,
      timestamp: new Date().toISOString()
    });
    
    for (let epoch = 0; epoch < epochs; epoch++) {
      try {
        const result = await this.learner.train(trainingData, epoch);
        
        // Log the results
        this.logger.logTrainingEpoch(
          epoch,
          result.loss,
          result.accuracy,
          result.learningRate,
          result.gradientNorm,
          result.rewards
        );
        
        // Log feature importance periodically
        if (epoch % 10 === 0) {
          const featureImportance = await this.learner.getFeatureImportance();
          this.logger.log(
            `Feature importance at epoch ${epoch}`,
            Object.fromEntries(featureImportance),
            'FEATURE_ANALYSIS'
          );
        }
        
      } catch (error) {
        this.logger.log(`Training error at epoch ${epoch}`, error, 'ERROR');
      }
    }
    
    // Generate summary at the end
    const summary = this.logger.generateSummaryReport();
    console.log('Training complete. Summary report generated:', summary);
  }
}