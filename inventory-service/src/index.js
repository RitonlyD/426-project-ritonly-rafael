import http from "node:http";

const PORT = process.env.PORT || 5200;

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

    if (reservations.has(idempotencyKey)) {
      console.log(`[inventory-service] replayed reservation ${idempotencyKey}`);
      return send(res, 200, reservations.get(idempotencyKey));
    }

    const unit = body.unitId
      ? units.find((u) => u.unitId === body.unitId && !u.reserved)
      : units.find((u) => u.bloodType === body.bloodType && !u.reserved);

    if (!unit) {
      const result = { reserved: false, error: "no matching unit available" };
      reservations.set(idempotencyKey, result);
      return send(res, 409, result);
    }

    unit.reserved = true;
    const result = {
      reserved: true,
      unitId: unit.unitId,
      bloodType: unit.bloodType,
      clinic: unit.clinic,
    };
    reservations.set(idempotencyKey, result);
    console.log(`[inventory-service] reserved ${unit.unitId}`);
    return send(res, 200, result);
  }

  return send(res, 404, { error: "not found" });
});

server.listen(PORT, () =>
  console.log(`inventory-service listening on: ${PORT}`),
);
