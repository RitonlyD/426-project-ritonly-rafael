# Service Level Objectives

**donor-service**

Latency SLO: The donor availability lookup endpoint must respond within 300ms at the 95th percentile.The matching service will depend on the call to complete the patient's transfusion window, so a slow lookup here directly delays a match.

Reliability SLO: The donor availability update endpoint must succeed at least 99.5% of the time. A failed update leaves a donor's status stale in the system, which can cause matching service to offer a donor who is not available, or miss somebody who is. This operation is safe under at-least-once delivery.This is because it will set a donor's status to a specific value, so if a retry causes the same update to be applied twice, the donor ends up in the same state either way, and a failed attempt is just annoying rather than incorrect.

**matching-service**

Latency SLO: The match request endpoints (POST/match) have to responde within 1000ms at the 95th percentile, and within 2000ms at the 99th percentile. A clinic staff submitting a patients transfusion request is waiting on this response in real time to find out whether a compatible donor or unit is availble. When that threshold is exceeded, the staff will fall back to phone coordination across partner clinics, which is the slow, error-prone, system/probelm that this systems aims to replace.

Reliabibilty SLO: The match request endpoint must succeed at least 99% of the time. A match request is safe under at-least-once delivery at the request level but much be at-most-once athe reservation level. This is because if matching service instance fails midway through a request, the request itself can be safely retried against other instances, ensuring that the patient is not completely and silently dropped from this request. The reservation that is produced by this request against a donor or unit must be guarded by an idempotency key so that a retry does not double-book the same unit for two different patients. A lost request is a missed match, while a double-booked reservation banks on inventory that is not available, which is worse than a slow service.

**inventory-service**

Latency SLO: The inventory lookup endpoint (GET/inventory) must respond within 400ms at the 95th percentile. The matchinh service calls this while routing a patient request to find a unit of the correct blood type and phenotype. A slow lookup, in this context stalls the match and leaves the clinical staff waiting on an amswer for a patient who needs bloody urgently.

Reliability SLO: The unit reservation endpoint(POST/inventory/reserve) must succeed at least 99% of the time. This must be handled as at-most-once using an idempotency key, as unline a status update, reserving a unit is not naturally idemponent. If a retry applied the same reservation twice, the system would count a unit as reserved even though it is not there, routing two patients towards the same blood. A failed reservation can be accepted, however a fake promise of available blood by a double reservation is a serious problem.
