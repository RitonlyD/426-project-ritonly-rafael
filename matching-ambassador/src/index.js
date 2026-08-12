import http from "node:http";
import client from "prom-client";

const PORT = process.env.PORT || 5000;
const DONOR = process.env.DONOR_URL || "http://donor-service:5100";
const INVENTORY = process.env.INVENTORY_URL || "http://inventory-service:5200";
const MAX_RETRIES = Number(process.env.MAX_RETRIES || 2);
const SERVICE_NAME = "matching-ambassador";

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

//idempotent retry
const fetchWithRetry = async (url, label) => {
  for (let attempt = 1; attempt <= MAX_RETRIES + 1; attempt++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(700) });
      if (!r.ok) throw new Error(`status ${r.status}`);
      const data = await r.json();
      log("info", `${label} ok`, { attempt });
      return data;
    } catch (err) {
      log("warn", `${label} attempt failed`, { attempt, error: err.message });
      if (attempt === MAX_RETRIES + 1) return null;
    }
  }
};

const server = http.createServer(async (req, res) => {
  const start = process.hrtime.bigint();
  const url = new URL(req.url, "http://localhost");
  const path = url.pathname;
  const method = req.method;

  if (method === "GET" && path === "/metrics") {
    res.writeHead(200, { "Content-Type": register.contentType });
    return res.end(await register.metrics());
  }

  const route =
    path === "/health"
      ? "/health"
      : path === "/availability"
        ? "/availability"
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

  if (path === "/availability") {
    const bloodType = url.searchParams.get("bloodType") || "O-";
    const urgency = url.searchParams.get("urgency") || "routine";
    const primary = urgency === "routine" ? "inventory" : "donor";
    log("info", "routing decision", { bloodType, urgency, primary });

    const donorUrl = `${DONOR}/donors/available?bloodType=${encodeURIComponent(bloodType)}`;
    const invUrl = `${INVENTORY}/inventory?bloodType=${encodeURIComponent(bloodType)}`;

    const donorRes = await fetchWithRetry(donorUrl, "donor-service");
    const invRes = await fetchWithRetry(invUrl, "inventory-service");

    if (donorRes === null && primary === "donor") {
      log("warn", "donor-service unavailable, failing over to inventory-service");
    }

    return send(200, {
      bloodType,
      urgency,
      routedPrimary: primary,
      donors: donorRes?.available ?? 0,
      units: invRes?.available ?? 0,
    });
  }

  return send(404, { error: "not found" });
});

server.listen(PORT, () =>
  log("info", `matching-ambassador listening on ${PORT}`),
);
