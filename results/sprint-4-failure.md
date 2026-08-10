# Sprint 4 Failure Scenario

## What the scenario is

`donor-service` has a fault-injection toggle. When enabled, its
`GET /donors/available` endpoint immediately returns `503 Service
Unavailable` instead of doing a lookup, simulating the donor-availability
system going down while the rest of the platform keeps running.

## How to trigger it

Toggle it on with a request to the service itself:

```
curl -X POST http://donor-service:5100/admin/fail
```

The response echoes the new state, e.g. `{"failMode":true}`. Calling the
same endpoint again toggles it back off. No restart is required either
way; the flag is in-memory and takes effect on the next request.

## How the system responds

We tested this against the full running stack by sending
`POST /match` requests through `matching-service` before, during, and
after toggling `donor-service`'s fail mode.

**Before (baseline):** a match request for a critical, O- patient resolved
normally through `donor-service`:

```
[ambassador] donor-service ok (attempt 1)
[ambassador] inventory-service ok (attempt 1)
```

**During the failure:** the same request pattern produced:

```
[ambassador] donor-service attempt 1 failed: status 503
[ambassador] donor-service attempt 2 failed: status 503
[ambassador] donor-service attempt 3 failed: status 503
[ambassador] inventory-service ok (attempt 1)
[ambassador] donor-service unavailable -> failing over to inventory-service
```

`matching-ambassador`'s existing retry logic (built in Sprint 2) retried
`donor-service` three times, then logged the failover and fell back to
`inventory-service`. The client-facing `POST /match` request still
returned a valid 200 response with a real matched blood unit
(`matchType: "inventory_unit"`) instead of failing outright. The system
degraded gracefully: donor matching became temporarily unavailable, but
patients could still be matched against inventory.

**After toggling fail mode back off:** the very next request succeeded
against `donor-service` again (`donor-service ok (attempt 1)`), with no
manual recovery step needed.

## What a real system would do differently in production

Our ambassador retries `donor-service` on every single request, even
during a sustained outage, which wastes time and load on a service that
is known to be down. A production system would add a circuit breaker in
front of `donor-service`: after a run of consecutive failures, the
ambassador would stop calling it directly for a cooldown window and go
straight to the inventory fallback, then periodically probe
`donor-service` to see if it has recovered. A production system would
also page an on-call engineer once the failure rate crosses a threshold,
rather than silently and indefinitely falling back, since prolonged
donor-matching unavailability is a real degradation in patient care that
someone needs to act on, not just route around.
