# Services

donor-service: Manages donor profiles, phenotype and blood type data, availability status, and accepts registration and availability update requests.

matching-service: Recieves the incoming patient transfusions requests and matches each patient to a compatible, available donor or inventory unit in real time. Coordinates reservations across clinics to prevent double-booking.

inventory-service: Keeps a track of 'Blood Units' by blood type and phenotype at each of our partner clinics. Accepts reservation, update, and query requests.

## System Diagram

Services built as of Sprint 3: `donor-service` and `matching-service`,
connected through the `matching-ambassador` (ambassador pattern sitting in
front of `matching-service`). `donor-service` now caches its availability
lookups in Redis (cache-aside, keyed by blood type). `matching-service` is
being placed behind Caddy as a load balancer across replicas this sprint,
shown as planned until that lands. `inventory-service` is not built yet
(deferred to Sprint 4) and is shown as planned only.

```mermaid
flowchart LR
    Client([Clinic staff / client])

    subgraph Caddy_LB[Caddy load balancer - planned]
        direction LR
        Matching1[matching-service #1]
        Matching2[matching-service #2]
    end

    subgraph matching-service pod
        Ambassador[matching-ambassador]
    end

    Donor[donor-service]
    DonorCache[(Redis cache)]
    Inventory[inventory-service<br/>planned - Sprint 4]

    Client -->|POST /match| Caddy_LB
    Matching1 -->|GET /availability| Ambassador
    Matching2 -->|GET /availability| Ambassador
    Ambassador -->|GET /donors/available| Donor
    Donor <-->|cache-aside| DonorCache
    Ambassador -.->|GET /inventory| Inventory

    style Inventory stroke-dasharray: 5 5
    style Caddy_LB stroke-dasharray: 5 5
```
