# Sprint 3 Load Test Summary

## donor-service — GET /donors/available (Redis cache-aside)

Test: `load-tests/sprint-3-load.js`, `donor_cache` scenario — 10 VUs, 30s, run
directly against donor-service (this endpoint is not behind Caddy; the
load-balanced path is matching-service, see below).

Results (k6, 2026-08-03):

- p50: 2.11ms
- p95: 244.65ms
- p99: 322ms
- Request rate: 9.43 req/s
- Error rate: 0% (0 of 292 requests failed; all checks passed)
- Cache hit rate: ~93% (551 HIT / 43 MISS across test runs, logged server-side)

SLO comparison (docs/SLO.md, donor-service):

- Latency SLO (300ms p95): met, but narrowly. A separate run measured
  p95=122.96ms, so there's real run-to-run variance. p99 (322ms) is already
  past the 300ms line.
- Reliability SLO (99.5% success): met — 100% success at this load level.

Interpretation: the cache-aside pattern works as intended — hits return in
~0.3-2ms while misses take the full 80-300ms simulated lookup plus a Redis
round trip, so the bottleneck is the miss path, not Redis. Because roughly
7% of requests are always misses, the aggregate p95 sits right at the edge
of the 300ms target instead of comfortably under it, and any request that
lands on a miss near the tail pushes p99 past the line. With only 4 blood
types and 10 VUs querying about once a second, keys mostly stay warm inside
the 20s TTL, but a real deployment with a wider spread of query keys would
see a lower hit rate and a worse p95/p99. To reliably clear p99, the next
change would be lowering the miss-path latency ceiling or lengthening the
TTL, not anything about the caching approach itself.

