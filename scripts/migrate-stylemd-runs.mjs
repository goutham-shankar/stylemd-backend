#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";

const RUN_ID_PATTERN = /^stylemd_(\d+)$/;

function parseArgs(argv) {
  const defaults = {
    sourceRoot: path.resolve(process.cwd(), "..", "design_md", ".playground", "stylemd-artifact-runs"),
    destRoot: path.resolve(process.cwd(), ".playground", "stylemd-artifact-runs"),
    count: 10,
    dryRun: false,
    json: false,
  };

  const options = { ...defaults };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--source-root" && argv[i + 1]) {
      options.sourceRoot = path.resolve(argv[i + 1]);
      i += 1;
      continue;
    }
    if (token.startsWith("--source-root=")) {
      options.sourceRoot = path.resolve(token.slice("--source-root=".length));
      continue;
    }
    if (token === "--dest-root" && argv[i + 1]) {
      options.destRoot = path.resolve(argv[i + 1]);
      i += 1;
      continue;
    }
    if (token.startsWith("--dest-root=")) {
      options.destRoot = path.resolve(token.slice("--dest-root=".length));
      continue;
    }
    if (token === "--count" && argv[i + 1]) {
      options.count = parsePositiveInt(argv[i + 1], "count");
      i += 1;
      continue;
    }
    if (token.startsWith("--count=")) {
      options.count = parsePositiveInt(token.slice("--count=".length), "count");
      continue;
    }
    if (token === "--dry-run") {
      options.dryRun = true;
      continue;
    }
    if (token === "--json") {
      options.json = true;
      continue;
    }
    if (token === "--help" || token === "-h") {
      printHelp(defaults);
      process.exit(0);
    }

    throw new Error(`Unknown argument: ${token}`);
  }

  return options;
}

function parsePositiveInt(value, fieldName) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Expected --${fieldName} to be a positive integer, received '${value}'.`);
  }
  return parsed;
}

function printHelp(defaults) {
  console.log(`Usage: node scripts/migrate-stylemd-runs.mjs [options]

Options:
  --source-root <path>  Source runs dir (default: ${defaults.sourceRoot})
  --dest-root <path>    Destination runs dir (default: ${defaults.destRoot})
  --count <n>           Number of latest runs to copy (default: ${defaults.count})
  --dry-run             Print actions without copying
  --json                Print machine-readable JSON output
  --help                Show this help message
`);
}

async function listRunIds(sourceRoot) {
  const entries = await fs.readdir(sourceRoot, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory() && RUN_ID_PATTERN.test(entry.name))
    .map((entry) => entry.name)
    .sort((a, b) => {
      const aTs = Number(a.match(RUN_ID_PATTERN)?.[1] ?? 0);
      const bTs = Number(b.match(RUN_ID_PATTERN)?.[1] ?? 0);
      return bTs - aTs;
    });
}

async function hasExpectedSignals(runDir) {
  const candidates = [
    path.join(runDir, "summary.json"),
    path.join(runDir, "state.json"),
    path.join(runDir, "logs", "events.ndjson"),
  ];

  for (const filePath of candidates) {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      // Ignore and continue.
    }
  }

  return false;
}

async function copyRecentRuns(options) {
  const result = {
    sourceRoot: options.sourceRoot,
    destRoot: options.destRoot,
    requestedCount: options.count,
    copied: [],
    skipped: [],
  };

  let runIds;
  try {
    runIds = await listRunIds(options.sourceRoot);
  } catch (error) {
    throw new Error(`Unable to read source root '${options.sourceRoot}': ${String(error)}`);
  }

  if (runIds.length === 0) {
    return result;
  }

  if (!options.dryRun) {
    await fs.mkdir(options.destRoot, { recursive: true });
  }

  for (const runId of runIds) {
    if (result.copied.length >= options.count) {
      break;
    }

    const sourceDir = path.join(options.sourceRoot, runId);
    const destDir = path.join(options.destRoot, runId);

    const expectedSignals = await hasExpectedSignals(sourceDir);
    if (!expectedSignals) {
      result.skipped.push({ runId, reason: "missing summary/state/log signals" });
      continue;
    }

    if (options.dryRun) {
      result.copied.push({ runId, sourceDir, destDir, dryRun: true });
      continue;
    }

    try {
      await fs.rm(destDir, { recursive: true, force: true });
      await fs.cp(sourceDir, destDir, { recursive: true, force: true });
      result.copied.push({ runId, sourceDir, destDir });
    } catch (error) {
      result.skipped.push({ runId, reason: String(error) });
    }
  }

  return result;
}

async function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    const result = await copyRecentRuns(options);

    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    console.log(`Source root: ${result.sourceRoot}`);
    console.log(`Destination root: ${result.destRoot}`);
    console.log(`Requested copy count: ${result.requestedCount}`);
    console.log(`Copied: ${result.copied.length}`);
    for (const item of result.copied) {
      console.log(`  - ${item.runId}`);
    }
    if (result.skipped.length > 0) {
      console.log(`Skipped: ${result.skipped.length}`);
      for (const item of result.skipped) {
        console.log(`  - ${item.runId}: ${item.reason}`);
      }
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}

export { copyRecentRuns, parseArgs };
