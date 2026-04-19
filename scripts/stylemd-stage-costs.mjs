#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const PRICING_PROFILES = {
  claude: {
    provider: "claude",
    model: "claude-sonnet-4-6",
    source: "https://claude.com/pricing",
    checkedAt: "2026-04-15",
    inputPerMTokUsd: 3,
    outputPerMTokUsd: 15,
    cacheReadPerMTokUsd: 0.3,
    cacheWrite5mPerMTokUsd: 3.75,
    cacheWrite1hPerMTokUsd: 6,
  },
  kimiK25: {
    provider: "kimi",
    model: "kimi-k2.5",
    source: "https://platform.kimi.ai/",
    checkedAt: "2026-04-15",
    inputPerMTokUsd: 0.6,
    outputPerMTokUsd: 3,
    cacheReadPerMTokUsd: 0.1,
    cacheWrite5mPerMTokUsd: 0.6,
    cacheWrite1hPerMTokUsd: 0.6,
  },
  kimiK2: {
    provider: "kimi",
    model: "kimi-k2",
    source: "https://platform.kimi.ai/",
    checkedAt: "2026-04-15",
    inputPerMTokUsd: 0.6,
    outputPerMTokUsd: 2.5,
    cacheReadPerMTokUsd: 0.15,
    cacheWrite5mPerMTokUsd: 0.6,
    cacheWrite1hPerMTokUsd: 0.6,
  },
};

function number(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function formatUsd(value) {
  return `$${value.toFixed(6)}`;
}

function formatInt(value) {
  return value.toLocaleString("en-US");
}

function parseArgs(argv) {
  const args = {
    runId: null,
    json: false,
    artifactsRoot: path.join(process.cwd(), ".playground", "stylemd-artifact-runs"),
    claudeProjectsRoot: path.join(os.homedir(), ".claude", "projects"),
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--run-id" && argv[i + 1]) {
      args.runId = argv[i + 1];
      i += 1;
      continue;
    }
    if (token.startsWith("--run-id=")) {
      args.runId = token.slice("--run-id=".length);
      continue;
    }
    if (token === "--json") {
      args.json = true;
      continue;
    }
    if (token === "--artifacts-root" && argv[i + 1]) {
      args.artifactsRoot = path.resolve(argv[i + 1]);
      i += 1;
      continue;
    }
    if (token.startsWith("--artifacts-root=")) {
      args.artifactsRoot = path.resolve(token.slice("--artifacts-root=".length));
      continue;
    }
    if (token === "--claude-projects-root" && argv[i + 1]) {
      args.claudeProjectsRoot = path.resolve(argv[i + 1]);
      i += 1;
      continue;
    }
    if (token.startsWith("--claude-projects-root=")) {
      args.claudeProjectsRoot = path.resolve(token.slice("--claude-projects-root=".length));
      continue;
    }
    if (token === "--help" || token === "-h") {
      printHelp();
      process.exit(0);
    }
    throw new Error(`Unknown argument: ${token}`);
  }

  return args;
}

function printHelp() {
  console.log(`Usage: node scripts/stylemd-stage-costs.mjs [options]

Options:
  --run-id <stylemd_id>          Run id (for example: stylemd_1776233156807)
  --json                         Print machine-readable JSON output
  --artifacts-root <path>        Root dir for stylemd runs (default: .playground/stylemd-artifact-runs)
  --claude-projects-root <path>  Claude projects dir (default: ~/.claude/projects)
  --help                         Show this help message

If --run-id is omitted, the latest stylemd run folder in artifacts root is used.`);
}

function latestRunId(artifactsRoot) {
  const entries = fs
    .readdirSync(artifactsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^stylemd_\d+/.test(entry.name))
    .map((entry) => entry.name)
    .sort((a, b) => {
      const na = Number((a.match(/^stylemd_(\d+)/) || [])[1] || 0);
      const nb = Number((b.match(/^stylemd_(\d+)/) || [])[1] || 0);
      return nb - na;
    });

  if (entries.length === 0) {
    throw new Error(`No stylemd_* runs found under ${artifactsRoot}`);
  }
  return entries[0];
}

function readRunSummary(artifactsRoot, runId) {
  const summaryPath = path.join(artifactsRoot, runId, "summary.json");
  if (!fs.existsSync(summaryPath)) {
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(summaryPath, "utf8"));
  } catch {
    return null;
  }
}

function normalizeProvider(value) {
  return value === "kimi" ? "kimi" : "claude";
}

