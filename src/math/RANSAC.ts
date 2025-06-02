import { RANSACConfig, RANSACResult, ModelFitter } from "../types/geometry";

export class RANSAC<TModel, TData> {
  private config: RANSACConfig;
  private modelFitter: ModelFitter<TModel, TData>;

  constructor(modelFitter: ModelFitter<TModel, TData>, config: RANSACConfig) {
    this.modelFitter = modelFitter;
    this.config = config;
  }

  fit(data: TData[]): RANSACResult<TModel> {
    if (data.length < this.config.minInliers) {
      return {
        model: null,
        inliers: [],
        outliers: data as any[],
        score: 0,
        iterations: 0,
      };
    }

    let bestModel: TModel | null = null;
    let bestInliers: TData[] = [];
    let bestScore = 0;
    let iterations = 0;

    for (let attempt = 0; attempt < this.config.maxAttempts; attempt++) {
      for (let iter = 0; iter < this.config.maxIterations; iter++) {
        iterations++;

        // Randomly sample minimum points needed for model
        const sampleSize = Math.min(3, data.length);
        const sample = this.randomSample(data, sampleSize);
        
        // Fit model to sample
        const model = this.modelFitter.fit(sample);
        if (!model) continue;

        // Find inliers
        const inliers = data.filter(point => 
          this.modelFitter.isInlier(model, point, this.config.threshold)
        );

        if (inliers.length < this.config.minInliers) continue;

        // Score the model
        const score = this.modelFitter.score(model, inliers);

        if (score > bestScore) {
          bestScore = score;
          bestModel = model;
          bestInliers = inliers;
        }
      }

      // Early termination if good enough
      if (bestInliers.length >= data.length * 0.8) break;
    }

    const outliers = data.filter(point => !bestInliers.includes(point));

    return {
      model: bestModel,
      inliers: bestInliers as any[],
      outliers: outliers as any[],
      score: bestScore,
      iterations,
    };
  }

  private randomSample(data: TData[], size: number): TData[] {
    const shuffled = [...data].sort(() => 0.5 - Math.random());
    return shuffled.slice(0, size);
  }
}