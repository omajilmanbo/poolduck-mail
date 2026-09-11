import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const DEFAULT_STEPS = "1,5,10,20,40,50";

export function integerSetting(name, fallback, minimum, maximum, env = process.env) {
  const value = Number(env[name] ?? fallback);
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} to ${maximum}.`);
  }
  return value;
}

export function numberSetting(name, fallback, minimum, maximum, env = process.env) {
  const value = Number(env[name] ?? fallback);
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be a number from ${minimum} to ${maximum}.`);
  }
  return value;
}

export function parseSteps(value = DEFAULT_STEPS) {
  const steps = value.split(",").map((item) => Number(item.trim()));
  if (
    steps.length === 0 ||
    steps.some((step) => !Number.isInteger(step) || step < 1 || step > 50) ||
    steps.some((step, index) => index > 0 && step <= steps[index - 1])
  ) {
    throw new Error("CAPACITY_STEPS must be ascending unique integers from 1 to 50.");
  }
  return steps;
}

export function percentile(values, fraction) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
}

export function actionCode(prefix, sequence, personCount) {
  const offset = sequence % personCount;
  const cycle = Math.floor(sequence / personCount);
  const action = cycle % 2 === 0 ? "E" : "X";
  return `V2${action}${prefix}${String(offset + 1).padStart(5, "0")}`;
}

export function loadConfiguration(env = process.env) {
  const scenario = env.CAPACITY_SCENARIO ?? "steady";
  if (!new Set(["steady", "burst", "mixed"]).has(scenario)) {
    throw new Error("CAPACITY_SCENARIO must be steady, burst, or mixed.");
  }
  const baseUrl = env.CAPACITY_BASE_URL ?? "http://localhost:3001";
  const targetHost = new URL(baseUrl).hostname;
  const allowedHosts = new Set(["localhost", "127.0.0.1", "app.poolducktest.com"]);
  if (
    /prod(uction)?/i.test(baseUrl) ||
    env.APP_ENV === "production" ||
    !allowedHosts.has(targetHost)
  ) {
    throw new Error("Capacity load refuses a Production target.");
  }
  return {
    scenario,
    baseUrl: baseUrl.replace(/\/$/, ""),
    steps: parseSteps(env.CAPACITY_STEPS ?? DEFAULT_STEPS),
    stepSeconds: integerSetting("CAPACITY_STEP_SECONDS", 300, 5, 3_600, env),
    thinkTimeMs: integerSetting(
      "CAPACITY_THINK_TIME_MS",
      scenario === "burst" ? 0 : 1_000,
      0,
      60_000,
      env,
    ),
    timeoutMs: integerSetting("CAPACITY_REQUEST_TIMEOUT_MS", 5_000, 500, 60_000, env),
    maxUnexpectedRate: numberSetting("CAPACITY_MAX_UNEXPECTED_RATE", 0.05, 0, 1, env),
    p95LimitMs: integerSetting("CAPACITY_P95_LIMIT_MS", 2_000, 100, 60_000, env),
    personCount: integerSetting("CAPACITY_PERSON_COUNT", 4_096, 100, 99_999, env),
    personReuseMs: integerSetting("CAPACITY_PERSON_REUSE_MS", 10_500, 10_000, 60_000, env),
    tenantCode: env.CAPACITY_TENANT_CODE ?? "5A6E116001",
    locationCode: env.CAPACITY_LOCATION_CODE ?? "5A6E1161",
    operatorPrefix: env.CAPACITY_OPERATOR_PREFIX ?? "capacity-a-op-",
    personPrefix: env.CAPACITY_PERSON_PREFIX ?? "01K0CAA",
    suspendedTenantCode: env.CAPACITY_SUSPENDED_TENANT_CODE ?? "5A6E116002",
    suspendedLocationCode: env.CAPACITY_SUSPENDED_LOCATION_CODE ?? "5A6E1162",
    suspendedIdentifier: env.CAPACITY_SUSPENDED_IDENTIFIER ?? "capacity-s-op-00001",
    suspendedScanCode: env.CAPACITY_SUSPENDED_SCAN_CODE ?? "V2E01K0CAS00001",
    unmappedScanCode: env.CAPACITY_UNMAPPED_SCAN_CODE ?? "V2E01K0CAA99999",
    password: readPassword(env),
    planOnly: env.CAPACITY_PLAN_ONLY === "true" || process.argv.includes("--plan"),
  };
}