function resolvePricing(summary) {
  const provider = normalizeProvider(summary?.provider);
  const model = typeof summary?.model === "string" && summary.model.trim() ? summary.model.trim() : null;

  if (provider === "kimi") {
    if (model && model.startsWith("kimi-k2.5")) {
      return {
        provider,
        model,
        pricing: PRICING_PROFILES.kimiK25,
      };
    }
    if (model && model.startsWith("kimi-k2")) {
      return {
        provider,
        model,
        pricing: PRICING_PROFILES.kimiK2,
      };
    }
    return {
      provider,
      model,
      pricing: null,
      warning: `Unknown Kimi model '${model ?? "missing"}'. Showing token counts only; no USD cost computed.`,
    };
  }

  if (model && !model.startsWith("claude-") && model !== "default") {
    return {
      provider,
      model,
      pricing: null,
      warning: `Unknown Claude model '${model}'. Showing token counts only; no USD cost computed.`,
    };
  }

  return {
    provider,
    model: model ?? PRICING_PROFILES.claude.model,
    pricing: PRICING_PROFILES.claude,
  };
}

function listStageDirs(claudeProjectsRoot, runId) {
  const runToken = runId.replaceAll("_", "-");
  const entries = fs.readdirSync(claudeProjectsRoot, { withFileTypes: true });
  const out = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (!entry.name.includes(runToken)) continue;
    const marker = "agent-workspace-";
    const idx = entry.name.indexOf(marker);
    if (idx < 0) continue;
    const stage = entry.name.slice(idx + marker.length);
    out.push({
      stage,
      dirName: entry.name,
      dirPath: path.join(claudeProjectsRoot, entry.name),
    });
  }
  return out;
}

function summarizeStage(stageDir, pricing) {
  const files = fs
    .readdirSync(stageDir.dirPath)
    .filter((name) => name.endsWith(".jsonl"))
    .sort()
    .map((name) => path.join(stageDir.dirPath, name));

  const requestIds = new Set();
  const modelCounts = new Map();
  const totals = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWrite5mTokens: 0,
    cacheWrite1hTokens: 0,
  };

  for (const filePath of files) {
    const text = fs.readFileSync(filePath, "utf8");
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      let record;
      try {
        record = JSON.parse(line);
      } catch {
        continue;
      }
      if (record?.type !== "assistant") continue;

      const id = record.requestId || `uuid:${record.uuid || `${filePath}:${requestIds.size}`}`;
      if (requestIds.has(id)) continue;
      requestIds.add(id);

      const usage = record?.message?.usage || {};
      const cacheCreation = usage.cache_creation || {};

      const inputTokens = number(usage.input_tokens);
      const outputTokens = number(usage.output_tokens);
      const cacheReadTokens = number(usage.cache_read_input_tokens);
      const totalCacheWriteTokens = number(usage.cache_creation_input_tokens);
      let cacheWrite5mTokens = number(cacheCreation.ephemeral_5m_input_tokens);
      const cacheWrite1hTokens = number(cacheCreation.ephemeral_1h_input_tokens);

      const knownWriteSplit = cacheWrite5mTokens + cacheWrite1hTokens;
      if (totalCacheWriteTokens > knownWriteSplit) {
        cacheWrite5mTokens += totalCacheWriteTokens - knownWriteSplit;
      }

      totals.inputTokens += inputTokens;
      totals.outputTokens += outputTokens;
      totals.cacheReadTokens += cacheReadTokens;
      totals.cacheWrite5mTokens += cacheWrite5mTokens;
      totals.cacheWrite1hTokens += cacheWrite1hTokens;

      const model = record?.message?.model || "unknown";
      modelCounts.set(model, (modelCounts.get(model) || 0) + 1);
    }
  }

  const costs = pricing
    ? {
      inputUsd: (totals.inputTokens * pricing.inputPerMTokUsd) / 1_000_000,
      outputUsd: (totals.outputTokens * pricing.outputPerMTokUsd) / 1_000_000,
      cacheReadUsd: (totals.cacheReadTokens * pricing.cacheReadPerMTokUsd) / 1_000_000,
      cacheWrite5mUsd: (totals.cacheWrite5mTokens * pricing.cacheWrite5mPerMTokUsd) / 1_000_000,
      cacheWrite1hUsd: (totals.cacheWrite1hTokens * pricing.cacheWrite1hPerMTokUsd) / 1_000_000,
    }
    : null;
  if (costs) {
    costs.totalUsd = costs.inputUsd + costs.outputUsd + costs.cacheReadUsd + costs.cacheWrite5mUsd + costs.cacheWrite1hUsd;
  }

  return {
    stage: stageDir.stage,
    files,
    requestCount: requestIds.size,
    tokens: totals,
    costs,
    modelCounts: Object.fromEntries(modelCounts.entries()),
  };
}

function sortStages(rows) {
  const preferredOrder = ["curate", "styleguide", "showcase"];
  return [...rows].sort((a, b) => {
    const ia = preferredOrder.indexOf(a.stage);
    const ib = preferredOrder.indexOf(b.stage);
    if (ia === -1 && ib === -1) return a.stage.localeCompare(b.stage);
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });
}

