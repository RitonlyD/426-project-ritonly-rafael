# Service Level Objectives

donor-service
Latency SLO: The donor availability lookup endpoint must respond within 300ms at the 95th percentile.The matching service will depend on the call to complete the patient's transfusion window, so a slow lookup here directly delays a match.

Reliability SLO: The donor availability update endpoint must succeed at least 99.5% of the time. A failed update leaves a donor's status stale in the system, which can cause matching service to offer a donor who is not available, or miss somebody who is. This operation is safe under at-least-once delivery.This is because it will set a donor's status to a specific value, so if a retry causes the same update to be applied twice, the donor ends up in the same state either way, and a failed attempt is just annoying rather than incorrect.
