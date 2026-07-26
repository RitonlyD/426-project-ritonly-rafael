import http from "node:http";

const PORT = process.env.PORT || 5000;
const DONOR = process.env.DONOR_URL || "http://donor-service:5100";
const INVENTORY = process.env.INVENTORY_URL || "http://inventory-service:5200";
const MAX_RETRIES = Number(process.env.MAX_RETRIES || 2);

//idempotent retry
const fetchWithRetry = async (url, label) => {
  for (let attempt = 1; attempt <= MAX_RETRIES + 1; attempt++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(700) });
      if (!r.ok) throw new Error(`status ${r.status}`);
      const data = await r.json();
      console.log(`[ambassador] ${label} ok (attempt ${attempt})`);
      return data;
    } catch (err) {
      console.warn(
        `[ambassador] ${label} attempt ${attempt} failed: ${err.message}`,
      );
      if (attempt === MAX_RETRIES + 1) return null;
    }
  }
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (url.pathname === "/availability") {
    const bloodType = url.searchParams.get("bloodType") || "O-";

    const urgency = url.searchParams.get("urgency") || "routine";

    const primary = urgency === "routine" ? "inventory" : "donor";
    console.log(
      `[ambassador] route bloodType=${bloodType} urgency=${urgency} -> primary=${primary}`,
    );

    const donorUrl = `${DONOR}/donors/available?bloodType=${encodeURIComponent(bloodType)}`;

    const invUrl = `${INVENTORY}/inventory?bloodType=${encodeURIComponent(bloodType)}`;

    const donorRes = await fetchWithRetry(donorUrl, "donor-service");
    const invRes = await fetchWithRetry(invUrl, "inventory-service");

    if (donorRes === null && primary === "donor") {
      console.warn(
        "[ambassador] donor-service unavailable -> failing over to inventory-service",
      );
    }

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        bloodType,
        urgency,
        routedPrimary: primary,
        donors: donorRes?.available ?? 0,
        units: invRes?.available ?? 0,
      }),
    );
    return;
  }
  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "not found" }));
});

server.listen(PORT, () =>
  console.log(`matching-ambassador listening on: ${PORT}`),
);
