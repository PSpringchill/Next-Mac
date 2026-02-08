import { describe, it, expect, beforeEach } from 'vitest';
import MLEnsembleTrainer, {
  DecisionTree,
  RandomForestClassifier,
  ExtraTreesClassifier,
  AdaBoostClassifier,
  GradientBoostingClassifier,
  SVMClassifier,
  kFoldSplit,
  computeMetrics,
  gini,
  majorityVote,
} from '../app/components/TradingEngine/MLEnsembleTrainer';

// ─── Test Helpers ────────────────────────────────────────────────────────────

function generateLinearData(n: number): { X: number[][]; y: number[] } {
  const X: number[][] = [];
  const y: number[] = [];
  for (let i = 0; i < n; i++) {
    const x1 = Math.random() * 10 - 5;
    const x2 = Math.random() * 10 - 5;
    X.push([x1, x2]);
    y.push(x1 + x2 > 0 ? 1 : 0);
  }
  return { X, y };
}

function generateXORData(n: number): { X: number[][]; y: number[] } {
  const X: number[][] = [];
  const y: number[] = [];
  for (let i = 0; i < n; i++) {
    const x1 = Math.random() * 2 - 1;
    const x2 = Math.random() * 2 - 1;
    X.push([x1, x2]);
    y.push((x1 > 0) !== (x2 > 0) ? 1 : 0);
  }
  return { X, y };
}

// ─── Utility Tests ───────────────────────────────────────────────────────────

describe('Utility Functions', () => {
  describe('gini()', () => {
    it('returns 0 for pure labels', () => {
      expect(gini([1, 1, 1])).toBe(0);
      expect(gini([0, 0, 0])).toBe(0);
    });

    it('returns 0.5 for perfectly mixed binary labels', () => {
      expect(gini([0, 1])).toBeCloseTo(0.5, 4);
      expect(gini([0, 0, 1, 1])).toBeCloseTo(0.5, 4);
    });

    it('returns 0 for empty array', () => {
      expect(gini([])).toBe(0);
    });
  });

  describe('majorityVote()', () => {
    it('returns the most common label', () => {
      expect(majorityVote([1, 1, 0])).toBe(1);
      expect(majorityVote([0, 0, 1])).toBe(0);
    });

    it('works with single element', () => {
      expect(majorityVote([1])).toBe(1);
    });
  });

  describe('kFoldSplit()', () => {
    it('creates correct number of folds', () => {
      const folds = kFoldSplit(100, 5);
      expect(folds.length).toBe(5);
    });

    it('each fold has non-overlapping train and test', () => {
      const folds = kFoldSplit(100, 5);
      for (const { train, test } of folds) {
        const trainSet = new Set(train);
        for (const t of test) {
          expect(trainSet.has(t)).toBe(false);
        }
      }
    });

    it('all indices are covered across folds', () => {
      const folds = kFoldSplit(100, 5);
      const allTest = new Set<number>();
      for (const { test } of folds) {
        for (const t of test) allTest.add(t);
      }
      expect(allTest.size).toBe(100);
    });

    it('test sets are approximately equal size', () => {
      const folds = kFoldSplit(100, 5);
      for (const { test } of folds) {
        expect(test.length).toBeGreaterThanOrEqual(19);
        expect(test.length).toBeLessThanOrEqual(21);
      }
    });
  });

  describe('computeMetrics()', () => {
    it('returns perfect metrics for identical arrays', () => {
      const y = [1, 0, 1, 0, 1];
      const metrics = computeMetrics(y, y);
      expect(metrics.accuracy).toBe(1);
      expect(metrics.precision).toBe(1);
      expect(metrics.recall).toBe(1);
      expect(metrics.f1).toBe(1);
    });

    it('returns 0 accuracy for completely wrong predictions', () => {
      const yTrue = [1, 1, 1, 1];
      const yPred = [0, 0, 0, 0];
      const metrics = computeMetrics(yTrue, yPred);
      expect(metrics.accuracy).toBe(0);
      expect(metrics.recall).toBe(0);
    });

    it('handles all-positive predictions', () => {
      const yTrue = [1, 0, 1, 0];
      const yPred = [1, 1, 1, 1];
      const metrics = computeMetrics(yTrue, yPred);
      expect(metrics.recall).toBe(1);
      expect(metrics.precision).toBe(0.5);
    });
  });
});

// ─── Decision Tree Tests ─────────────────────────────────────────────────────

describe('DecisionTree', () => {
  it('fits and predicts on linearly separable data', () => {
    const { X, y } = generateLinearData(200);
    const tree = new DecisionTree(6, 5, false);
    tree.fit(X, y);
    const preds = tree.predict(X);
    const { accuracy } = computeMetrics(y, preds);
    expect(accuracy).toBeGreaterThan(0.7);
  });

  it('handles single sample', () => {
    const tree = new DecisionTree(3, 1, false);
    tree.fit([[1, 2]], [1]);
    const pred = tree.predict([[1, 2]]);
    expect(pred[0]).toBe(1);
  });

  it('handles pure class data', () => {
    const X = [[1], [2], [3]];
    const y = [1, 1, 1];
    const tree = new DecisionTree(3, 1, false);
    tree.fit(X, y);
    expect(tree.predict([[4]])[0]).toBe(1);
  });
});

// ─── Classifier Tests ────────────────────────────────────────────────────────

