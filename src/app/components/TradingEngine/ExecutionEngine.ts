import { OrderBookData } from '@tradingEngine/types';
import Level2FeatureExtractor from './Level2FeatureExtractor';
import RiskManager, { MarketContext, TradeRequest } from './RiskManager';

export type ExecutionMode = 'passive' | 'adaptive' | 'aggressive';

export interface ExecutionRequest {
  direction: -1 | 0 | 1;
  size: number;
  urgency: number;
  symbol?: string;
  timestamp?: number;
}

export interface ExecutionReport {
  status: 'filled' | 'rejected';
  mode: ExecutionMode;
  requestedSize: number;
  filledSize: number;
  fillPrice: number;
  midPriceAtOrder: number;
  slippage: number;
  estimatedImpact: number;
  childOrders: number;
  reasons?: string[];
}

class ExecutionEngine {
  private featureExtractor: Level2FeatureExtractor;
  private riskManager?: RiskManager;

  constructor(riskManager?: RiskManager) {
    this.featureExtractor = new Level2FeatureExtractor();
    this.riskManager = riskManager;
  }

  executeOrder(request: ExecutionRequest, orderBook: OrderBookData, context: MarketContext = {}): ExecutionReport {
    const timestamp = request.timestamp ?? Date.now();
    const mode = this.getExecutionMode(request.urgency);
    const bestBid = parseFloat(orderBook.bids[0]?.[0] ?? '0');
    const bestAsk = parseFloat(orderBook.asks[0]?.[0] ?? '0');
    const midPrice = (bestBid + bestAsk) / 2;

    if (!midPrice || request.direction === 0 || request.size <= 0) {
      return {
        status: 'rejected',
        mode,
        requestedSize: request.size,
        filledSize: 0,
        fillPrice: midPrice,
        midPriceAtOrder: midPrice,
        slippage: 0,
        estimatedImpact: 0,
        childOrders: 0,
        reasons: ['Invalid order request or empty order book']
      };
    }

    if (this.riskManager) {
      const riskCheck = this.riskManager.evaluateTrade(
        this.toTradeRequest(request, midPrice, timestamp),
        context
      );
      if (!riskCheck.allowed) {
        return {
          status: 'rejected',
          mode,
          requestedSize: request.size,
          filledSize: 0,
          fillPrice: midPrice,
          midPriceAtOrder: midPrice,
          slippage: 0,
          estimatedImpact: 0,
          childOrders: 0,
          reasons: riskCheck.reasons
        };
      }
      request = { ...request, size: riskCheck.adjustedSize };
    }

    const microstructure = this.featureExtractor.extractMicrostructure(orderBook);
    const spread = bestAsk - bestBid;
    const kyleLambda = microstructure.priceImpact;
    const estimatedImpact = this.estimateSlippage(spread, kyleLambda, request.size);

    const { fillPrice, childOrders } = this.routeExecution({
      mode,
      direction: request.direction,
      size: request.size,
      bestBid,
      bestAsk,
      estimatedImpact
    });

    return {
      status: 'filled',
      mode,
      requestedSize: request.size,
      filledSize: request.size,
      fillPrice,
      midPriceAtOrder: midPrice,
      slippage: Math.abs(fillPrice - midPrice),
      estimatedImpact,
      childOrders
    };
  }

  private getExecutionMode(urgency: number): ExecutionMode {
    if (urgency <= 0.3) return 'passive';
    if (urgency <= 0.7) return 'adaptive';
    return 'aggressive';
  }

  private estimateSlippage(spread: number, kyleLambda: number, size: number): number {
    const halfSpread = Math.max(0, spread) / 2;
    return halfSpread + Math.abs(kyleLambda) * size;
  }

  private routeExecution(params: {
    mode: ExecutionMode;
    direction: -1 | 0 | 1;
    size: number;
    bestBid: number;
    bestAsk: number;
    estimatedImpact: number;
  }): { fillPrice: number; childOrders: number } {
    const { mode, direction, size, bestBid, bestAsk, estimatedImpact } = params;
    const basePrice = direction > 0 ? bestAsk : bestBid;

    if (mode === 'passive') {
      const fillPrice = basePrice + direction * estimatedImpact * 0.2;
      return { fillPrice, childOrders: 1 };
    }

    if (mode === 'adaptive') {
      const childOrders = Math.min(5, Math.max(3, Math.ceil(size / 0.1)));
      const fillPrice = basePrice + direction * estimatedImpact * 0.6;
      return { fillPrice, childOrders };
    }

    const fillPrice = basePrice + direction * estimatedImpact;
    return { fillPrice, childOrders: 1 };
  }

  private toTradeRequest(request: ExecutionRequest, price: number, timestamp: number): TradeRequest {
    return {
      direction: request.direction,
      size: request.size,
      price,
      timestamp
    };
  }
}

export default ExecutionEngine;
