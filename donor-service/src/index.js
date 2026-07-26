import http from "node:http";

const PORT = process.env.PORT || 5100;

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

// models the donor-availability lookup this service's SLO targets: 300ms p95
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
    return send(res, 200, { status: "ok", service: "donor-service" });
  }

  if (req.method === "GET" && path === "/donors/available") {
    const bloodType = url.searchParams.get("bloodType");
    const latencyMS = await simulateLookupLatency();

    const matches = donors.filter(
      (d) => d.available && (!bloodType || d.bloodType === bloodType),
    );

    return send(res, 200, {
      bloodType: bloodType || "any",
      available: matches.length,
      donors: matches.slice(0, 5),
      latencyMS,
    });
  }

  const availabilityMatch = path.match(/^\/donors\/([^/]+)\/availability$/);
  if (req.method === "POST" && availabilityMatch) {
    const donorId = availabilityMatch[1];
    const donor = donors.find((d) => d.donorId === donorId);
    if (!donor) return send(res, 404, { error: "donor not found" });

    const body = await readJSON(req);
    if (typeof body.available !== "boolean") {
      return send(res, 400, { error: "available must be a boolean" });
    }

    donor.available = body.available;
    return send(res, 200, {
      donorId: donor.donorId,
      available: donor.available,
    });
  }

  return send(res, 404, { error: "not found" });
});

server.listen(PORT, () =>
  console.log(`donor-service listening on: ${PORT}`),
);
