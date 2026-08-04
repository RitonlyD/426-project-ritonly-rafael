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

## matching-service — POST /match (Caddy + replicas)

Test: `load-tests/sprint-3-load.js`, `match_through_caddy` scenario — 10 VUs,
30s, requests sent to Caddy on :4000 and load-balanced across the three
`matching-service` replicas.

Results (k6, 2026-08-04):

- p50: 1.13s
- p95: 1.28s
- p99: 1.3s
- Request rate: 4.97 req/s (149 requests / 30s)
- Error rate: 0% (0 of 149 requests failed; all checks passed)

SLO comparison (docs/SLO.md, matching-service):

- Latency SLO (p95 < 1000ms, p99 < 2000ms): p99 met (1.3s), p95 not met
  (1.28s vs. a 1000ms target).
- Reliability SLO (99% success): met — 100% success at this load level.

Interpretation: every request lands in a narrow 1.1-1.3s band regardless of
urgency or blood type, which is the signature of a fixed cost applied to
every request rather than variance in matching-service's own work.
Tracing it down: matching-ambassador's `/availability` handler awaits the
donor-service lookup and then, sequentially, an inventory-service lookup
with up to 3 retries at a 700ms timeout each — but inventory-service isn't
built yet (deferred to Sprint 4), so that call always fails and eats a
chunk of that timeout budget before falling back. That's added on top of
matching-service's own 120-500ms simulated latency, which is enough by
itself to explain why p95 clears the p99 target (2000ms) comfortably but
misses the tighter p95 target (1000ms). The bottleneck isn't Caddy or the
replicas — round-robining across three instances didn't change per-request
latency, it just added throughput headroom — it's the ambassador's
unconditional, sequential call to a service that doesn't exist yet. Sprint
5's async + resilience work should either short-circuit or parallelize
(`Promise.all`) the donor/inventory calls instead of awaiting them one
after another; that alone should bring p95 back under target without
touching the replication or caching patterns.

