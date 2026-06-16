"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createEmptyKimiTokenUsage = createEmptyKimiTokenUsage;
exports.accumulateKimiTokenUsage = accumulateKimiTokenUsage;
exports.estimateKimiCost = estimateKimiCost;
const KIMI_RATE_CARDS = {
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
function createEmptyKimiTokenUsage() {
    return {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
    };
}
function accumulateKimiTokenUsage(current, next) {
    const inputTokens = current.inputTokens + (next?.inputTokens ?? 0);
    const outputTokens = current.outputTokens + (next?.outputTokens ?? 0);
    return {
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens,
    };
}
function getRateCard(model) {
    return KIMI_RATE_CARDS[model] ?? KIMI_RATE_CARDS["kimi-k2.5"];
}
function estimateKimiCost(model, tokenUsage) {
    const rateCard = getRateCard(model);
    const inputUsd = (tokenUsage.inputTokens / 1000000) * rateCard.inputRatePerMillion;
    const outputUsd = (tokenUsage.outputTokens / 1000000) * rateCard.outputRatePerMillion;
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
