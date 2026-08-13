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

## donor-service — GET /donors/available (Redis cache-aside)

Test: `load-tests/sprint-5-load.js`, `donor_cache` scenario — 10 VUs, 60s,
run directly against donor-service. Run against the full Sprint 5 stack
(RabbitMQ async path, real inventory-service, health checks on every
service, Prometheus + Grafana instrumentation).

k6 summary output (2026-08-13), `donor_cache` scenario:

```
  █ THRESHOLDS

    http_req_duration{scenario:donor_cache}
    ✓ 'p(95)<300' p(95)=2.66ms

  █ TOTAL RESULTS

    checks_total.......: 986     15.999962/s
    checks_succeeded...: 100.00% 986 out of 986
    checks_failed......: 0.00%   0 out of 986

    ✓ status is 200

    HTTP
    http_req_duration..............: avg=231.95ms min=225.45µs med=993.2µs  p(90)=664.3ms  p(95)=755.92ms p(99)=870.59ms max=1.05s
      { scenario:donor_cache }.....: avg=7.7ms    min=225.45µs med=626.83µs p(90)=1.44ms   p(95)=2.66ms   p(99)=273.86ms max=318.73ms
    http_req_failed................: 0.00%  0 out of 986
    http_reqs......................: 986    15.999962/s
```

Sample structured log output from the same run:

```json
{"timestamp":"2026-08-13T01:02:31.021Z","level":"info","service":"donor-service","message":"cache hit","cacheKey":"donors:available:O+"}
{"timestamp":"2026-08-13T01:02:31.137Z","level":"info","service":"donor-service","message":"cache hit","cacheKey":"donors:available:A+"}
```

