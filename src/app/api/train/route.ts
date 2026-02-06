// src/app/api/train/route.ts
import { MLTrainingWithLogging } from "@/app/components/TradingEngine/logging/LoggerIntegration";

export async function POST(request: Request) {
  const trainer = new MLTrainingWithLogging();
  
  try {
    const { trainingData = [], epochs = 10 } = await request.json().catch(() => ({}));
    
    // Start training with logging
    await trainer.trainWithLogging(trainingData, epochs);
    
    return Response.json({
      success: true,
      message: 'Training completed with logging'
    });
  } catch (error: any) {
    return Response.json({
      success: false,
      error: error.message || 'An unknown error occurred'
    }, { status: 500 });
  }
}