function aggregateTotals(rows, hasPricing) {
  const totals = {
    requestCount: 0,
    fileCount: 0,
    tokens: {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWrite5mTokens: 0,
      cacheWrite1hTokens: 0,
    },
    costs: {
      inputUsd: 0,
      outputUsd: 0,
      cacheReadUsd: 0,
      cacheWrite5mUsd: 0,
      cacheWrite1hUsd: 0,
      totalUsd: 0,
    },
  };

  for (const row of rows) {
    totals.requestCount += row.requestCount;
    totals.fileCount += row.files.length;
    totals.tokens.inputTokens += row.tokens.inputTokens;
    totals.tokens.outputTokens += row.tokens.outputTokens;
    totals.tokens.cacheReadTokens += row.tokens.cacheReadTokens;
    totals.tokens.cacheWrite5mTokens += row.tokens.cacheWrite5mTokens;
    totals.tokens.cacheWrite1hTokens += row.tokens.cacheWrite1hTokens;
    if (hasPricing && row.costs) {
      totals.costs.inputUsd += row.costs.inputUsd;
      totals.costs.outputUsd += row.costs.outputUsd;
      totals.costs.cacheReadUsd += row.costs.cacheReadUsd;
      totals.costs.cacheWrite5mUsd += row.costs.cacheWrite5mUsd;
      totals.costs.cacheWrite1hUsd += row.costs.cacheWrite1hUsd;
      totals.costs.totalUsd += row.costs.totalUsd;
    }
  }

  if (!hasPricing) {
    totals.costs = null;
  }
  return totals;
}

function printTable(runId, pricingInfo, rows, totals) {
  console.log(`Run: ${runId}`);
  console.log(`Provider: ${pricingInfo.provider} | Model: ${pricingInfo.model ?? "unknown"}`);
  if (pricingInfo.pricing) {
    console.log(
      `Pricing: ${pricingInfo.pricing.source} (${pricingInfo.pricing.checkedAt}), profile ${pricingInfo.pricing.model}`,
    );
  } else {
    console.log("Pricing: unavailable for this model/provider (token-only report).");
  }
  if (pricingInfo.warning) {
    console.log(`Warning: ${pricingInfo.warning}`);
  }
  console.log("");
  console.log("| Stage | Requests | Files | Input | Cache Write 5m | Cache Read | Output | Stage Cost |");
  console.log("|---|---:|---:|---:|---:|---:|---:|---:|");
  for (const row of rows) {
    const costCell = row.costs ? formatUsd(row.costs.totalUsd) : "n/a";
    console.log(
      `| ${row.stage} | ${row.requestCount} | ${row.files.length} | ${formatInt(row.tokens.inputTokens)} | ${formatInt(row.tokens.cacheWrite5mTokens)} | ${formatInt(row.tokens.cacheReadTokens)} | ${formatInt(row.tokens.outputTokens)} | ${costCell} |`,
    );
  }
  const totalCostCell = totals.costs ? formatUsd(totals.costs.totalUsd) : "n/a";
  console.log(
    `| **TOTAL** | **${totals.requestCount}** | **${totals.fileCount}** | **${formatInt(totals.tokens.inputTokens)}** | **${formatInt(totals.tokens.cacheWrite5mTokens)}** | **${formatInt(totals.tokens.cacheReadTokens)}** | **${formatInt(totals.tokens.outputTokens)}** | **${totalCostCell}** |`,
  );
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!fs.existsSync(args.artifactsRoot)) {
    throw new Error(`Artifacts root does not exist: ${args.artifactsRoot}`);
  }
  if (!fs.existsSync(args.claudeProjectsRoot)) {
    throw new Error(`Claude projects root does not exist: ${args.claudeProjectsRoot}`);
  }

  const runId = args.runId || latestRunId(args.artifactsRoot);
  const summary = readRunSummary(args.artifactsRoot, runId);
  const pricingInfo = resolvePricing(summary);
  const stageDirs = listStageDirs(args.claudeProjectsRoot, runId);
  if (stageDirs.length === 0) {
    throw new Error(`No agent workspace stage directories found for ${runId} under ${args.claudeProjectsRoot}`);
  }

  const rows = sortStages(stageDirs.map((stageDir) => summarizeStage(stageDir, pricingInfo.pricing)));
  const totals = aggregateTotals(rows, Boolean(pricingInfo.pricing));

  if (args.json) {
    console.log(
      JSON.stringify(
        {
          runId,
          provider: pricingInfo.provider,
          model: pricingInfo.model,
          pricing: pricingInfo.pricing,
          pricingWarning: pricingInfo.warning,
          stages: rows,
          totals,
        },
        null,
        2,
      ),
    );
    return;
  }
  printTable(runId, pricingInfo, rows, totals);
}

try {
  main();
} catch (error) {
  console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
