// src/tradingEngine/MLEnsembleTrainer.ts
// Classical ML Ensemble Trainer for LOB prediction
// Implements: Decision Tree, RandomForest, ExtraTrees, AdaBoost, GradientBoosting, SVM
// With K-Fold Cross Validation and model selection

// ─── Types ───────────────────────────────────────────────────────────────────

export interface TrainingData {
  X: number[][];  // Feature matrix [nSamples x nFeatures]
  y: number[];    // Labels [nSamples] — binary 0/1
}

export interface ClassifierResult {
  name: string;
  accuracy: number;
  precision: number;
  recall: number;
  f1: number;
  predictions: number[];
  cvScores: number[];
  trainTimeMs: number;
}

export interface ModelSelection {
  bestModel: string;
  bestScore: number;
  results: ClassifierResult[];
}

export interface TreeNode {
  featureIndex: number;
  threshold: number;
  left: TreeNode | null;
  right: TreeNode | null;
  prediction: number;
  isLeaf: boolean;
  samples: number;
}

export interface ClassifierConfig {
  nEstimators: number;
  maxDepth: number;
  minSamplesLeaf: number;
  learningRate: number;  // For boosting methods
  nFolds: number;        // Cross-validation folds
}

const DEFAULT_CONFIG: ClassifierConfig = {
  nEstimators: 50,
  maxDepth: 6,
  minSamplesLeaf: 5,
  learningRate: 0.1,
  nFolds: 5,
};

// ─── Utility Functions ───────────────────────────────────────────────────────

function shuffle<T>(arr: T[], rng: () => number = Math.random): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function gini(labels: number[]): number {
  if (labels.length === 0) return 0;
  const counts = new Map<number, number>();
  for (const l of labels) counts.set(l, (counts.get(l) || 0) + 1);
  let impurity = 1;
  for (const count of counts.values()) {
    const p = count / labels.length;
    impurity -= p * p;
  }
  return impurity;
}

function majorityVote(labels: number[]): number {
  const counts = new Map<number, number>();
  for (const l of labels) counts.set(l, (counts.get(l) || 0) + 1);
  let best = 0;
  let bestCount = -1;
  for (const [label, count] of counts) {
    if (count > bestCount) { best = label; bestCount = count; }
  }
  return best;
}

function bootstrapSample(
  X: number[][],
  y: number[],
  weights?: number[]
): { X: number[][]; y: number[]; oobIndices: number[] } {
  const n = X.length;
  const sampledX: number[][] = [];
  const sampledY: number[] = [];
  const selected = new Set<number>();

  for (let i = 0; i < n; i++) {
    let idx: number;
    if (weights) {
      idx = weightedRandomIndex(weights);
    } else {
      idx = Math.floor(Math.random() * n);
    }
    sampledX.push(X[idx]);
    sampledY.push(y[idx]);
    selected.add(idx);
  }

  const oobIndices = [];
  for (let i = 0; i < n; i++) {
    if (!selected.has(i)) oobIndices.push(i);
  }

  return { X: sampledX, y: sampledY, oobIndices };
}

function weightedRandomIndex(weights: number[]): number {
  const total = weights.reduce((s, w) => s + w, 0);
  let r = Math.random() * total;
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i];
    if (r <= 0) return i;
  }
  return weights.length - 1;
}

// ─── Decision Tree ───────────────────────────────────────────────────────────

class DecisionTree {
  private root: TreeNode | null = null;
  private maxDepth: number;
  private minSamplesLeaf: number;
  private useRandomSplits: boolean;  // true for ExtraTrees
  private maxFeatures: number;       // -1 = sqrt(nFeatures)

  constructor(
    maxDepth: number = 6,
    minSamplesLeaf: number = 5,
    useRandomSplits: boolean = false,
    maxFeatures: number = -1
  ) {
    this.maxDepth = maxDepth;
    this.minSamplesLeaf = minSamplesLeaf;
    this.useRandomSplits = useRandomSplits;
    this.maxFeatures = maxFeatures;
  }

  fit(X: number[][], y: number[]): void {
    const nFeatures = X[0]?.length || 0;
    const mf = this.maxFeatures === -1 ? Math.max(1, Math.floor(Math.sqrt(nFeatures))) : this.maxFeatures;
    this.root = this.buildTree(X, y, 0, mf);
  }

  predict(X: number[][]): number[] {
    return X.map(x => this.predictSingle(x));
  }

  predictSingle(x: number[]): number {
    let node = this.root;
    while (node && !node.isLeaf) {
      if (x[node.featureIndex] <= node.threshold) {
        node = node.left;
      } else {
        node = node.right;
      }
    }
    return node?.prediction ?? 0;
  }