describe('RandomForestClassifier', () => {
  it('achieves reasonable accuracy on linear data', () => {
    const { X, y } = generateLinearData(300);
    const clf = new RandomForestClassifier({ nEstimators: 20, maxDepth: 5 });
    clf.fit(X, y);
    const preds = clf.predict(X);
    const { accuracy } = computeMetrics(y, preds);
    expect(accuracy).toBeGreaterThan(0.7);
  });

  it('produces binary predictions', () => {
    const { X, y } = generateLinearData(100);
    const clf = new RandomForestClassifier({ nEstimators: 10 });
    clf.fit(X, y);
    const preds = clf.predict(X);
    expect(preds.every(p => p === 0 || p === 1)).toBe(true);
  });
});

describe('ExtraTreesClassifier', () => {
  it('achieves reasonable accuracy on linear data', () => {
    const { X, y } = generateLinearData(300);
    const clf = new ExtraTreesClassifier({ nEstimators: 20, maxDepth: 5 });
    clf.fit(X, y);
    const preds = clf.predict(X);
    const { accuracy } = computeMetrics(y, preds);
    expect(accuracy).toBeGreaterThan(0.65);
  });
});

describe('AdaBoostClassifier', () => {
  it('achieves reasonable accuracy on linear data', () => {
    const { X, y } = generateLinearData(300);
    const clf = new AdaBoostClassifier({ nEstimators: 30 });
    clf.fit(X, y);
    const preds = clf.predict(X);
    const { accuracy } = computeMetrics(y, preds);
    expect(accuracy).toBeGreaterThan(0.6);
  });

  it('produces binary predictions', () => {
    const { X, y } = generateLinearData(100);
    const clf = new AdaBoostClassifier({ nEstimators: 10 });
    clf.fit(X, y);
    const preds = clf.predict(X);
    expect(preds.every(p => p === 0 || p === 1)).toBe(true);
  });
});

describe('GradientBoostingClassifier', () => {
  it('achieves reasonable accuracy on linear data', () => {
    const { X, y } = generateLinearData(300);
    const clf = new GradientBoostingClassifier({ nEstimators: 30, learningRate: 0.1 });
    clf.fit(X, y);
    const preds = clf.predict(X);
    const { accuracy } = computeMetrics(y, preds);
    expect(accuracy).toBeGreaterThan(0.6);
  });
});

describe('SVMClassifier', () => {
  it('achieves reasonable accuracy on linearly separable data', () => {
    const { X, y } = generateLinearData(300);
    const clf = new SVMClassifier();
    clf.fit(X, y);
    const preds = clf.predict(X);
    const { accuracy } = computeMetrics(y, preds);
    expect(accuracy).toBeGreaterThan(0.7);
  });

  it('handles empty data gracefully', () => {
    const clf = new SVMClassifier();
    clf.fit([], []);
    const preds = clf.predict([[1, 2]]);
    expect(preds.length).toBe(1);
  });
});

// ─── MLEnsembleTrainer Tests ─────────────────────────────────────────────────

describe('MLEnsembleTrainer', () => {
  it('trains and selects best model', () => {
    const { X, y } = generateLinearData(200);
    const trainer = new MLEnsembleTrainer({ nEstimators: 10, maxDepth: 4, nFolds: 3 });
    const result = trainer.trainAndSelect({ X, y });

    expect(result.bestModel).toBeTruthy();
    expect(result.bestScore).toBeGreaterThan(0);
    expect(result.results.length).toBe(5);
  });

  it('each classifier has CV scores', () => {
    const { X, y } = generateLinearData(200);
    const trainer = new MLEnsembleTrainer({ nEstimators: 10, nFolds: 3 });
    const result = trainer.trainAndSelect({ X, y });

    for (const r of result.results) {
      expect(r.cvScores.length).toBe(3);
      expect(r.cvScores.every(s => s >= 0 && s <= 1)).toBe(true);
    }
  });

  it('predictBest returns predictions after training', () => {
    const { X, y } = generateLinearData(200);
    const trainer = new MLEnsembleTrainer({ nEstimators: 10, nFolds: 3 });
    trainer.trainAndSelect({ X, y });

    const preds = trainer.predictBest(X.slice(0, 10));
    expect(preds.length).toBe(10);
    expect(preds.every(p => p === 0 || p === 1)).toBe(true);
  });

  it('throws if predicting without training', () => {
    const trainer = new MLEnsembleTrainer();
    expect(() => trainer.predictBest([[1, 2]])).toThrow();
  });

  it('throws with insufficient data for CV', () => {
    const trainer = new MLEnsembleTrainer({ nFolds: 5 });
    expect(() => trainer.trainAndSelect({ X: [[1]], y: [0] })).toThrow();
  });

  it('reports train time for each classifier', () => {
    const { X, y } = generateLinearData(100);
    const trainer = new MLEnsembleTrainer({ nEstimators: 5, nFolds: 3 });
    const result = trainer.trainAndSelect({ X, y });

    for (const r of result.results) {
      expect(r.trainTimeMs).toBeGreaterThanOrEqual(0);
    }
  });

  it('getResults returns null before training', () => {
    const trainer = new MLEnsembleTrainer();
    expect(trainer.getResults()).toBeNull();
  });

  it('getResults returns results after training', () => {
    const { X, y } = generateLinearData(100);
    const trainer = new MLEnsembleTrainer({ nEstimators: 5, nFolds: 3 });
    trainer.trainAndSelect({ X, y });
    expect(trainer.getResults()).not.toBeNull();
  });
});
