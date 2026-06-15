export interface KimiTokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface KimiCostEstimate {
  model: string;
  currency: "USD";
  inputUsd: number;
  outputUsd: number;
  totalUsd: number;
  inputRatePerMillion: number;
  outputRatePerMillion: number;
  cachedInputRatePerMillion: number;
  basis: string;
}

type KimiRateCard = {
  inputRatePerMillion: number;
  outputRatePerMillion: number;
  cachedInputRatePerMillion: number;
};

const KIMI_RATE_CARDS: Record<string, KimiRateCard> = {
  "kimi-k2.5": {
    inputRatePerMillion: 0.10,
    cachedInputRatePerMillion: 0.60,
    outputRatePerMillion: 3.00,
  },
  "kimi-k2.6": {
    inputRatePerMillion: 0.16,
    cachedInputRatePerMillion: 0.95,
    outputRatePerMillion: 4.00,
  },
};

export function createEmptyKimiTokenUsage(): KimiTokenUsage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
  };
}

export function accumulateKimiTokenUsage(
  current: KimiTokenUsage,
  next?: Partial<Pick<KimiTokenUsage, "inputTokens" | "outputTokens">> | null,
): KimiTokenUsage {
  const inputTokens = current.inputTokens + (next?.inputTokens ?? 0);
  const outputTokens = current.outputTokens + (next?.outputTokens ?? 0);
  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
  };
}

function getRateCard(model: string): KimiRateCard {
  return KIMI_RATE_CARDS[model] ?? KIMI_RATE_CARDS["kimi-k2.5"];
}

export function estimateKimiCost(
  model: string,
  tokenUsage: KimiTokenUsage,
): KimiCostEstimate {
  const rateCard = getRateCard(model);
  const inputUsd = (tokenUsage.inputTokens / 1_000_000) * rateCard.inputRatePerMillion;
  const outputUsd = (tokenUsage.outputTokens / 1_000_000) * rateCard.outputRatePerMillion;

  return {
    model,
    currency: "USD",
    inputUsd,
    outputUsd,
    totalUsd: inputUsd + outputUsd,
    inputRatePerMillion: rateCard.inputRatePerMillion,
    outputRatePerMillion: rateCard.outputRatePerMillion,
    cachedInputRatePerMillion: rateCard.cachedInputRatePerMillion,
    basis: "Approximate estimate from observed input/output tokens using the public Kimi rate card. Cached-token discounts are not detected here.",
  };
}