Cross-checked against Prometheus (donor-service's own view of *all* traffic
it received during this run, `donor-service{route="/donors/available"}` —
this includes both the 600 direct k6 requests tagged `donor_cache` and the
386 additional indirect requests `matching-ambassador` made to it while
resolving the `match` scenario's requests): p95 48.98ms, p99 243.61ms, 986
total requests, 0 errors.

### SLO comparison (docs/SLO.md)

- **Latency SLO** (p95 < 300ms): met with wide margin from both views — the
  k6-scenario-only p95 (2.66ms) and the full-traffic Prometheus p95
  (48.98ms) are both far under the 300ms line.
- **Reliability SLO** (99.5% success on the availability-update endpoint):
  not directly exercised by this load test (the test only reads
  `/donors/available`, it doesn't call `POST /donors/:id/availability`),
  but the read path itself succeeded 100% of the time (986/986), so there's
  no evidence against it either.

### Sprint 3 vs. Sprint 5 comparison

|              | Sprint 3 (30s) | Sprint 5 (60s) |
| ------------ | -------------- | -------------- |
| p50          | 2.11ms         | 0.63ms         |
| p95          | 244.65ms       | 2.66ms         |
| p99          | 322ms          | 273.86ms       |
| Request rate | 9.43 req/s     | 10.0 req/s     |
| Error rate   | 0%             | 0%             |

The p95 drop (244.65ms → 2.66ms) is not a system improvement — it's a
measurement artifact of the longer run. Sprint 3's report already flagged
that ~7% of requests are cache misses (the fixed cost of the first request
against each of the 4 blood types after the 20s TTL expires) and that this
fixed miss proportion sits right at the p95 line on a short run. Doubling
the run length to 60s doesn't change the miss rate, but it pushes the same
absolute number of slow misses further down the percentile distribution,
so they no longer land at p95 — they still show up at p99 (273.86ms),
which is barely changed from Sprint 3's p99 (322ms) and is consistent with
the same 80-300ms simulated miss latency as before. The caching behavior
itself hasn't changed; the test duration changed what percentile the
misses land on.

### Interpretation

The cache-aside pattern is working exactly as designed and there is no
new bottleneck here. The real story this sprint is that `donor-service` is
no longer only reached directly by clients — `matching-ambassador` now
calls it on every `match` request too (confirmed by the gap between the
600 k6-tagged requests and the 986 total Prometheus saw). Both call paths
share the same Redis cache and the same 4-blood-type key space, so the
ambassador's traffic is, if anything, *helping* the client-facing p95 by
keeping keys warm. If a future sprint widened the blood-type space (all 8
real types instead of 4, or added phenotype to the cache key), the hit
rate would drop and both p95 and p99 would move back toward Sprint 3's
numbers or worse — the current comfortable margin depends on a narrow key
space, not just on caching existing.

## inventory-service — GET /inventory (indirect, via matching-ambassador)

`inventory-service` isn't hit directly by `load-tests/sprint-5-load.js` —
it's only reached indirectly, the same way `matching-ambassador` is: every
`match` scenario request triggers one ambassador call to
`GET /inventory?bloodType=...`. Cross-checked against Prometheus
(`inventory-service{route="/inventory"}`) for the same run reported above:

- p95: 385.76ms
- p99: 398.47ms
- Total requests: 386 (one per `match` scenario iteration, as expected)
- Errors: 0 (0 of 386)

Sample structured log output from the async reservation path, same run:

```json
{"timestamp":"2026-08-13T01:02:16.695Z","level":"info","service":"inventory-service","message":"processing reserve-unit","requestId":"req-8ca2f574","unitId":"UNIT-514444"}
{"timestamp":"2026-08-13T01:02:16.695Z","level":"warn","service":"inventory-service","message":"reserve-unit failed","requestId":"req-8ca2f574","error":"no matching unit available"}
```

### SLO comparison (docs/SLO.md)

- **Latency SLO** (GET /inventory, p95 < 400ms): met, but only just —
  385.76ms leaves under 4% headroom, and p99 (398.47ms) is essentially
  sitting on the 400ms line.
- **Reliability SLO** (POST /inventory/reserve, 99% success): the
  synchronous endpoint itself wasn't exercised by this load test (only the
  async `reserve-unit` consumer was, via the RabbitMQ path), so this SLO
  isn't directly measured here. Separately, the async reservations
  themselves fail consistently (see Interpretation below) — but that
  failure is a business-logic outcome (`reserved: false`), not an endpoint
  error, and doesn't correspond to what this SLO is measuring.
- No Sprint 3 comparison exists for this service — `inventory-service`
  wasn't built until Sprint 4.

### Interpretation

The near-zero headroom on the latency SLO isn't a load-related bottleneck,
it's arithmetic. `inventory-service`'s simulated lookup latency is drawn
uniformly from `100 + random(300)`, i.e. a flat distribution over
[100ms, 400ms). The 95th percentile of a uniform distribution over that
range is mathematically `100 + 0.95 * 300 = 385ms` regardless of how many
requests hit it or how fast they arrive — which is almost exactly the
385.76ms measured. The 400ms SLO was written as the same number as the
upper bound of the latency simulation itself, which leaves it with
essentially no margin by construction, independent of real load. This
won't get worse under heavier traffic, but it also can't be fixed by
scaling `inventory-service` horizontally the way `matching-service` was in
Sprint 3 — the fix is either widening the SLO's margin against its own
generator (e.g. targeting 450ms) or narrowing the generator's range (e.g.
`100 + random(200)`) so its own p95 sits meaningfully under the target
instead of defining it.

Separately, and consistent with what Sprint 4's report already noted: the
async reservation path fires and completes on every run (confirmed by the
`processing reserve-unit` / `reserve-unit failed` log pairs above,
observable end to end), but the reservation itself fails every time
because `matching-service` sends a fabricated `unitId` rather than a real
one from `inventory-service`'s 60 seeded units. This doesn't affect
`POST /match`'s response or this SLO measurement, but it's a known,
carried-forward gap, not something introduced this sprint.
