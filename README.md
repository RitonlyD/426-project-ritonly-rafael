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
