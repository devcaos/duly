# Sample documents

Clearly fictional documents for the Duly demo (SPEC.md section 8). Every brand,
person, address and number is made up, and every page carries a "SAMPLE" mark.

Documents 1-6 match the seed data in `lib/storage/seed.ts` (same issuers, amounts,
numbers and day offsets). Document 7 is extra, for the live upload demo. The seed also has
eight documents without a sample file (see "Seed-only documents" below).

**Generated on 2026-10-17.** The dates printed on these files are fixed: they were relative to
that day. The server's sample documents are different: they are rebuilt from today's date on
every read, so they move every day. If you upload a sample file whose printed due date has
already passed, the saved document will not show an upcoming deadline. Regenerate the files
so the dates on paper match the seed on a given day:

```bash
npm run samples                                              # dates relative to today
SAMPLES_TODAY=2026-10-23 npm run samples                     # fixed base date (macOS / Linux)
$env:SAMPLES_TODAY="2026-10-23"; npm run samples             # fixed base date (Windows PowerShell)
```

The script (`scripts/generate-samples.mjs`) uses a Chromium-based browser (Chrome,
Chromium, Brave or Edge) in headless mode. If it can't find one, set `CHROME_PATH` to its executable.

Use the tables below to check extraction accuracy. For deadlines, the word in
parentheses after the fact name is the deadline `kind` the extractor should return.

## Brightwave Energy electricity bill

Files: `01-brightwave-electricity-bill.png`  
Seed document: `doc-brightwave-bill`

| Fact | Expected value |
| --- | --- |
| Type | bill |
| Issuer | Brightwave Energy |
| Account number | BW-4471-2209 |
| Issue date | 2026-10-05 (today - 12) |
| Usage | 412 kWh |
| Amount due | $84.20 USD |
| Due date (payment_due) | 2026-10-26 (today + 9) |
| Late payment fee | $10.00 |

## Northpoint Mutual car insurance renewal

Files: `02-northpoint-car-insurance-renewal.png`  
Seed document: `doc-northpoint-car-insurance`

| Fact | Expected value |
| --- | --- |
| Type | insurance |
| Issuer | Northpoint Mutual |
| Policy number | NM-88213 |
| Issue date | 2026-10-08 (today - 9) |
| Vehicle | 2019 hatchback |
| New annual premium | $612.00 USD (previous: $548.00) |
| Renewal date (renewal) | 2026-11-07 (today + 21), renews automatically |
| Phone | 1-800-555-0142 |

## HomeHub Appliances dishwasher receipt with 2-year warranty

Files: `03-homehub-dishwasher-receipt.png`  
Seed document: `doc-homehub-dishwasher`

| Fact | Expected value |
| --- | --- |
| Type | warranty |
| Issuer | HomeHub Appliances |
| Receipt number | HH-55021 |
| Purchase date | 2025-09-12 (today - 400) |
| Product | QuietClean 45 dishwasher |
| Amount | $549.99 USD |
| Warranty | 2 years, parts and labor |
| Warranty ends (warranty_ends) | 2027-09-12 (today + 330) |
| Warranty claims | 1-800-555-0177, homehub.example/warranty |

## City of Maplewood parking violation notice

Files: `04-maplewood-parking-notice.png`, `04-maplewood-parking-notice.pdf`  
Seed document: `doc-maplewood-parking`

| Fact | Expected value |
| --- | --- |
| Type | official_letter |
| Issuer | City of Maplewood (Parking Services) |
| Notice number | PK-30918 |
| Issue date | 2026-10-14 (today - 3) |
| Violation | Parking during street cleaning |
| Fine | $45.00 USD |
| Pay or appeal by (payment_due) | 2026-10-29 (today + 12) |
| Fine after deadline | $90.00 |

## PeakFit gym membership auto-renewal reminder

Files: `05-peakfit-membership-renewal.png`  
Seed document: `doc-peakfit-renewal`

| Fact | Expected value |
| --- | --- |
| Type | subscription |
| Issuer | PeakFit |
| Member ID | PF-7730 |
| Issue date | 2026-10-12 (today - 5) |
| Monthly fee | $39.99 USD |
| Cancel by (reply_by) | 2026-10-21 (today + 4) |
| Renewal date (renewal) | 2026-10-23 (today + 6) |

## Maplewood Elementary field-trip permission form

Files: `06-maplewood-elementary-field-trip.png`  
Seed document: `doc-maplewood-field-trip`

| Fact | Expected value |
| --- | --- |
| Type | school |
| Issuer | Maplewood Elementary |
| Issue date | 2026-10-15 (today - 2) |
| Event | Grade 3 field trip to the Maplewood Science Museum |
| Fee | $15.00 USD |
| Return form and fee by (reply_by) | 2026-10-22 (today + 5) |
| Trip date (appointment) | 2026-11-04 (today + 18) |

## Riverside Water Company water bill (live upload demo, not in the seed)

Files: `07-riverside-water-bill.png`, `07-riverside-water-bill.pdf`  
**Not in the seed.** Use it for the live upload demo (`add_document`).

| Fact | Expected value |
| --- | --- |
| Type | bill |
| Issuer | Riverside Water Company |
| Account number | RW-1180-33 |
| Issue date | 2026-10-17 (today) |
| Usage | 4,200 gallons |
| Amount due | $56.75 USD |
| Due date (payment_due) | 2026-10-31 (today + 14, "pay within 14 days") |
| Late fee | $5.00 |

## Seed-only documents (no sample file)

These documents are only in `lib/storage/seed.ts`, for `check_warranty`, `compare_bills` and
`weekly_brief`. Offsets are days from today.

| Seed document | What it is | Key facts |
| --- | --- | --- |
| `doc-visionmax-tv` | VisionMax 55-inch TV receipt | Receipt VM-20417, bought today - 200, $649.00, 3-year warranty ends today + 895 (active) |
| `doc-frostline-fridge` | FrostLine refrigerator receipt (product `fridge`) | Receipt FL-88310, bought today - 345, $1,199.00, 1-year warranty ends today + 20 (expiring soon) |
| `doc-aquaspin-washer` | AquaSpin washing machine receipt | Receipt AS-41562, bought today - 760, $479.00, 2-year warranty ended today - 30 (expired) |
| `doc-pinewood-laptop` | Pinewood Computers laptop receipt | Receipt PW-60294, bought today - 365, $899.00, 2-year warranty ends today + 365 (active) |
| `doc-brightwave-bill-prev-1` | Earlier Brightwave Energy bill, paid | Issued today - 42, $70.10, 340 kWh, no deadlines |
| `doc-brightwave-bill-prev-2` | Earlier Brightwave Energy bill, paid | Issued today - 73, $68.40, 336 kWh, no deadlines |
| `doc-riverside-water-prev-1` | Earlier Riverside Water Company bill, paid | Issued today - 30, $55.90, 4,100 gallons, no deadlines |
| `doc-riverside-water-prev-2` | Earlier Riverside Water Company bill, paid | Issued today - 61, $54.30, 3,950 gallons, no deadlines |

Expected comparisons: Brightwave $84.20 is about 22% higher than the usual $69.25 (average of
$70.10 and $68.40) and $14.10 more than the previous bill. After uploading sample 7 ($56.75),
Riverside is about the same as usual ($55.10).

Usage (stored in the seed only; `add_document` does not extract it): the latest Brightwave bill
(412 kWh) uses about 22% more than the usual 338 kWh, at about the same price per kWh ($0.204
vs $0.205), so `compare_bills` says "You used about 22% more electricity than usual, at about the
same price per kWh." Sample 7 is saved without usage, so the Riverside comparison uses amounts only.
