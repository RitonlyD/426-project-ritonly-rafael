# Services

donor-service: Manages donor profiles, phenotype and blood type data, availability status, and accepts registration and availability update requests.

matching-service: Recieves the incoming patient transfusions requests and matches each patient to a compatible, available donor or inventory unit in real time. Coordinates reservations across clinics to prevent double-booking.

inventory-service: Keeps a track of 'Blood Units' by bllod type and phenotype at each of our partner clinics. Accepts reservation, update, and query requests.

## System Diagram

Services built as of Sprint 2: `donor-service` and `matching-service`, connected
through the `matching-ambassador` (ambassador pattern sitting in front of
`matching-service`). `inventory-service` is not built yet (deferred to
Sprint 4) and is shown as planned only.

```mermaid
flowchart LR
    Client([Clinic staff / client])

    subgraph matching-service pod
        Ambassador[matching-ambassador]
        Matching[matching-service]
    end

    Donor[donor-service]
    Inventory[inventory-service<br/>planned - Sprint 4]

    Client -->|POST /match| Matching
    Matching -->|GET /availability| Ambassador
    Ambassador -->|GET /donors/available| Donor
    Ambassador -.->|GET /inventory| Inventory

    style Inventory stroke-dasharray: 5 5
```
