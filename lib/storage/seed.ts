import type { Document } from "@/lib/types";
import { addDays } from "@/lib/dates";

// Six fictional sample documents (SPEC.md section 8).
// All dates are relative to `today`, so the deadlines are always upcoming.
export function buildSeedDocuments(today: string): Document[] {
  const d = (days: number) => addDays(today, days);
  const createdAt = `${today}T09:00:00.000Z`;
  const base = { householdId: "demo", createdAt };

  return [
    {
      ...base,
      id: "doc-brightwave-bill",
      type: "bill",
      title: "Brightwave Energy electricity bill (SAMPLE)",
      issuer: "Brightwave Energy",
      issueDate: d(-12),
      amount: 84.2,
      currency: "USD",
      deadlines: [
        {
          date: d(9),
          kind: "payment_due",
          description: "Pay electricity bill",
          amount: 84.2,
          currency: "USD",
        },
      ],
      summary:
        "Monthly electricity bill for 412 kWh. Total due $84.20. A $10 late fee applies if paid after the due date.",
      actionItems: [
        "Pay $84.20 before the due date (online, by phone or by direct debit).",
        "Account number BW-4471-2209 is needed to pay.",
      ],
      rawText: `SAMPLE - Brightwave Energy. Electricity bill. Account BW-4471-2209. Usage: 412 kWh. Amount due: $84.20. Due date: ${d(9)}. Late payment fee: $10.00.`,
    },
    {
      ...base,
      id: "doc-northpoint-car-insurance",
      type: "insurance",
      title: "Northpoint Mutual car insurance renewal (SAMPLE)",
      issuer: "Northpoint Mutual",
      issueDate: d(-9),
      amount: 612,
      currency: "USD",
      deadlines: [
        {
          date: d(21),
          kind: "renewal",
          description: "Car insurance policy renews automatically",
          amount: 612,
          currency: "USD",
        },
      ],
      summary:
        "Annual car insurance renewal notice for policy NM-88213. The premium goes up from $548 to $612 and renews automatically unless you cancel or change it.",
      actionItems: [
        "Compare quotes before the renewal date if the new premium is too high.",
        "Call Northpoint Mutual at 1-800-555-0142 to change or cancel the policy.",
      ],
      rawText: `SAMPLE - Northpoint Mutual. Car insurance renewal notice. Policy NM-88213. Vehicle: 2019 hatchback. New annual premium: $612.00 (previous: $548.00). Renewal date: ${d(21)}. The policy renews automatically.`,
    },
    {
      ...base,
      id: "doc-homehub-dishwasher",
      type: "warranty",
      title: "HomeHub Appliances dishwasher receipt (SAMPLE)",
      issuer: "HomeHub Appliances",
      issueDate: d(-400),
      amount: 549.99,
      currency: "USD",
      product: "dishwasher",
      deadlines: [
        {
          date: d(330),
          kind: "warranty_ends",
          description: "2-year dishwasher warranty ends",
        },
      ],
      summary:
        "Purchase receipt for a QuietClean 45 dishwasher, $549.99, with a 2-year manufacturer warranty covering parts and labor.",
      actionItems: [
        "To claim: call HomeHub Appliances at 1-800-555-0177 or visit homehub.example/warranty.",
        "Have the receipt number HH-55021 and the dishwasher serial number ready.",
      ],
      rawText: `SAMPLE - HomeHub Appliances. Receipt HH-55021. Date: ${d(-400)}. QuietClean 45 dishwasher, $549.99. Includes 2-year warranty (parts and labor) until ${d(330)}. Warranty claims: 1-800-555-0177.`,
    },
    {
      ...base,
      id: "doc-maplewood-parking",
      type: "official_letter",
      title: "City of Maplewood parking notice (SAMPLE)",
      issuer: "City of Maplewood",
      issueDate: d(-3),
      amount: 45,
      currency: "USD",
      deadlines: [
        {
          date: d(12),
          kind: "payment_due",
          description: "Pay parking fine or file an appeal",
          amount: 45,
          currency: "USD",
        },
      ],
      summary:
        "Parking violation notice for parking in a street-cleaning zone. The fine is $45 and doubles to $90 if not paid or appealed by the deadline.",
      actionItems: [
        "Pay $45 online with notice number PK-30918, or",
        "File an appeal by the same date if you think the ticket is wrong.",
      ],
      rawText: `SAMPLE - City of Maplewood, Parking Services. Notice PK-30918. Violation: parking during street cleaning. Fine: $45.00. Pay or appeal by ${d(12)}. After this date the fine increases to $90.00.`,
    },
    {
      ...base,
      id: "doc-peakfit-renewal",
      type: "subscription",
      title: "PeakFit gym membership auto-renewal (SAMPLE)",
      issuer: "PeakFit",
      issueDate: d(-5),
      amount: 39.99,
      currency: "USD",
      deadlines: [
        {
          date: d(4),
          kind: "reply_by",
          description: "Last day to cancel before the gym membership renews",
        },
        {
          date: d(6),
          kind: "renewal",
          description: "Gym membership renews",
          amount: 39.99,
          currency: "USD",
        },
      ],
      summary:
        "Your PeakFit membership renews automatically at $39.99 per month. To avoid the charge you must cancel at least 2 days before the renewal date.",
      actionItems: [
        "Cancel in the PeakFit app or at the front desk before the cancel-by date if you don't want to renew.",
      ],
      rawText: `SAMPLE - PeakFit. Membership auto-renewal reminder. Member ID PF-7730. Monthly fee: $39.99. Renewal date: ${d(6)}. Cancel by ${d(4)} to avoid being charged.`,
    },
    {
      ...base,
      id: "doc-maplewood-field-trip",
      type: "school",
      title: "Maplewood Elementary field-trip form (SAMPLE)",
      issuer: "Maplewood Elementary",
      issueDate: d(-2),
      amount: 15,
      currency: "USD",
      deadlines: [
        {
          date: d(5),
          kind: "reply_by",
          description: "Return signed field-trip form and pay fee",
          amount: 15,
          currency: "USD",
        },
        {
          date: d(18),
          kind: "appointment",
          description: "Field trip to the Maplewood Science Museum",
        },
      ],
      summary:
        "Permission form for the 3rd-grade field trip to the Maplewood Science Museum. Return the signed form and the $15 fee to the teacher.",
      actionItems: [
        "Sign the permission form.",
        "Send the form and $15 to school with your child before the deadline.",
      ],
      rawText: `SAMPLE - Maplewood Elementary School. Field trip permission form. Grade 3, Science Museum visit on ${d(18)}. Fee: $15.00. Return signed form and fee by ${d(5)}.`,
    },
  ];
}
