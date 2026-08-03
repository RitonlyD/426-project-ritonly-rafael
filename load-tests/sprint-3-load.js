import http from "k6/http";
import { check, sleep } from "k6";

const DONOR_URL = __ENV.DONOR_URL || "http://localhost:5100";
const BLOOD_TYPES = ["O-", "O+", "A+", "B-"];

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
  },
  thresholds: {
    "http_req_duration{scenario:donor_cache}": ["p(95)<300"],
  },
};

export function donorCache() {
  const bloodType = BLOOD_TYPES[Math.floor(Math.random() * BLOOD_TYPES.length)];
  const res = http.get(
    `${DONOR_URL}/donors/available?bloodType=${bloodType}`,
    { tags: { scenario: "donor_cache" } },
  );
  check(res, { "status is 200": (r) => r.status === 200 });
  sleep(1);
}
