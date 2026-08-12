import http from "node:http";
import { createClient } from "redis";
import client from "prom-client";

const PORT = process.env.PORT || 5100;
const REDIS_URL = process.env.REDIS_URL || "redis://redis:6379";
const CACHE_TTL_SECONDS = 20;
const SERVICE_NAME = "donor-service";

const log = (level, message, fields = {}) => {
  console.log(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      level,
      service: SERVICE_NAME,
      message,
      ...fields,
    }),
  );
};

const register = new client.Registry();
const httpRequestsTotal = new client.Counter({
  name: "http_requests_total",
  help: "Total HTTP requests received",
  labelNames: ["service", "method", "route", "status_code"],
  registers: [register],
});
const httpRequestDuration = new client.Histogram({
  name: "http_request_duration_ms",
  help: "HTTP request duration in milliseconds",
  labelNames: ["service", "method", "route", "status_code"],
  buckets: [50, 100, 200, 300, 400, 500, 750, 1000, 1500, 2000, 3000],
  registers: [register],
});

const redisClient = createClient({ url: REDIS_URL });
redisClient.on("error", (err) =>
  log("error", "redis connection error", { error: err.message }),
);
await redisClient.connect();

const BLOOD_TYPES = ["O-", "O+", "A-", "A+", "B-", "B+", "AB-", "AB+"];
const ANTIGENS = [
  "C",
  "E",
  "c",
  "e",
  "K",
  "Fya",
  "Fyb",
  "Jka",
  "Jkb",
  "S",
  "s",
];
const CLINICS = [
  "BOS-Mass General",
  "WOR-Memorial",
  "BOS-Brigham & Women's",
  "SPR-Baystate Medical",
];

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const random = (n) => Math.floor(Math.random() * n);

const simulateLookupLatency = () => {
  const ms = 80 + random(220);
  return new Promise((resolve) => setTimeout(() => resolve(ms), ms));
};

const makeDonor = (id) => ({
  donorId: `DN-${1000 + id}`,
  bloodType: pick(BLOOD_TYPES),
  phenotype: [`${pick(ANTIGENS)}+`, `${pick(ANTIGENS)}-`],
  clinic: pick(CLINICS),
  lastDonationDate: new Date(Date.now() - random(90) * 86_400_000)
    .toISOString()
    .slice(0, 10),
  available: Math.random() > 0.3,
});

const donors = Array.from({ length: 40 }, (_, i) => makeDonor(i));

let failMode = false;

const readJSON = (req) =>
  new Promise((resolve) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        resolve({});
      }
    });
  });

const server = http.createServer(async (req, res) => {
  const start = process.hrtime.bigint();
  const url = new URL(req.url, "http://localhost");
  const path = url.pathname;
  const method = req.method;

  if (method === "GET" && path === "/metrics") {
    res.writeHead(200, { "Content-Type": register.contentType });
    return res.end(await register.metrics());
  }

  const availabilityMatch = path.match(/^\/donors\/([^/]+)\/availability$/);
  const route =
    path === "/health"
      ? "/health"
      : path === "/admin/fail"
        ? "/admin/fail"
        : path === "/donors/available"
          ? "/donors/available"
          : availabilityMatch
            ? "/donors/:id/availability"
            : "unmatched";

  const send = (code, obj) => {
    res.writeHead(code, { "Content-Type": "application/json" });
    res.end(JSON.stringify(obj));

    const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
    const labels = { service: SERVICE_NAME, method, route, status_code: code };
    httpRequestsTotal.inc(labels);
    httpRequestDuration.observe(labels, durationMs);
    log("info", "request completed", {
      method,
      path,
      statusCode: code,
      responseTimeMs: Math.round(durationMs),
    });
  };

  if (method === "GET" && path === "/health") {
    return send(200, { status: "ok", service: SERVICE_NAME });
  }

  if (method === "POST" && path === "/admin/fail") {
    failMode = !failMode;
    log("info", `fail mode ${failMode ? "on" : "off"}`, { failMode });
    return send(200, { failMode });
  }

  if (method === "GET" && path === "/donors/available") {
    if (failMode) {
      log("warn", "fail mode active, returning 503");
      return send(503, { error: "donor-service unavailable" });
    }

    const bloodType = url.searchParams.get("bloodType") || "any";
    const cacheKey = `donors:available:${bloodType}`;

    const cached = await redisClient.get(cacheKey);
    if (cached) {
      log("info", "cache hit", { cacheKey });
      return send(200, { ...JSON.parse(cached), cache: "HIT" });
    }

    log("info", "cache miss", { cacheKey });
    const latencyMS = await simulateLookupLatency();

    const matches = donors.filter(
      (d) => d.available && (bloodType === "any" || d.bloodType === bloodType),
    );

    const result = {
      bloodType,
      available: matches.length,
      donors: matches.slice(0, 5),
      latencyMS,
    };

    await redisClient.set(cacheKey, JSON.stringify(result), {
      EX: CACHE_TTL_SECONDS,
    });

    return send(200, { ...result, cache: "MISS" });
  }

  if (method === "POST" && availabilityMatch) {
    const donorId = availabilityMatch[1];
    const donor = donors.find((d) => d.donorId === donorId);
    if (!donor) return send(404, { error: "donor not found" });

    const body = await readJSON(req);
    if (typeof body.available !== "boolean") {
      return send(400, { error: "available must be a boolean" });
    }

    donor.available = body.available;
    return send(200, {
      donorId: donor.donorId,
      available: donor.available,
    });
  }

  return send(404, { error: "not found" });
});

server.listen(PORT, () =>
  log("info", `donor-service listening on ${PORT}`),
);
