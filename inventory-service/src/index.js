import http from "node:http";
import amqp from "amqplib";

const PORT = process.env.PORT || 5200;
const RABBITMQ_URL = process.env.RABBITMQ_URL || "amqp://rabbitmq:5672";
const RESERVE_UNIT_QUEUE = "reserve-unit";

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

// Shared by the sync POST /inventory/reserve endpoint and the async
// reserve-unit consumer, both of which apply the same idempotent
// reservation semantics keyed by a caller-supplied key.
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
  console.error(`[inventory-service] rabbitmq error: ${err.message}`),
);
const rabbitChannel = await rabbitConnection.createChannel();
await rabbitChannel.assertQueue(RESERVE_UNIT_QUEUE, { durable: true });

rabbitChannel.consume(RESERVE_UNIT_QUEUE, (msg) => {
  if (!msg) return;

  const message = JSON.parse(msg.content.toString());
  console.log(
    `[inventory-service] processing reserve-unit requestId=${message.requestId} unitId=${message.unitId}`,
  );

  const { result } = applyReservation(message.requestId, message);
  console.log(
    result.reserved
      ? `[inventory-service] reserve-unit applied requestId=${message.requestId} unitId=${result.unitId}`
      : `[inventory-service] reserve-unit failed requestId=${message.requestId}: ${result.error}`,
  );

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

const send = (res, code, obj) => {
  res.writeHead(code, { "Content-Type": "application/json" });
  res.end(JSON.stringify(obj));
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  const path = url.pathname;

  if (req.method === "GET" && path === "/health") {
    return send(res, 200, { status: "ok", service: "inventory-service" });
  }

  if (req.method === "GET" && path === "/inventory") {
    const bloodType = url.searchParams.get("bloodType") || "any";
    const latencyMS = await simulateLookupLatency();

    const matches = units.filter(
      (u) => !u.reserved && (bloodType === "any" || u.bloodType === bloodType),
    );

    return send(res, 200, {
      bloodType,
      available: matches.length,
      units: matches.slice(0, 5),
      latencyMS,
    });
  }

  if (req.method === "POST" && path === "/inventory/reserve") {
    const body = await readJSON(req);
    const idempotencyKey = body.idempotencyKey;

    if (!idempotencyKey) {
      return send(res, 400, { error: "idempotencyKey is required" });
    }

    const { result, replayed } = applyReservation(idempotencyKey, body);

    if (replayed) {
      console.log(`[inventory-service] replayed reservation ${idempotencyKey}`);
      return send(res, 200, result);
    }

    if (!result.reserved) {
      return send(res, 409, result);
    }

    console.log(`[inventory-service] reserved ${result.unitId}`);
    return send(res, 200, result);
  }

  return send(res, 404, { error: "not found" });
});

server.listen(PORT, () =>
  console.log(`inventory-service listening on: ${PORT}`),
);