  private buildTree(X: number[][], y: number[], depth: number, maxFeatures: number): TreeNode {
    // Stopping conditions
    if (
      depth >= this.maxDepth ||
      y.length <= this.minSamplesLeaf ||
      new Set(y).size === 1
    ) {
      return {
        featureIndex: -1,
        threshold: 0,
        left: null,
        right: null,
        prediction: majorityVote(y),
        isLeaf: true,
        samples: y.length,
      };
    }

    const nFeatures = X[0].length;
    // Select random subset of features
    const featureIndices = this.selectFeatures(nFeatures, maxFeatures);

    let bestGini = Infinity;
    let bestFeature = 0;
    let bestThreshold = 0;
    let bestLeftIdx: number[] = [];
    let bestRightIdx: number[] = [];

    for (const fi of featureIndices) {
      const { threshold, leftIdx, rightIdx, score } = this.findBestSplit(X, y, fi);
      if (score < bestGini && leftIdx.length >= this.minSamplesLeaf && rightIdx.length >= this.minSamplesLeaf) {
        bestGini = score;
        bestFeature = fi;
        bestThreshold = threshold;
        bestLeftIdx = leftIdx;
        bestRightIdx = rightIdx;
      }
    }

    // No valid split found
    if (bestLeftIdx.length === 0 || bestRightIdx.length === 0) {
      return {
        featureIndex: -1,
        threshold: 0,
        left: null,
        right: null,
        prediction: majorityVote(y),
        isLeaf: true,
        samples: y.length,
      };
    }

    const leftX = bestLeftIdx.map(i => X[i]);
    const leftY = bestLeftIdx.map(i => y[i]);
    const rightX = bestRightIdx.map(i => X[i]);
    const rightY = bestRightIdx.map(i => y[i]);

    return {
      featureIndex: bestFeature,
      threshold: bestThreshold,
      left: this.buildTree(leftX, leftY, depth + 1, maxFeatures),
      right: this.buildTree(rightX, rightY, depth + 1, maxFeatures),
      prediction: majorityVote(y),
      isLeaf: false,
      samples: y.length,
    };
  }

  private findBestSplit(X: number[][], y: number[], featureIndex: number) {
    const values = X.map((x, i) => ({ val: x[featureIndex], idx: i }));

    if (this.useRandomSplits) {
      // ExtraTrees: random threshold between min and max
      const min = Math.min(...values.map(v => v.val));
      const max = Math.max(...values.map(v => v.val));
      const threshold = min + Math.random() * (max - min);

      const leftIdx = values.filter(v => v.val <= threshold).map(v => v.idx);
      const rightIdx = values.filter(v => v.val > threshold).map(v => v.idx);
      const leftY = leftIdx.map(i => y[i]);
      const rightY = rightIdx.map(i => y[i]);
      const score = (leftY.length * gini(leftY) + rightY.length * gini(rightY)) / y.length;

      return { threshold, leftIdx, rightIdx, score };
    }

    // Standard: find best threshold by sorting
    values.sort((a, b) => a.val - b.val);

    let bestScore = Infinity;
    let bestThreshold = 0;
    let bestLeftIdx: number[] = [];
    let bestRightIdx: number[] = [];

    // Try splits at midpoints between unique values (subsample for speed)
    const step = Math.max(1, Math.floor(values.length / 20));
    for (let i = step; i < values.length; i += step) {
      if (values[i].val === values[i - 1].val) continue;
      const threshold = (values[i].val + values[i - 1].val) / 2;

      const leftIdx = values.slice(0, i).map(v => v.idx);
      const rightIdx = values.slice(i).map(v => v.idx);
      const leftY = leftIdx.map(j => y[j]);
      const rightY = rightIdx.map(j => y[j]);
      const score = (leftY.length * gini(leftY) + rightY.length * gini(rightY)) / y.length;

      if (score < bestScore) {
        bestScore = score;
        bestThreshold = threshold;
        bestLeftIdx = leftIdx;
        bestRightIdx = rightIdx;
      }
    }

    return { threshold: bestThreshold, leftIdx: bestLeftIdx, rightIdx: bestRightIdx, score: bestScore };
  }

  private selectFeatures(nFeatures: number, maxFeatures: number): number[] {
    if (maxFeatures >= nFeatures) {
      return Array.from({ length: nFeatures }, (_, i) => i);
    }
    const indices = Array.from({ length: nFeatures }, (_, i) => i);
    return shuffle(indices).slice(0, maxFeatures);
  }
}

