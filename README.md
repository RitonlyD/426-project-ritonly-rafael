# 426-project-ritonly-rafael
| Name | GitHub Username | UMass Email |
| :---         |     :---:      |          ---: |
| Rafael Lopes Andrade   | randrade2    | rlopesandrad@umass.edu   |
| Ritonly Daniel     | RitonlyD     | radaniel@umass.edu    |

Our system simulates a blood and sickle cell donor matching and inventory platform. It coordinates donor availability and blood product inventory across multiple partner clinics and hospitals, matching time critical patient requests with compatible, closely matched donors in real time. A single server would not be able to keep up with this load. The system needs to match donors quickly against inventory that is constantly changing across many facilities, while also sending out urgent notifications to donors and clinical staff. Correctness matters a lot here too, since outdated inventory or availability data could mean a patient misses a match their life depends on. This domain matters directly to sickle cell disease patients, a population whose treatment depends on frequent transfusions from closely matched donors, and who have historically been underserved. When the system is slow, unavailable, or wrong, clinics can end up with inaccurate donor availability, which delays or denies a match someone urgently needs. Sickle cell disease also disproportionately affects Black and African American communities, so making this system reliable and fast is not just a technical goal, it is a matter of equity for the people it serves.

## Documentation

- [Project Description](docs/PROJECT.md)
- [Services](docs/SERVICES.md)
- [Service Level Objectives](docs/SLO.md)
- [Sprint 4 failure scenario](results/sprint-4-failure.md)
- [Sprint 5 load test results](results/sprint-5-load-test.md)

## Prerequisites

- Docker and Docker Compose (tested with Docker 29.x / Compose v2)
- No local Node, RabbitMQ, Redis, Prometheus, or Grafana install needed —
  everything runs in containers

## Running the system

```
docker compose up --build
```

This builds and starts every service, including RabbitMQ, Prometheus, and
Grafana. Startup order is enforced by `depends_on: condition: service_healthy`
throughout, so services wait on their real dependencies rather than just a
container starting.

Confirm everything is healthy:

```
docker compose ps
```

Every service should show `(healthy)`. If one doesn't, check its logs with
`docker compose logs <service>` — logs are structured JSON, one line per
request.

Published ports (host → container):

| Port | Service |
| ---- | ------- |
| 4000 | Caddy (entry point — `POST /match`, the main path) |
| 5100 | donor-service |
| 5200 | inventory-service |
| 9090 | Prometheus |
| 3000 | Grafana |

Everything else (`redis`, `rabbitmq`, `matching-ambassador`,
`matching-service-a/b/c`) is internal-only, reachable by other containers on
the compose network but not published to the host.

## Environment Variables

Every variable below has a working default baked into its service, so
`docker compose up` works with zero `.env` configuration. They're listed
here for anyone who wants to point a service at something else (e.g. a real
RabbitMQ instance instead of the containerized one).

### matching-service

| Variable | What it is | Dev default | If missing |
| -------- | ---------- | ------------ | ----------- |
| `PORT` | HTTP listen port | `4000` | Falls back to `4000` |
| `AVAILABILITY_URL` | matching-ambassador's `/availability` endpoint | `http://matching-ambassador:5000/availability` | Falls back to the compose DNS name shown |
| `RABBITMQ_URL` | RabbitMQ connection string used by the `reserve-unit` producer | `amqp://rabbitmq:5672` | Falls back to the compose DNS name shown |
| `REPLICA` | Labels which replica served a request (`a`/`b`/`c`); cosmetic only, doesn't affect behavior | `a` / `b` / `c` (set per-replica in `docker-compose.yml`) | No functional impact — falls back to the container hostname, then `"unknown"`, in the `servedBy` response field and logs |

### matching-ambassador

| Variable | What it is | Dev default | If missing |
| -------- | ---------- | ------------ | ----------- |
| `PORT` | HTTP listen port | `5000` | Falls back to `5000` |
| `DONOR_URL` | donor-service base URL | `http://donor-service:5100` | Falls back to the compose DNS name shown |
| `INVENTORY_URL` | inventory-service base URL | `http://inventory-service:5200` | Falls back to the compose DNS name shown |
| `MAX_RETRIES` | Retry attempts against a downstream service before failing over | `2` | Falls back to `2` |

### donor-service

| Variable | What it is | Dev default | If missing |
| -------- | ---------- | ------------ | ----------- |
| `PORT` | HTTP listen port | `5100` | Falls back to `5100` |
| `REDIS_URL` | Redis connection string used for the cache-aside donor-availability lookup | `redis://redis:6379` | Falls back to the compose DNS name shown |

`donor-service` also has a runtime fault-injection toggle, not an
environment variable — `POST /admin/fail` flips an in-memory flag that
makes `GET /donors/available` return `503` while active. See
[`results/sprint-4-failure.md`](results/sprint-4-failure.md) for the full
scenario and how the rest of the system responds to it.

### inventory-service

| Variable | What it is | Dev default | If missing |
| -------- | ---------- | ------------ | ----------- |
| `PORT` | HTTP listen port | `5200` | Falls back to `5200` |
| `RABBITMQ_URL` | RabbitMQ connection string used by the `reserve-unit` consumer | `amqp://rabbitmq:5672` | Falls back to the compose DNS name shown |

## Observability

- **Grafana**: [http://localhost:3000](http://localhost:3000) —
  `admin` / `admin` (also open to anonymous viewers). The "System Overview"
  dashboard auto-loads on startup with no manual setup: request rate, error
  rate, and p95 latency for `POST /match` (the main path), plus a
  per-replica request-rate panel that doubles as a visual check that Caddy
  is load-balancing correctly.
- **Prometheus**: [http://localhost:9090](http://localhost:9090) — scrapes
  `donor-service`, `inventory-service`, `matching-ambassador`, and all
  three `matching-service` replicas every 10s. Every custom service exposes
  `GET /metrics` directly, so `curl localhost:5100/metrics` etc. works too.
- **Logs**: every custom service logs structured JSON (`timestamp`, `level`,
  `service`, `message`, plus `method`/`path`/`statusCode`/`responseTimeMs`
  on request lines) — `docker compose logs -f <service>` to follow one, or
  pipe through `jq` to filter/pretty-print.

## Running the load test

```
docker run --rm -i --network 426-project-ritonly-rafael_default \
  -e DONOR_URL=http://donor-service:5100 \
  -e BASE_URL=http://caddy:4000 \
  grafana/k6 run - < load-tests/sprint-5-load.js
```

Runs both scenarios (`donor_cache` direct against donor-service,
`match_through_caddy` through the load balancer) for 60s at 10 VUs each.
Full results, SLO comparisons, and an interpretation of where the
bottleneck is now live in
[`results/sprint-5-load-test.md`](results/sprint-5-load-test.md).
