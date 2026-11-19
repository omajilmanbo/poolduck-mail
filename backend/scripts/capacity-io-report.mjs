import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

// Only report the services in the Staging Compose files, including absent ones.
const containers = [
  "poolduck-mail-backend", "poolduck-mail-postgres",
  "poolduck-mail-frontend", "poolduck-mail-staging-proxy",
];
const directions = ["block_read", "block_write", "network_rx", "network_tx"];
const units = new Map(Object.entries({
  B: 1, kB: 1e3, KB: 1e3, MB: 1e6, GB: 1e9, TB: 1e12, PB: 1e15,
  KiB: 1024, MiB: 1024 ** 2, GiB: 1024 ** 3, TiB: 1024 ** 4, PiB: 1024 ** 5,
}));

function utcMillis(value) {
  const match = /^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)(?:\.(\d{1,3}))?Z$/.exec(value);
  const ms = Date.parse(value);
  if (!match || !Number.isFinite(ms) ||
      new Date(ms).toISOString() !== `${match[1]}.${(match[2] ?? "").padEnd(3, "0")}Z`) {
    throw new Error("Expected a UTC timestamp ending in Z.");
  }
  return ms;
}

function bytes(value) {
  const match = /^(\d+(?:\.\d+)?)\s*([A-Za-z]+)$/.exec(value.trim());
  if (!match || !units.has(match[2])) return null;
  const n = Math.round(Number(match[1]) * units.get(match[2]));
  return Number.isSafeInteger(n) ? n : null;
}

function counterPair(field) {
  const parts = (field ?? "").split("/");
  return parts.length === 2 ? parts.map(bytes) : [null, null];
}

function readWindow(tsv, start, end) {
  const [header, ...lines] = tsv.split(/\r?\n/);
  const columns = header.split("\t");
  const positions = ["timestamp", "kind", "name", "block_io", "network_io"].map((name) => {
    const index = columns.indexOf(name);
    if (index < 0 || index !== columns.lastIndexOf(name)) throw new Error("Invalid monitor TSV header.");
    return index;
  });
  const samples = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    const fields = line.split("\t");
    const [timestamp, kind, name, block, network] = positions.map((index) => fields[index]);
    const time = utcMillis(timestamp);
    if (time < start || time > end) continue;
    let sample = samples.at(-1);
    if (sample && time < sample.time) throw new Error("Out-of-order monitor timestamps.");
    if (!sample || time !== sample.time) {
      sample = { time, rows: new Map() };
      samples.push(sample);
    }
    if (kind === "container" && containers.includes(name)) {
      if (sample.rows.has(name)) throw new Error("Duplicate container sample at one timestamp.");
      // A missing tab can shift a valid-looking network pair into the block column.
      const counters = fields.length === columns.length
        ? [...counterPair(block), ...counterPair(network)]
        : directions.map(() => null);
      sample.rows.set(name, counters);
    }
  }
  return samples;
}

// A decrease can reveal a replacement even if that counter was absent for a few
// ticks. All directions are ambiguous between its last known value and the drop.
function resetIntervals(samples, name) {
  const excluded = new Set();
  const lastKnown = new Map();
  for (const [i, sample] of samples.entries()) {
    const counters = sample.rows.get(name);
    if (!counters) continue;
    let lastStable = i;
    for (const [direction, previous] of lastKnown) {
      const value = counters[direction];
      if (value !== null && value < previous.value) lastStable = Math.min(lastStable, previous.index);
    }
    if (lastStable < i) {
      for (let end = lastStable + 1; end <= i; end++) excluded.add(end);
      lastKnown.clear();
    }
    for (const [direction, value] of counters.entries()) {
      if (value !== null) lastKnown.set(direction, { index: i, value });
    }
  }
  return excluded;
}

function summarizeContainer(samples, name, maxGapMs, windowMs) {
  const metrics = directions.map(() => ({ observed_bytes: null, covered_ms: 0, window_bytes: null }));
  const excluded = resetIntervals(samples, name);
  for (let i = 1; i < samples.length; i++) {
    const previous = samples[i - 1].rows.get(name);
    const current = samples[i].rows.get(name);
    const dt = samples[i].time - samples[i - 1].time;
    if (!previous || !current || dt > maxGapMs || excluded.has(i)) continue;
    for (const [j, metric] of metrics.entries()) {
      if (previous[j] === null || current[j] === null) continue;
      const delta = current[j] - previous[j];
      metric.observed_bytes = (metric.observed_bytes ?? 0) + delta;
      metric.covered_ms += dt;
    }
  }
  for (const metric of metrics) {
    if (!Number.isSafeInteger(metric.observed_bytes)) metric.observed_bytes = null;
    if (metric.covered_ms === windowMs) metric.window_bytes = metric.observed_bytes;
  }
  return {
    samples: samples.filter((sample) => sample.rows.has(name)).length,
    reset_intervals: excluded.size,
    ...Object.fromEntries(directions.map((label, i) => [label, metrics[i]])),
  };
}

export function summarizeIo(tsv, startUtc, endUtc, maxGapSeconds) {
  const start = utcMillis(startUtc);
  const end = utcMillis(endUtc);
  const gapMs = Number(maxGapSeconds) * 1000;
  if (start >= end || !Number.isSafeInteger(gapMs) || gapMs <= 0) {
    throw new Error("Expected start before end and a positive maximum gap in seconds.");
  }
  const samples = readWindow(tsv, start, end);
  return {
    start_utc: startUtc, end_utc: endUtc, window_ms: end - start, max_gap_ms: gapMs,
    containers: Object.fromEntries(containers.map((name) => [
      name, summarizeContainer(samples, name, gapMs, end - start),
    ])),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const [path, start, end, maxGap] = process.argv.slice(2);
    if (process.argv.length !== 6) {
      throw new Error("Usage: node capacity-io-report.mjs FILE START_UTC END_UTC MAX_GAP_SECONDS");
    }
    const report = summarizeIo(readFileSync(path, "utf8"), start, end, maxGap);
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    console.error(error.code ? "Could not read monitor TSV." : error.message);
    process.exitCode = 1;
  }
}
