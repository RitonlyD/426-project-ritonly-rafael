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

Results (k6, 2026-08-04, re-measured against a fresh stack):

- p50: 337ms
- p95: 543ms
- p99: 752ms
- Request rate: 7.53 req/s (226 requests / 30s)
- Error rate: 0% (0 of 226 requests failed; all checks passed)

Numbers were reproduced across four separate 30s runs (isolated and combined
with the donor_cache scenario); p95 landed between 490-543ms and p99 between
666-752ms each time.

SLO comparison (docs/SLO.md, matching-service):

- Latency SLO (p95 < 1000ms, p99 < 2000ms): both met, with meaningful
  headroom (p95 543ms vs. 1000ms target; p99 752ms vs. 2000ms target).
- Reliability SLO (99% success): met — 100% success at this load level.

Interpretation: matching-ambassador's `/availability` handler awaits the
donor-service lookup, then an inventory-service lookup with up to 3 retries
at a 700ms timeout each. inventory-service isn't built yet (deferred to
Sprint 4), so it was expected that this retry loop would dominate latency —
but the ambassador's own logs show each attempt failing with `fetch failed`
(a DNS resolution error) in a few milliseconds, not after the full 700ms
timeout, so the three retries add negligible latency in practice. The real
fixed cost is simpler: matching-service's own 120-500ms simulated latency,
awaited sequentially after the ambassador round trip (which itself ranges
~1-300ms depending on whether donor-service's cache hits). That sum lines up
with the observed 337-543ms band. The bottleneck isn't Caddy or the
replicas — round-robining across three instances didn't change per-request
latency, it just added throughput headroom. If inventory-service is added in
Sprint 4 and its retry timeouts start actually being hit (real network calls
instead of instant DNS failures), that unconditional sequential await is
what would push p95 toward the SLO line; parallelizing the donor/inventory
calls (`Promise.all`) now would remove that risk pre-emptively.