function readPassword(env) {
  if (env.CAPACITY_TEST_PASSWORD) return env.CAPACITY_TEST_PASSWORD;
  if (env.CAPACITY_TEST_PASSWORD_FILE) {
    return readFileSync(env.CAPACITY_TEST_PASSWORD_FILE, "utf8").trimEnd();
  }
  return "";
}

function safeConfiguration(config) {
  const safe = { ...config };
  delete safe.password;
  return safe;
}

function cookieHeader(headers) {
  const values = typeof headers.getSetCookie === "function" ? headers.getSetCookie() : [];
  const raw = values.length > 0 ? values : [headers.get("set-cookie") ?? ""];
  return raw
    .flatMap((value) => value.split(/,(?=\s*poolduck_)/))
    .map((value) => value.trim().split(";")[0])
    .filter(Boolean)
    .join("; ");
}

async function request(config, path, options = {}) {
  const started = performance.now();
  try {
    const response = await fetch(`${config.baseUrl}${path}`, {
      ...options,
      signal: AbortSignal.timeout(config.timeoutMs),
      headers: {
        "content-type": "application/json",
        ...(options.headers ?? {}),
      },
    });
    const text = await response.text();
    let body;
    try {
      body = text ? JSON.parse(text) : undefined;
    } catch {
      body = undefined;
    }
    return {
      status: response.status,
      body,
      cookie: cookieHeader(response.headers),
      durationMs: performance.now() - started,
      timedOut: false,
    };
  } catch (error) {
    return {
      status: 0,
      body: undefined,
      cookie: "",
      durationMs: performance.now() - started,
      timedOut: error?.name === "TimeoutError",
    };
  }
}

async function login(config, tenantCode, identifier) {
  const result = await request(config, "/api/auth/login", {
    method: "POST",
    body: JSON.stringify({
      tenant_code: tenantCode,
      identifier,
      password: config.password,
    }),
  });
  if (result.status !== 201 || !result.cookie.includes("poolduck_access=")) {
    throw new Error(`Synthetic login failed with HTTP ${result.status}.`);
  }
  return result.cookie;
}

function classify(config, sequence) {
  if (config.scenario !== "mixed") return "valid";
  const bucket = sequence % 10;
  if (bucket === 8) return "unmapped";
  if (bucket === 9) return "suspended";
  return "valid";
}

function summarize(step, records, startedAt, finishedAt) {
  const latencies = records.map((record) => record.durationMs);
  const unexpected = records.filter((record) => !record.expected).length;
  const durationSeconds = Math.max(0.001, (finishedAt - startedAt) / 1_000);
  return {
    concurrency: step,
    duration_seconds: Number(durationSeconds.toFixed(3)),
    requests: records.length,
    requests_per_second: Number((records.length / durationSeconds).toFixed(3)),
    unexpected_count: unexpected,
    unexpected_rate: Number((unexpected / Math.max(1, records.length)).toFixed(6)),
    timeout_or_5xx_count: records.filter(
      (record) => record.timedOut || record.status >= 500 || record.status === 0,
    ).length,
    latency_ms: {
      p50: percentile(latencies, 0.5),
      p95: percentile(latencies, 0.95),
      p99: percentile(latencies, 0.99),
      max: latencies.length > 0 ? Math.max(...latencies) : null,
    },
    result_counts: Object.fromEntries(
      [...new Set(records.map((record) => `${record.kind}:${record.status}`))]
        .sort()
        .map((key) => [key, records.filter((record) => `${record.kind}:${record.status}` === key).length]),
    ),
  };
}

