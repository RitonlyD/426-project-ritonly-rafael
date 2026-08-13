# Sprint 5 Load Test Summary

## matching-service / matching-ambassador — POST /match (Caddy + replicas)

Test: `load-tests/sprint-5-load.js`, `match_through_caddy` scenario — 10 VUs,
60s, requests sent to Caddy on :4000 and load-balanced across the three
`matching-service` replicas. Run against the full Sprint 5 stack (RabbitMQ
async path, real `inventory-service`, health checks on every service,
Prometheus + Grafana instrumentation).

Full k6 summary output (2026-08-12):

```
  █ THRESHOLDS

    http_req_duration{scenario:donor_cache}
    ✓ 'p(95)<300' p(95)=1.93ms

    http_req_duration{scenario:match}
    ✓ 'p(95)<1000' p(95)=819.02ms
    ✓ 'p(99)<2000' p(99)=932.19ms

    http_req_failed{scenario:match}
    ✓ 'rate<0.01' rate=0.00%


  █ TOTAL RESULTS

    checks_total.......: 984     15.980959/s
    checks_succeeded...: 100.00% 984 out of 984
    checks_failed......: 0.00%   0 out of 984

    ✓ status is 200

    HTTP
    http_req_duration..............: avg=231.89ms min=378.21µs med=1.29ms   p(90)=694.62ms p(95)=766.73ms p(99)=853.12ms max=1.12s
      { expected_response:true }...: avg=231.89ms min=378.21µs med=1.29ms   p(90)=694.62ms p(95)=766.73ms p(99)=853.12ms max=1.12s
      { scenario:donor_cache }.....: avg=5.85ms   min=378.21µs med=951.21µs p(90)=1.45ms   p(95)=1.93ms   p(99)=220.32ms max=291.64ms
      { scenario:match }...........: avg=585.08ms min=253.14ms med=585.43ms p(90)=783.74ms p(95)=819.02ms p(99)=932.19ms max=1.12s
    http_req_failed................: 0.00%  0 out of 984
      { scenario:match }...........: 0.00%  0 out of 384
    http_reqs......................: 984    15.980959/s

    EXECUTION
    iteration_duration.............: avg=1.23s    min=1s       med=1s       p(90)=1.69s    p(95)=1.76s    p(99)=1.85s    max=2.13s
    iterations.....................: 984    15.980959/s
    vus............................: 4      min=4        max=20
    vus_max........................: 20     min=20       max=20

    NETWORK
    data_received..................: 605 kB 9.8 kB/s
    data_sent......................: 125 kB 2.0 kB/s
```

matching-service (383/384 requests, isolated to the `match` scenario): p50
(med) 585ms, p95 819.02ms, p99 932.19ms, 384 requests / 60s ≈ 6.4 req/s,
0% failed.

Cross-checked against Prometheus (the server's own view, queried immediately
after the run, `matching-service{route="/match"}`): p95 897.5ms, 0% error
rate, request rate ~0.55-0.67 req/s per replica (roughly even across
`matching-service-a/b/c`, confirming Caddy is still load-balancing evenly).
`matching-ambassador{route="/availability"}`: p95 391.4ms.

### SLO comparison (docs/SLO.md)

- **matching-service latency SLO** (p95 < 1000ms, p99 < 2000ms): both met,
  but with far less headroom than Sprint 3 — p95 819ms is now within ~18%
  of the 1000ms line, versus Sprint 3's p95 543ms (46% headroom).
- **matching-service reliability SLO** (99% success): met — 100% success at
  this load level, same as every prior sprint.
- **matching-ambassador** has no SLO of its own in `docs/SLO.md` (it's the
  request-routing layer in front of donor-service/inventory-service, not a
  named SLO target), but its own p95 (391ms, from Prometheus) is a useful
  data point for the bottleneck analysis below.

### Sprint 3 vs. Sprint 5 comparison

|              | Sprint 3   | Sprint 5  |
| ------------ | ---------- | --------- |
| p50          | 337ms      | 585ms     |
| p95          | 543ms      | 819ms     |
| p99          | 752ms      | 932ms     |
| Request rate | 7.53 req/s | 6.4 req/s |
| Error rate   | 0%         | 0%        |

Latency moved up across the board — p95 grew ~51%, p99 ~24% — and
throughput dropped slightly (7.53 → 6.4 req/s) even though the VU count and
sleep pattern are unchanged. Error rate held at 0%.

### Interpretation

The Sprint 3 report predicted exactly this outcome. At the time,
`inventory-service` didn't exist, so `matching-ambassador`'s calls to it
failed instantly with a DNS error rather than consuming their retry
timeout budget — the report flagged that "if inventory-service is added in
Sprint 4 and its retry timeouts start actually being hit... that
unconditional sequential await is what would push p95 toward the SLO
line," and recommended parallelizing the ambassador's donor/inventory
calls with `Promise.all` pre-emptively. That fix was never made — this
sprint's own `matching-ambassador/src/index.js` still does:

```js
const donorRes = await fetchWithRetry(donorUrl, "donor-service");
const invRes = await fetchWithRetry(invUrl, "inventory-service");
```

sequentially, not concurrently. With `inventory-service` now real and
answering in ~100-400ms (its own simulated lookup latency) rather than
failing in a few milliseconds, the ambassador's own p95 (391ms, measured
directly from its Prometheus histogram) now reflects two real network
round trips paid one after another instead of one. That 391ms is added on
top of `matching-service`'s own 120-500ms simulated DB latency, which is
_also_ awaited sequentially after the ambassador call returns — the two
stack up to comfortably explain the observed 819-932ms p95/p99 band.

The bottleneck isn't Caddy, the replicas, or RabbitMQ: replica request
rates stayed even (~0.55-0.67 req/s each) confirming the load balancer is
still working correctly, and the async `reserve-unit` path added
negligible latency to the response path since matching-service enqueues
and returns without waiting on `inventory-service` to consume it (log
evidence: `enqueued reserve-unit requestId=req-b7cd129c unitId=UNIT-782913`
in matching-service's log, `processing reserve-unit requestId=req-b7cd129c`
in inventory-service's log a fraction of a second later, decoupled from the
HTTP response that had already been sent). The bottleneck is the
still-sequential `donorRes` → `invRes` await chain inside
`matching-ambassador`, exactly as flagged two sprints ago and never
addressed. With another sprint, parallelizing that one await chain with
`Promise.all` would be the single highest-leverage change: it would cut
the ambassador's own contribution roughly in half and pull p95 back toward
Sprint 3's comfortable headroom instead of the current ~18% margin against
the 1000ms SLO.

(Note: a meaningful fraction of `reserve-unit` messages fail to apply —
`inventory-service` logs `reserve-unit failed ... no matching unit
available` for these — because `matching-service` generates a synthetic
random `unitId` for `inventory_unit` matches rather than reserving one of
`inventory-service`'s actual 60 seeded units. This is expected, pre-existing
behavior from Sprint 4, not a regression introduced by this load test; it
doesn't affect the `POST /match` response, which returns successfully
either way, so it isn't reflected in the 0% error rate above.)
