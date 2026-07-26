import http from "node:http";

const PORT = process.env.PORT || 4000;
const AVAILABILITY_URL =
  process.env.AVAILABILITY_URL || "http://localhost:5000/availability"; // amb pattern, sharing this and listening on localhost:5000

const simulateDBLatency = () => {
  const ms = 120 + Math.floor(Math.random() * 380);
  return new Promise((resolve) => setTimeout(() => resolve(ms), ms));
}; //latency

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
const Partner_CLINICS = [
  "BOS-Mass General",
  "WOR-Memorial",
  "BOS-Brigham & Women's",
  "SPR-Baystate Medical",
];

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const random = (n) => Math.floor(Math.random() * n);

const getAvailability = async (query) => {
  try {
    const url =
      `${AVAILABILITY_URL}?bloodType=${encodeURIComponent(query.bloodType)}` +
      `&urgency=${encodeURIComponent(query.urgency)}`;

    const r = await fetch(url, { signal: AbortSignal.timeout(800) });
    if (!r.ok) throw new Error(`ambassador ${r.status}`);
    return { source: "Ambassador", ...(await r.json()) };
  } catch (err) {
    console.warn(
      `[matching] availability lookup failed (${err.message}); synthetic fallback`,
    );
    return { source: "synthetic-fallback", donors: random(4), units: random(6) };
  }
};

const buildMatch = (request, availability) => {
  const preferDonor =
    request.urgency === "critical" || availability.units === 0;
  const matchType =
    preferDonor && availability.donors > 0 ? "donor" : "inventory_unit";

  const score = Number((0.82 + Math.random() * 0.18).toFixed(2));

  const common = {
    matchType,
    bloodType: request.bloodType,
    phenotypeCompatibility: score > 0.95 ? "full" : "partial",
    matchScore: score,
    availabilitySource: availability.source,
  };

  if (matchType === "donor") {
    return {
      ...common,
      donorId: `DN-${1000 + random(9000)}`,
      distanceKM: Number((Math.random() * 40).toFixed(1)),
      readyBy: new Date(Date.now() + 3_600_000).toISOString(),
    };
  }

  return {
    ...common,
    unitId: `UNIT-${100000 + random(900000)}`,
    clinic: pick(Partner_CLINICS),
    expiresOn: new Date(Date.now() + 14 + 86_400_000)
      .toISOString()
      .slice(0, 10),
  };
};

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
  const path = req.url.split("?")[0];

  if (req.method === "GET" && path === "/health") {
    return send(res, 200, { status: "ok", service: "matching-service" });
  }

  if (req.method === "POST" && path === "/match") {
    const body = await readJSON(req);
    const request = {
      patientId: body.patientId || `PT-${10000 + random(90000)}`,
      bloodType: body.bloodType || pick(BLOOD_TYPES),
      phenotype: body.phenotype || [`${pick(ANTIGENS)}-`, `${pick(ANTIGENS)}-`],
      urgency: body.urgency || pick(["routine", "urgent", "critical"]),
    };

    const availability = await getAvailability(request);
    const latencyMS = await simulateDBLatency();
    return send(res, 200, {
      requestId: `req-${Math.random().toString(16).slice(2, 10)}`,
      patient: request,
      match: buildMatch(request, availability),
      matchedAt: new Date().toISOString(),
      latencyMS,
    });
  }

  return send(res, 404, { error: "not found" });
});

server.listen(PORT, () =>
  console.log(`matching-service listening on: ${PORT}`),
);
