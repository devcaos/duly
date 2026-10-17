# Sample documents

Clearly fictional documents for the PaperTrail demo (SPEC.md section 8). Every brand,
person, address and number is made up, and every page carries a "SAMPLE" mark.

Documents 1-6 match the seed data in `lib/storage/seed.ts` (same issuers, amounts,
numbers and day offsets). Document 7 is extra, for the live upload demo.

**Generated on 2026-10-17.** Dates are relative to that day, like the seed. Regenerate on
demo day so the dates on paper match the seed and every deadline is upcoming:

```bash
npm run samples
```

The script (`scripts/generate-samples.mjs`) uses Google Chrome or Chromium in headless
mode. If it can't find the browser, set `CHROME_PATH` to its executable.

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
