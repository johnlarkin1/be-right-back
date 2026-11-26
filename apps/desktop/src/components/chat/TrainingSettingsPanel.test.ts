import { describe, it, expect } from "vitest";
import {
  formatLearningRate,
  sameSettings,
  validateSettings,
} from "./TrainingSettingsPanel";
import { addLossPoint } from "./TrainingLossChart";

const SETTINGS = {
  max_steps: 450,
  learning_rate: 1e-5,
  lora_rank: 16,
  num_layers: 16,
  batch_size: 1,
  gradient_accumulation_steps: 4,
  max_seq_length: 1024,
  eval_steps: 50,
  early_stopping: true,
};

const BOUNDS = {
  min_steps: 1,
  max_steps: 3000,
  min_learning_rate: 1e-6,
  max_learning_rate: 1e-3,
  lora_ranks: [4, 8, 16, 32, 64],
  max_layers: 32,
  max_batch_size: 8,
  max_grad_accum: 16,
  min_seq_length: 256,
  max_seq_length: 4096,
  min_eval_steps: 10,
  max_eval_steps: 1000,
};

describe("validateSettings", () => {
  it("accepts settings inside the bounds", () => {
    expect(validateSettings(SETTINGS, BOUNDS)).toEqual({});
  });

  it("flags each field outside the bounds", () => {
    const errors = validateSettings(
      {
        ...SETTINGS,
        max_steps: 0,
        num_layers: 33,
        lora_rank: 12,
        learning_rate: 0.5,
        batch_size: Number.NaN,
        eval_steps: 2.5,
      },
      BOUNDS,
    );
    expect(Object.keys(errors).sort()).toEqual(
      [
        "batch_size",
        "eval_steps",
        "learning_rate",
        "lora_rank",
        "max_steps",
        "num_layers",
      ].sort(),
    );
  });
});

describe("sameSettings", () => {
  it("compares every field", () => {
    expect(sameSettings(SETTINGS, { ...SETTINGS })).toBe(true);
    expect(sameSettings(SETTINGS, { ...SETTINGS, early_stopping: false })).toBe(
      false,
    );
  });
});

describe("formatLearningRate", () => {
  it("prints short exponent notation", () => {
    expect(formatLearningRate(1e-5)).toBe("1e-5");
    expect(formatLearningRate(2e-4)).toBe("2e-4");
    expect(formatLearningRate(1.5e-5)).toBe("1.5e-5");
  });
});

describe("addLossPoint", () => {
  it("merges train and validation loss at the same step", () => {
    let points = addLossPoint([], 50, 2.4, null);
    points = addLossPoint(points, 50, null, 2.7);
    points = addLossPoint(points, 10, 3.1, undefined);
    expect(points).toEqual([
      { step: 10, loss: 3.1 },
      { step: 50, loss: 2.4, valLoss: 2.7 },
    ]);
  });

  it("ignores reports without a loss", () => {
    const points = [{ step: 10, loss: 3.1 }];
    expect(addLossPoint(points, 20, null, null)).toBe(points);
  });
});