// ─── Classifier Implementations ──────────────────────────────────────────────

interface Classifier {
  name: string;
  fit(X: number[][], y: number[]): void;
  predict(X: number[][]): number[];
}

class RandomForestClassifier implements Classifier {
  name = 'RandomForest';
  private trees: DecisionTree[] = [];
  private config: ClassifierConfig;

  constructor(config: Partial<ClassifierConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  fit(X: number[][], y: number[]): void {
    this.trees = [];
    for (let i = 0; i < this.config.nEstimators; i++) {
      const { X: bsX, y: bsY } = bootstrapSample(X, y);
      const tree = new DecisionTree(this.config.maxDepth, this.config.minSamplesLeaf, false);
      tree.fit(bsX, bsY);
      this.trees.push(tree);
    }
  }

  predict(X: number[][]): number[] {
    return X.map(x => {
      const votes = this.trees.map(t => t.predictSingle(x));
      return majorityVote(votes);
    });
  }
}

class ExtraTreesClassifier implements Classifier {
  name = 'ExtraTrees';
  private trees: DecisionTree[] = [];
  private config: ClassifierConfig;

  constructor(config: Partial<ClassifierConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  fit(X: number[][], y: number[]): void {
    this.trees = [];
    for (let i = 0; i < this.config.nEstimators; i++) {
      // ExtraTrees uses random splits, not bootstrap
      const tree = new DecisionTree(this.config.maxDepth, this.config.minSamplesLeaf, true);
      tree.fit(X, y);
      this.trees.push(tree);
    }
  }

  predict(X: number[][]): number[] {
    return X.map(x => {
      const votes = this.trees.map(t => t.predictSingle(x));
      return majorityVote(votes);
    });
  }
}

class AdaBoostClassifier implements Classifier {
  name = 'AdaBoost';
  private stumps: DecisionTree[] = [];
  private alphas: number[] = [];
  private config: ClassifierConfig;

  constructor(config: Partial<ClassifierConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  fit(X: number[][], y: number[]): void {
    const n = X.length;
    let weights = new Array(n).fill(1 / n);
    this.stumps = [];
    this.alphas = [];

    for (let t = 0; t < this.config.nEstimators; t++) {
      // Train a weak learner (depth-1 stump)
      const { X: bsX, y: bsY } = bootstrapSample(X, y, weights);
      const stump = new DecisionTree(2, 1, false);
      stump.fit(bsX, bsY);

      // Compute weighted error
      const predictions = stump.predict(X);
      let error = 0;
      for (let i = 0; i < n; i++) {
        if (predictions[i] !== y[i]) error += weights[i];
      }
      error = Math.max(1e-10, Math.min(1 - 1e-10, error));

      // Compute alpha (classifier weight)
      const alpha = 0.5 * Math.log((1 - error) / error);

      // Update sample weights
      const newWeights = new Array(n);
      let weightSum = 0;
      for (let i = 0; i < n; i++) {
        const sign = predictions[i] === y[i] ? -1 : 1;
        newWeights[i] = weights[i] * Math.exp(alpha * sign);
        weightSum += newWeights[i];
      }
      // Normalize weights
      for (let i = 0; i < n; i++) newWeights[i] /= weightSum;
      weights = newWeights;

      this.stumps.push(stump);
      this.alphas.push(alpha);
    }
  }

  predict(X: number[][]): number[] {
    return X.map(x => {
      let score0 = 0;
      let score1 = 0;
      for (let t = 0; t < this.stumps.length; t++) {
        const pred = this.stumps[t].predictSingle(x);
        if (pred === 1) score1 += this.alphas[t];
        else score0 += this.alphas[t];
      }
      return score1 >= score0 ? 1 : 0;
    });
  }
}

class GradientBoostingClassifier implements Classifier {
  name = 'GradientBoosting';
  private trees: DecisionTree[] = [];
  private learningRate: number;
  private basePrediction: number = 0;
  private config: ClassifierConfig;

  constructor(config: Partial<ClassifierConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.learningRate = this.config.learningRate;
  }