async function runStep(config, step, activeCookies, suspendedCookie, sequenceState) {
  const startedAt = Date.now();
  const stopAt = startedAt + config.stepSeconds * 1_000;
  const records = [];
  let stoppedEarly = false;

  async function virtualUser(index) {
    while (Date.now() < stopAt && !stoppedEarly) {
      const sequence = sequenceState.value;
      sequenceState.value += 1;
      const kind = classify(config, sequence);
      const isSuspended = kind === "suspended";
      const cookie = isSuspended ? suspendedCookie : activeCookies[index];
      const scanCode =
        kind === "valid"
          ? actionCode(config.personPrefix, sequence, config.personCount)
          : kind === "unmapped"
            ? config.unmappedScanCode
            : config.suspendedScanCode;
      const locationCode = isSuspended ? config.suspendedLocationCode : config.locationCode;
      if (kind === "valid") {
        const personOffset = sequence % config.personCount;
        const previousUse = sequenceState.personLastUsedAt.get(personOffset) ?? 0;
        const waitMs = config.personReuseMs - (Date.now() - previousUse);
        if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
        sequenceState.personLastUsedAt.set(personOffset, Date.now());
      }
      const result = await request(config, "/api/scan-events", {
        method: "POST",
        headers: {
          cookie,
          "Idempotency-Key": randomUUID(),
        },
        body: JSON.stringify({ location_id: locationCode, scan_code: scanCode }),
      });
      const expected =
        (kind === "valid" && result.status === 201) ||
        (kind === "unmapped" && result.status === 404 && result.body?.code === "SCAN_CODE_NOT_MAPPED") ||
        (kind === "suspended" && result.status === 403 && result.body?.code === "SUBSCRIPTION_NOT_SENDABLE");
      records.push({ kind, expected, ...result });
      const recent = records.slice(-50);
      const severe = recent.filter(
        (record) => record.timedOut || record.status >= 500 || record.status === 0,
      ).length;
      if (recent.length >= 20 && severe / recent.length >= config.maxUnexpectedRate) {
        stoppedEarly = true;
      }
      if (config.thinkTimeMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, config.thinkTimeMs));
      }
    }
  }

  await Promise.all(Array.from({ length: step }, (_, index) => virtualUser(index)));
  const finishedAt = Date.now();
  const summary = summarize(step, records, startedAt, finishedAt);
  summary.stopped_early = stoppedEarly;
  summary.slo_pass =
    !stoppedEarly &&
    summary.unexpected_rate < config.maxUnexpectedRate &&
    summary.latency_ms.p95 !== null &&
    summary.latency_ms.p95 <= config.p95LimitMs;
  return summary;
}

export async function main(env = process.env) {
  const config = loadConfiguration(env);
  if (config.planOnly) {
    console.log(JSON.stringify({ event: "capacity_load.plan", config: safeConfiguration(config) }, null, 2));
    return;
  }
  if (!config.password || config.password.length < 16) {
    throw new Error("CAPACITY_TEST_PASSWORD must contain at least 16 characters.");
  }
  const health = await request(config, "/health");
  if (health.status !== 200) throw new Error(`Target health check failed with HTTP ${health.status}.`);

  const maxUsers = Math.max(...config.steps);
  const activeCookies = [];
  for (let index = 0; index < maxUsers; index += 1) {
    activeCookies.push(
      await login(config, config.tenantCode, `${config.operatorPrefix}${String(index + 1).padStart(5, "0")}`),
    );
  }
  const suspendedCookie =
    config.scenario === "mixed"
      ? await login(config, config.suspendedTenantCode, config.suspendedIdentifier)
      : "";

  const runStartedAt = new Date().toISOString();
  const sequenceState = { value: 0, personLastUsedAt: new Map() };
  const steps = [];
  for (const step of config.steps) {
    const result = await runStep(config, step, activeCookies, suspendedCookie, sequenceState);
    steps.push(result);
    console.log(JSON.stringify({ event: "capacity_load.step", ...result }));
    if (!result.slo_pass) break;
  }
  console.log(
    JSON.stringify(
      {
        event: "capacity_load.complete",
        run_started_at: runStartedAt,
        run_finished_at: new Date().toISOString(),
        config: safeConfiguration(config),
        steps,
      },
      null,
      2,
    ),
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
