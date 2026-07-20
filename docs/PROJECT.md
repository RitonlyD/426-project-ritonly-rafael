# The Project Description

Domain
Our system simulates a blood and sickle cell donor matching and inventory
platform. It coordinates donor availability and blood product inventory
across a network of clinics and hospitals, and matches incoming
patient transfusion requests to closely matched donors or
inventory units in real time. This system serves the
clinical staff at facilities who need an accurate view of
of donor and inventory availability, and sickle
cell disease patients, whose transfusions depend on timely correctly matched blood.

Scalability Problem
This domain requires a scalable distributed web system for multiple reasons. When the demand begins to spike a system that is sized for average load will queue or drop requests exactly when speed matters most.  If the matching service goes down while an urgent request is in flight, a patient's request needs to fail over to another instance or be retried safely rather than  completely lost. This means that the system needs redundancy and idempotent retry behavior rather than a single point of failure.
Data consistency across nodes is a real problem that should be handled carefully.Donor availability and inventory counts are held and updated by multiple clinics at once. Two clinics could try to reserve the same donor or the same unit of blood for two different patients at nearly the same moment. Without coordination across nodes, the system can double book a donor or report inventory that does not actually exist,which is worse than being slow.

Computing for the Common Good
When this system works correctly, the people who benefit are sickle cell disease patients who get matched to a compatible donor as soon as possible. When the system fails or is slow, the sickle cell disease patients are the ones who are harmed the most. Since sickle cell disease disproportionately affects Black and African American communities,that makes the
latency and reliability requirements defined in this project not just technical targets, but a direct expression of who this system is built to protect.
