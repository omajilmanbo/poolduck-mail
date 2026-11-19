import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { summarizeIo } from "./capacity-io-report.mjs";

const header = "timestamp\tkind\tname\tcpu_percent\tmemory_usage\tnetwork_io\tblock_io\tpids\tload1\tmem_available_kb\tswap_free_kb\troot_used_percent";
const backend = "poolduck-mail-backend";
const postgres = "poolduck-mail-postgres";
const stamp = (second) => `2000-01-01T00:00:${String(second).padStart(2, "0")}Z`;
const host = (s) => [stamp(s), "host", "app01", "-", "-", "-", "-", "-", "1", "12345", "0", "19"].join("\t");
const row = (s, name, block, network = "0B / 0B") =>
  [stamp(s), "container", name, "1%", "-", network, block, "1", "-", "-", "-", "-"].join("\t");
const fixture = (...rows) => [header, ...rows, ""].join("\r\n");
const metric = (bytes, ms, full = null) => ({ observed_bytes: bytes, covered_ms: ms, window_bytes: full });

test("CLI reads the collector layout, separates services and excludes warmup and drain", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "capacity-io-test-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, "synthetic.tsv");
  writeFileSync(path, fixture(
    row(0, backend, "800MB / 1GB"),
    host(5), row(5, backend, "1kB / 1KiB", "1.2MB / 1MiB"), row(5, postgres, "0B / 0B"),
    host(10), row(10, backend, "1.5kB / 2KiB", "1.25MB / 1.5MiB"), row(10, postgres, "0B / 4KB"),
    row(10, "unrelated-service", "1B / 1B"), row(15, backend, "9GB / 9GB"),
  ));
  const cli = fileURLToPath(new URL("./capacity-io-report.mjs", import.meta.url));
  const run = (...args) => spawnSync(process.execPath, [cli, path, ...args], { encoding: "utf8" });
  const output = run(stamp(5), stamp(10), "10");
  assert.equal(output.status, 0, output.stderr);
  const report = JSON.parse(output.stdout);
  assert.equal(report.window_ms, 5000);
  assert.equal(report.containers[backend].samples, 2);
  for (const [dir, n] of Object.entries({ block_read: 500, block_write: 1024, network_rx: 50000, network_tx: 524288 })) {
    assert.deepEqual(report.containers[backend][dir], metric(n, 5000, n));
  }
  assert.deepEqual(report.containers[postgres].block_read, metric(0, 5000, 0));
  assert.deepEqual(report.containers[postgres].block_write, metric(4000, 5000, 4000));
  assert.deepEqual(report.containers["poolduck-mail-frontend"].network_rx, metric(null, 0));
  assert.doesNotMatch(output.stdout, /unrelated-service/);
  assert.equal(run(stamp(10), stamp(5), "10").status, 1);
});

test("missing container rows, missing whole ticks and uncovered window edges are never bridged", () => {
  const data = fixture(
    row(1, backend, "0B / 0B"), row(6, backend, "10B / 0B"),
    host(11), row(16, backend, "100B / 0B"), row(29, backend, "200B / 0B"),
    row(34, backend, "203B / 0B"),
  );
  const result = summarizeIo(data, stamp(0), stamp(35), 10).containers[backend];
  assert.deepEqual(result.block_read, metric(13, 10000));
  assert.deepEqual(result.block_write, metric(0, 10000));
  const edges = summarizeIo(data, "2000-01-01T00:00:00.500Z", stamp(7), 10).containers[backend];
  assert.deepEqual(edges.block_read, metric(10, 5000));
});

test("a counter decrease drops the crossing for all directions, then sampling resumes", () => {
  const data = fixture(
    row(0, backend, "2kB / 1MiB"), row(5, backend, "3kB / 1MiB"),
    row(10, backend, "0B / 2MiB", "500B / 0B"), row(15, backend, "1KiB / 2MiB", "550B / 0B"),
  );
  const result = summarizeIo(data, stamp(0), stamp(15), 5).containers[backend];
  assert.equal(result.reset_intervals, 1);
  assert.deepEqual(result.block_read, metric(2024, 10000));
  assert.deepEqual(result.block_write, metric(0, 10000));
  assert.deepEqual(result.network_rx, metric(50, 10000));
});

test("missing, invalid and unsupported counters leave only independently observed directions", () => {
  const data = fixture(
    row(0, backend, "1B / 0B", "-"), row(5, backend, "2widgets / 5B", "0B / 9B"),
    row(10, backend, "4B / 8B", "- / 1e9B"),
  );
  const result = summarizeIo(data, stamp(0), stamp(10), 5).containers[backend];
  assert.deepEqual(result.block_read, metric(null, 0));
  assert.deepEqual(result.block_write, metric(8, 10000, 8));
  assert.deepEqual(result.network_rx, metric(null, 0));
  assert.deepEqual(result.network_tx, metric(null, 0));
});

test("a reset visible across a missing counter invalidates its ambiguous span for all directions", () => {
  const data = fixture(
    row(0, backend, "9kB / 0B"), row(5, backend, "- / 1kB"),
    row(10, backend, "0B / 2kB"), row(15, backend, "1kB / 3kB"),
  );
  const result = summarizeIo(data, stamp(0), stamp(15), 5).containers[backend];
  assert.equal(result.reset_intervals, 2);
  assert.deepEqual(result.block_write, metric(1000, 5000));
});

test("one sample or an empty window yields unknown even with host root disk usage", () => {
  const data = fixture(host(5), row(5, backend, "12MB / 3MB"));
  for (const start of [0, 6]) {
    const result = summarizeIo(data, stamp(start), stamp(10), 5).containers[backend];
    assert.deepEqual(result.block_read, metric(null, 0));
  }
});

test("a truncated row cannot silently swap network and block counters", () => {
  const truncated = row(5, backend, "1kB / 2kB", "99MB / 1MB").replace("\t1%\t", "\t");
  const data = fixture(row(0, backend, "0B / 0B"), truncated, row(10, backend, "2kB / 4kB"));
  const result = summarizeIo(data, stamp(0), stamp(10), 10).containers[backend];
  assert.deepEqual(result.block_read, metric(null, 0));
  assert.deepEqual(result.network_tx, metric(null, 0));
});

test("ambiguous timestamps, headers and invalid windows fail explicitly", () => {
  const first = row(0, backend, "0B / 0B");
  for (const data of [fixture(first, first), fixture(host(5), first), "timestamp\n", header + "\tblock_io"]) {
    assert.throws(() => summarizeIo(data, stamp(0), stamp(10), 5), /Duplicate|order|header/);
  }
  for (const start of ["2000-02-30T00:00:00Z", "2000-01-01T00:00:00", stamp(10)]) {
    assert.throws(() => summarizeIo(fixture(), start, stamp(10), 5), /UTC|before/);
  }
  assert.throws(() => summarizeIo(fixture(), stamp(0), stamp(10), 0), /positive/);
});