  fit(X: number[][], y: number[]): void {
    const n = X.length;
    // Initialize with log-odds of positive class
    const posCount = y.filter(v => v === 1).length;
    const negCount = n - posCount;
    this.basePrediction = Math.log((posCount + 1e-10) / (negCount + 1e-10));

    // Current predictions (logit space)
    const F = new Array(n).fill(this.basePrediction);
    this.trees = [];

    for (let t = 0; t < this.config.nEstimators; t++) {
      // Compute pseudo-residuals (negative gradient of log-loss)
      const residuals = new Array(n);
      for (let i = 0; i < n; i++) {
        const p = 1 / (1 + Math.exp(-F[i]));  // sigmoid
        residuals[i] = y[i] - p;
      }

      // Fit a regression tree to residuals
      const tree = new DecisionTree(this.config.maxDepth, this.config.minSamplesLeaf, false);
      tree.fit(X, residuals.map(r => r > 0 ? 1 : 0));

      // Update predictions
      const treePreds = tree.predict(X);
      for (let i = 0; i < n; i++) {
        F[i] += this.learningRate * (treePreds[i] === 1 ? 1 : -1);
      }

      this.trees.push(tree);
    }
  }

  predict(X: number[][]): number[] {
    return X.map(x => {
      let F = this.basePrediction;
      for (const tree of this.trees) {
        const pred = tree.predictSingle(x);
        F += this.learningRate * (pred === 1 ? 1 : -1);
      }
      const prob = 1 / (1 + Math.exp(-F));
      return prob >= 0.5 ? 1 : 0;
    });
  }
}

class SVMClassifier implements Classifier {
  name = 'SVM';
  private weights: number[] = [];
  private bias: number = 0;
  private config: ClassifierConfig;

  constructor(config: Partial<ClassifierConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  fit(X: number[][], y: number[]): void {
    if (X.length === 0 || X[0].length === 0) return;

    const nFeatures = X[0].length;
    const n = X.length;
    this.weights = new Array(nFeatures).fill(0);
    this.bias = 0;

    // Convert labels to {-1, +1}
    const ySign = y.map(v => v === 1 ? 1 : -1);

    // SGD optimization for linear SVM with hinge loss
    const lr0 = 0.01;
    const lambda = 0.001;  // Regularization
    const epochs = 100;

    for (let epoch = 0; epoch < epochs; epoch++) {
      const lr = lr0 / (1 + lambda * epoch);

      // Shuffle indices
      const indices = shuffle(Array.from({ length: n }, (_, i) => i));

      for (const i of indices) {
        const xi = X[i];
        const yi = ySign[i];

        // Compute decision function
        let decision = this.bias;
        for (let j = 0; j < nFeatures; j++) {
          decision += this.weights[j] * xi[j];
        }

        if (yi * decision < 1) {
          // Misclassified or within margin
          for (let j = 0; j < nFeatures; j++) {
            this.weights[j] = (1 - lr * lambda) * this.weights[j] + lr * yi * xi[j];
          }
          this.bias += lr * yi;
        } else {
          // Correctly classified outside margin
          for (let j = 0; j < nFeatures; j++) {
            this.weights[j] = (1 - lr * lambda) * this.weights[j];
          }
        }
      }
    }
  }

  predict(X: number[][]): number[] {
    return X.map(x => {
      let decision = this.bias;
      for (let j = 0; j < this.weights.length; j++) {
        decision += this.weights[j] * (x[j] || 0);
      }
      return decision >= 0 ? 1 : 0;
    });
  }
}

// ─── Cross Validation ────────────────────────────────────────────────────────

function kFoldSplit(n: number, k: number): Array<{ train: number[]; test: number[] }> {
  const indices = shuffle(Array.from({ length: n }, (_, i) => i));
  const foldSize = Math.floor(n / k);
  const folds: Array<{ train: number[]; test: number[] }> = [];

  for (let i = 0; i < k; i++) {
    const start = i * foldSize;
    const end = i === k - 1 ? n : (i + 1) * foldSize;
    const test = indices.slice(start, end);
    const train = [...indices.slice(0, start), ...indices.slice(end)];
    folds.push({ train, test });
  }

  return folds;
}

function computeMetrics(yTrue: number[], yPred: number[]) {
  let tp = 0, fp = 0, fn = 0, tn = 0;
  for (let i = 0; i < yTrue.length; i++) {
    if (yTrue[i] === 1 && yPred[i] === 1) tp++;
    else if (yTrue[i] === 0 && yPred[i] === 1) fp++;
    else if (yTrue[i] === 1 && yPred[i] === 0) fn++;
    else tn++;
  }
  const accuracy = (tp + tn) / (tp + fp + fn + tn || 1);
  const precision = tp / (tp + fp || 1);
  const recall = tp / (tp + fn || 1);
  const f1 = 2 * precision * recall / (precision + recall || 1);
  return { accuracy, precision, recall, f1 };
}

// ─── ML Ensemble Trainer ─────────────────────────────────────────────────────

class MLEnsembleTrainer {
  private config: ClassifierConfig;
  private classifiers: Classifier[] = [];
  private bestClassifier: Classifier | null = null;
  private lastResults: ModelSelection | null = null;

