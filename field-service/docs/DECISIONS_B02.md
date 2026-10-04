# B02 decisions — equipment (2026-10-04)

| # | Topic | Decision | Why |
|---|---|---|---|
| 1 | Minimum data | Category is required; nickname, brand, model, serial, install date and photos are optional. Categories in the app: air conditioner, water filter, CCTV, solar, water pump, refrigeration, other (the API accepts any short code). | Functional §7.1–7.2: faded or missing nameplates must not block work. |
| 2 | Camera first | The add-equipment screen starts with a nameplate photo (camera, library or skip), then an optional equipment photo, then the fields. Photos go through the A04 upload (GPS stripped, resized). | Functional §7.2, UI §7.2 S02. |
| 3 | OCR never blocks | After a nameplate upload the app requests OCR and keeps the form usable. Results appear as suggestions under each field ("use this" / "use what was read in empty fields"); nothing is filled or overwritten without a tap. No provider, no quota or a failure just shows "type it in". | Functional §7.3. |
| 4 | Confirmed values | When equipment is created from an OCR request, `accepted_fields` stores what the person confirmed next to the raw suggestion, and the request is linked to the equipment. | DB §6.5. |
| 5 | Serials | Stored as typed. `serial_normalized` (upper case, letters and digits) only helps find candidates; look-alike characters (O/0, I/1) are not guessed — the form reminds the user to check them. Not unique. | Functional §7.3–7.4. |
| 6 | Duplicates | Same normalized serial at the same location, or (without a serial) same category + brand + model + nickname, returns `DUPLICATE_WARNING` with candidates. The user opens the existing one or confirms a different unit. No merge. | Functional §7.4, UI S10. |
| 7 | Retries | `request_key` per new equipment; "add another" starts a new key, so several units can be added in a row without creating the customer or place again. | Functional §7.2. |
| 8 | Scope | Equipment and its photos follow location visibility (restrictive RLS). Technicians may attach only photos they uploaded; they can open photos of equipment they can see. | DB §8. |
| 9 | Plan state | Creating, editing and adding photos need a writable plan. | A03. |

Not in B02: moving equipment between locations, retiring equipment from the app, QR stickers (future), installation records (a service type in B04).
