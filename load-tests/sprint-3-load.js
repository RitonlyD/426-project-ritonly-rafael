import http from "k6/http";
import { check, sleep } from "k6";

const DONOR_URL = __ENV.DONOR_URL || "http://localhost:5100";
const BASE_URL = __ENV.BASE_URL || "http://localhost:4000";
const BLOOD_TYPES = ["O-", "O+", "A+", "B-"];
const URGENCIES = ["routine", "urgent", "critical"];

export const options = {
  summaryTrendStats: ["avg", "min", "med", "p(90)", "p(95)", "p(99)", "max"],
  scenarios: {
    donor_cache: {
      executor: "constant-vus",
      exec: "donorCache",
      vus: 10,
      duration: "30s",
      tags: { scenario: "donor_cache" },
    },
    match_through_caddy: {
      executor: "constant-vus",
      exec: "matchThroughCaddy",
      vus: 10,
      duration: "30s",
      tags: { scenario: "match" },
    },
  },
  thresholds: {
    "http_req_duration{scenario:donor_cache}": ["p(95)<300"],
    "http_req_duration{scenario:match}": ["p(95)<1000", "p(99)<2000"],
    "http_req_failed{scenario:match}": ["rate<0.01"],
  },
};

export function donorCache() {
  const bloodType = BLOOD_TYPES[Math.floor(Math.random() * BLOOD_TYPES.length)];
  const res = http.get(
    `${DONOR_URL}/donors/available?bloodType=${encodeURIComponent(bloodType)}`,
    { tags: { scenario: "donor_cache" } },
  );
  check(res, { "status is 200": (r) => r.status === 200 });
  sleep(1);
}

export function matchThroughCaddy() {
  const bloodType = BLOOD_TYPES[Math.floor(Math.random() * BLOOD_TYPES.length)];
  const urgency = URGENCIES[Math.floor(Math.random() * URGENCIES.length)];
  const res = http.post(
    `${BASE_URL}/match`,
    JSON.stringify({ bloodType, urgency }),
    {
      headers: { "Content-Type": "application/json" },
      tags: { scenario: "match" },
    },
  );
  check(res, { "status is 200": (r) => r.status === 200 });
  sleep(1);
}