  constructor(config: Partial<ClassifierConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.classifiers = [
      new RandomForestClassifier(this.config),
      new ExtraTreesClassifier(this.config),
      new AdaBoostClassifier(this.config),
      new GradientBoostingClassifier(this.config),
      new SVMClassifier(this.config),
    ];
  }

  // Train all classifiers with K-Fold CV and select the best
  trainAndSelect(data: TrainingData): ModelSelection {
    const { X, y } = data;
    if (X.length < this.config.nFolds * 2) {
      throw new Error(`Not enough samples (${X.length}) for ${this.config.nFolds}-fold CV`);
    }

    // Normalize features
    const { normalized, means, stds } = this.normalize(X);

    const results: ClassifierResult[] = [];

    for (const clf of this.classifiers) {
      const start = performance.now();
      const cvScores = this.crossValidate(clf, normalized, y);
      const trainTime = performance.now() - start;

      // Final fit on full data
      clf.fit(normalized, y);
      const predictions = clf.predict(normalized);
      const metrics = computeMetrics(y, predictions);

      results.push({
        name: clf.name,
        accuracy: metrics.accuracy,
        precision: metrics.precision,
        recall: metrics.recall,
        f1: metrics.f1,
        predictions,
        cvScores,
        trainTimeMs: trainTime,
      });
    }

    // Select best by mean CV accuracy
    let bestIdx = 0;
    let bestMeanCV = -1;
    for (let i = 0; i < results.length; i++) {
      const mean = results[i].cvScores.reduce((s, v) => s + v, 0) / results[i].cvScores.length;
      if (mean > bestMeanCV) {
        bestMeanCV = mean;
        bestIdx = i;
      }
    }

    this.bestClassifier = this.classifiers[bestIdx];
    this.lastResults = {
      bestModel: results[bestIdx].name,
      bestScore: bestMeanCV,
      results,
    };

    return this.lastResults;
  }

  // Cross-validate a single classifier
  private crossValidate(clf: Classifier, X: number[][], y: number[]): number[] {
    const folds = kFoldSplit(X.length, this.config.nFolds);
    const scores: number[] = [];

    for (const { train, test } of folds) {
      const trainX = train.map(i => X[i]);
      const trainY = train.map(i => y[i]);
      const testX = test.map(i => X[i]);
      const testY = test.map(i => y[i]);

      // Create a fresh classifier of the same type
      const freshClf = this.createFreshClassifier(clf.name);
      freshClf.fit(trainX, trainY);
      const preds = freshClf.predict(testX);
      const { accuracy } = computeMetrics(testY, preds);
      scores.push(accuracy);
    }

    return scores;
  }

  // Predict using the best model
  predictBest(X: number[][]): number[] {
    if (!this.bestClassifier) throw new Error('No model trained yet. Call trainAndSelect() first.');
    return this.bestClassifier.predict(X);
  }

  // Get the last training results
  getResults(): ModelSelection | null {
    return this.lastResults;
  }

  // Normalize features (z-score)
  private normalize(X: number[][]): { normalized: number[][]; means: number[]; stds: number[] } {
    const nFeatures = X[0]?.length || 0;
    const means = new Array(nFeatures).fill(0);
    const stds = new Array(nFeatures).fill(0);

    // Compute means
    for (const row of X) {
      for (let j = 0; j < nFeatures; j++) means[j] += row[j];
    }
    for (let j = 0; j < nFeatures; j++) means[j] /= X.length;

    // Compute stds
    for (const row of X) {
      for (let j = 0; j < nFeatures; j++) stds[j] += (row[j] - means[j]) ** 2;
    }
    for (let j = 0; j < nFeatures; j++) stds[j] = Math.sqrt(stds[j] / X.length) || 1;

    // Normalize
    const normalized = X.map(row =>
      row.map((val, j) => (val - means[j]) / stds[j])
    );

    return { normalized, means, stds };
  }

  private createFreshClassifier(name: string): Classifier {
    switch (name) {
      case 'RandomForest': return new RandomForestClassifier(this.config);
      case 'ExtraTrees': return new ExtraTreesClassifier(this.config);
      case 'AdaBoost': return new AdaBoostClassifier(this.config);
      case 'GradientBoosting': return new GradientBoostingClassifier(this.config);
      case 'SVM': return new SVMClassifier(this.config);
      default: return new RandomForestClassifier(this.config);
    }
  }
}

export default MLEnsembleTrainer;
export {
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
};
export type { Classifier };
