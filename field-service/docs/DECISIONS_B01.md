# B01 decisions — customers and locations (2026-10-04)

| # | Topic | Decision | Why |
|---|---|---|---|
| 1 | Identity of a customer | Phone is the main search key and is stored normalized (E.164). Name is optional; the app shows the formatted phone when there is no name and never invents one. A customer needs a name or a phone. | Functional §5.1. |
| 2 | Duplicates | Phones are not unique. Creating with a phone already used returns 409 `DUPLICATE_WARNING` with the existing customers; the user picks one or confirms a new customer (`confirm_duplicate`). No automatic merge. | Functional §5.1, DB §4.1. |
| 3 | Retries | Customer and location creation take a client `request_key`; the same key returns the same row (double tap, network retry). | UI §6.1 J02. |
| 4 | First location | Creating a customer can include the first location in the same transaction. A location needs a label; address, travel note and coordinates are optional. | UI §6.1 J04: no GPS required to create work. |
| 5 | Technician scope | Owners see all customers and locations of the shop. Technicians see only the customers they created (on-site flow) and their locations — enforced by a restrictive RLS policy, not only in the API. B03 will add customers of jobs assigned to the technician. | DB §8: least privilege for technicians. |
| 6 | Coordinates | Saved only by `PUT …/locations/:id/coordinates` after an explicit tap: `current_location` (read once) or `manual_pin`. Replacing existing coordinates needs `replace_existing` and the current version; both saving and replacing are audited with the previous value. There is no endpoint that receives a technician's position over time. | Functional §6, DB §4.2. |
| 7 | GPS in the app | expo-location with the "while using the app" permission only; Android/iOS background location disabled in app.json. The position is read once when the user taps "save this place's location", shown with its accuracy (> 50 m flagged), and saved only after confirmation. Denied or failed reads let the user continue. | Functional §6.1. |
| 8 | Navigation | Google Maps search URL with the saved coordinates; without coordinates it searches the address and the app says it may be inaccurate. | Functional §6.2. |
| 9 | Plan state | Creating or changing customers/locations needs a writable plan (`SUBSCRIPTION_EXPIRED` otherwise); reading always works. Archive (owner only) hides from new work and keeps history. | A03, Functional §22. |

Not in B01: equipment (B02), jobs (B03), manual pin on a map (needs a map component; the API already accepts `manual_pin`), merging customers.
