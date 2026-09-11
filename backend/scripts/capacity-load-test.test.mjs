import assert from "node:assert/strict";
import test from "node:test";
import {
  actionCode,
  loadConfiguration,
  parseSteps,
  percentile,
} from "./capacity-load-test.mjs";

test("parses an ascending capacity ladder", () => {
  assert.deepEqual(parseSteps("1,5,10,20"), [1, 5, 10, 20]);
  assert.throws(() => parseSteps("1,10,5"), /ascending/);
  assert.throws(() => parseSteps("51"), /1 to 50/);
});

test("computes nearest-rank percentiles", () => {
  assert.equal(percentile([50, 10, 30, 20, 40], 0.5), 30);
  assert.equal(percentile([50, 10, 30, 20, 40], 0.95), 50);
  assert.equal(percentile([], 0.95), null);
});

test("cycles person codes and alternates actions only after a full pool", () => {
  assert.equal(actionCode("01K0CAA", 0, 100), "V2E01K0CAA00001");
  assert.equal(actionCode("01K0CAA", 99, 100), "V2E01K0CAA00100");
  assert.equal(actionCode("01K0CAA", 100, 100), "V2X01K0CAA00001");
});

test("plan configuration excludes Production and enforces the 50-session ceiling", () => {
  assert.equal(
    loadConfiguration({ CAPACITY_PLAN_ONLY: "true", CAPACITY_STEPS: "1,5" }).planOnly,
    true,
  );
  assert.throws(
    () => loadConfiguration({ CAPACITY_BASE_URL: "https://production.example", CAPACITY_PLAN_ONLY: "true" }),
    /Production/,
  );
  assert.throws(
    () => loadConfiguration({ CAPACITY_BASE_URL: "https://unapproved.example", CAPACITY_PLAN_ONLY: "true" }),
    /Production/,
  );
  assert.throws(
    () => loadConfiguration({ CAPACITY_STEPS: "1,60", CAPACITY_PLAN_ONLY: "true" }),
    /1 to 50/,
  );
});
