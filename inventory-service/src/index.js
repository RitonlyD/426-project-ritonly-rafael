import http from "node:http";
import amqp from "amqplib";
import client from "prom-client";

const PORT = process.env.PORT || 5200;
const RABBITMQ_URL = process.env.RABBITMQ_URL || "amqp://rabbitmq:5672";
const RESERVE_UNIT_QUEUE = "reserve-unit";
const SERVICE_NAME = "inventory-service";

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
  const ms = 100 + random(300);
  return new Promise((resolve) => setTimeout(() => resolve(ms), ms));
};

const makeUnit = (id) => ({
  unitId: `UNIT-${100000 + id}`,
  bloodType: pick(BLOOD_TYPES),
  phenotype: [`${pick(ANTIGENS)}+`, `${pick(ANTIGENS)}-`],
  clinic: pick(CLINICS),
  expiresOn: new Date(Date.now() + (7 + random(21)) * 86_400_000)
    .toISOString()
    .slice(0, 10),
  reserved: false,
});

const units = Array.from({ length: 60 }, (_, i) => makeUnit(i));
const reservations = new Map();

const applyReservation = (key, { unitId, bloodType }) => {
  if (reservations.has(key)) {
    return { result: reservations.get(key), replayed: true };
  }

  const unit = unitId
    ? units.find((u) => u.unitId === unitId && !u.reserved)
    : units.find((u) => u.bloodType === bloodType && !u.reserved);

  if (!unit) {
    const result = { reserved: false, error: "no matching unit available" };
    reservations.set(key, result);
    return { result, replayed: false };
  }

  unit.reserved = true;
  const result = {
    reserved: true,
    unitId: unit.unitId,
    bloodType: unit.bloodType,
    clinic: unit.clinic,
  };
  reservations.set(key, result);
  return { result, replayed: false };
};

const rabbitConnection = await amqp.connect(RABBITMQ_URL);
rabbitConnection.on("error", (err) =>
  log("error", "rabbitmq connection error", { error: err.message }),
);
const rabbitChannel = await rabbitConnection.createChannel();
await rabbitChannel.assertQueue(RESERVE_UNIT_QUEUE, { durable: true });

rabbitChannel.consume(RESERVE_UNIT_QUEUE, (msg) => {
  if (!msg) return;

  const message = JSON.parse(msg.content.toString());
  log("info", "processing reserve-unit", {
    requestId: message.requestId,
    unitId: message.unitId,
  });

  const { result } = applyReservation(message.requestId, message);
  if (result.reserved) {
    log("info", "reserve-unit applied", {
      requestId: message.requestId,
      unitId: result.unitId,
    });
  } else {
    log("warn", "reserve-unit failed", {
      requestId: message.requestId,
      error: result.error,
    });
  }

  rabbitChannel.ack(msg);
});

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

  const route =
    path === "/health"
      ? "/health"
      : path === "/inventory"
        ? "/inventory"
        : path === "/inventory/reserve"
          ? "/inventory/reserve"
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

  if (method === "GET" && path === "/inventory") {
    const bloodType = url.searchParams.get("bloodType") || "any";
    const latencyMS = await simulateLookupLatency();

    const matches = units.filter(
      (u) => !u.reserved && (bloodType === "any" || u.bloodType === bloodType),
    );

    return send(200, {
      bloodType,
      available: matches.length,
      units: matches.slice(0, 5),
      latencyMS,
    });
  }

  if (method === "POST" && path === "/inventory/reserve") {
    const body = await readJSON(req);
    const idempotencyKey = body.idempotencyKey;

    if (!idempotencyKey) {
      return send(400, { error: "idempotencyKey is required" });
    }

    const { result, replayed } = applyReservation(idempotencyKey, body);

    if (replayed) {
      log("info", "replayed reservation", { idempotencyKey });
      return send(200, result);
    }

    if (!result.reserved) {
      return send(409, result);
    }

    log("info", "reserved unit", { unitId: result.unitId });
    return send(200, result);
  }

  return send(404, { error: "not found" });
});

server.listen(PORT, () =>
  log("info", `inventory-service listening on ${PORT}`),
);
