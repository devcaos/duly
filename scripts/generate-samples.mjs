// Generates the fictional sample documents in /samples (SPEC.md section 8).
// Usage:
//   npm run samples
// Needs Node 22+ and Google Chrome or Chromium installed (no extra npm packages).
// If it is not found automatically, set CHROME_PATH to the browser executable.
//
// The facts (issuers, amounts, numbers, day offsets) are the same as in
// lib/storage/seed.ts. Dates are relative to the day the script runs, like the
// seed, so run it again on demo day to keep every deadline upcoming.
// If you change seed.ts, change the matching document here too.

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(ROOT, "samples");
const PAGE_WIDTH = 816; // US Letter at 96 dpi (8.5 x 11 in)
const PAGE_HEIGHT = 1056;
const SCALE = 1.5; // PNG is 1224 x 1584 px: sharp enough to read, small enough (< 1 MB)
const MAX_PNG_BYTES = 1024 * 1024;

// ---------- Dates and money (same rules as lib/dates.ts) ----------

const today = new Date().toISOString().slice(0, 10);

function d(days) {
  const date = new Date(`${today}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

// "November 14, 2026"
function long(iso) {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

// "11/14/2026"
function short(iso) {
  const [y, m, day] = iso.split("-");
  return `${m}/${day}/${y}`;
}

function money(amount) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount);
}

// ---------- Shared page parts ----------

const BASE_CSS = `
  @page { size: Letter; margin: 0; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #fff; }
  body {
    width: ${PAGE_WIDTH}px; height: ${PAGE_HEIGHT}px; overflow: hidden; position: relative;
    font-family: "Helvetica Neue", Helvetica, Arial, "Liberation Sans", sans-serif;
    font-size: 13px; line-height: 1.45; color: #1f2328;
    padding: 48px 64px;
  }
  h1, h2, h3, p { margin: 0; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; padding-bottom: 14px; border-bottom: 3px solid var(--accent); }
  .brand { display: flex; align-items: center; gap: 12px; }
  .brand-name { font-size: 22px; font-weight: 700; color: var(--accent); letter-spacing: -0.3px; }
  .brand-tag { font-size: 11px; color: #57606a; }
  .sender { text-align: right; font-size: 11px; color: #57606a; line-height: 1.5; }
  .title { margin-top: 22px; font-size: 20px; font-weight: 700; }
  .subtitle { color: #57606a; margin-top: 2px; }
  .row { display: flex; gap: 24px; margin-top: 20px; }
  .col { flex: 1; }
  .label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.6px; color: #57606a; }
  .value { font-weight: 600; }
  .box { border: 1px solid #d0d7de; border-radius: 6px; padding: 12px 14px; }
  .highlight { background: var(--tint); border-color: var(--accent); }
  .big { font-size: 26px; font-weight: 700; color: var(--accent); }
  table { width: 100%; border-collapse: collapse; margin-top: 8px; }
  th { text-align: left; font-size: 10px; text-transform: uppercase; letter-spacing: 0.6px; color: #57606a; border-bottom: 1px solid #d0d7de; padding: 6px 4px; }
  td { padding: 7px 4px; border-bottom: 1px solid #eaeef2; }
  td.num, th.num { text-align: right; white-space: nowrap; }
  tr.total td { font-weight: 700; border-top: 2px solid #1f2328; border-bottom: none; }
  .section { margin-top: 22px; }
  .section h3 { font-size: 13px; margin-bottom: 6px; color: var(--accent); }
  .letter p { margin-top: 10px; }
  .small { font-size: 11px; color: #57606a; }
  .notice { margin-top: 16px; padding: 10px 14px; border-left: 4px solid #cf222e; background: #fff5f5; }
  .stub { position: absolute; left: 64px; right: 64px; bottom: 70px; border-top: 2px dashed #8c959f; padding-top: 14px; }
  .stub-cut { position: absolute; top: -10px; left: 0; background: #fff; padding-right: 8px; font-size: 10px; color: #8c959f; }
  .line { display: inline-block; border-bottom: 1px solid #1f2328; min-width: 220px; height: 18px; vertical-align: bottom; }
  .footer { position: absolute; left: 64px; right: 64px; bottom: 24px; font-size: 9.5px; color: #8c959f; text-align: center; border-top: 1px solid #eaeef2; padding-top: 8px; }
  .watermark {
    position: absolute; top: 18px; right: 22px; transform: rotate(8deg);
    border: 2px solid rgba(207, 34, 46, 0.55); color: rgba(207, 34, 46, 0.6);
    font-weight: 800; font-size: 13px; letter-spacing: 3px; padding: 2px 8px; border-radius: 4px;
  }
`;

function page({ accent, tint, body }) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<style>:root { --accent: ${accent}; --tint: ${tint}; } ${BASE_CSS}</style>
</head><body>
<div class="watermark">SAMPLE</div>
${body}
<div class="footer">SAMPLE &middot; Fictional document created for the Duly demo. All names, numbers and addresses are made up.</div>
</body></html>`;
}

function header({ logo, name, tag, senderLines }) {
  return `<div class="header">
  <div class="brand">${logo}<div><div class="brand-name">${name}</div><div class="brand-tag">${tag}</div></div></div>
  <div class="sender">${senderLines.join("<br>")}</div>
</div>`;
}

function recipient(lines) {
  return `<div class="col"><div class="label">To</div><div>${lines.join("<br>")}</div></div>`;
}

function field(label, value) {
  return `<div><span class="label">${label}</span><br><span class="value">${value}</span></div>`;
}

const HOUSEHOLD = ["Alex Rivera", "27 Willow Lane", "Maplewood, ST 00000"];

// Simple inline SVG logos (no images to download).
const logos = {
  bolt: (c) => `<svg width="40" height="40" viewBox="0 0 40 40"><circle cx="20" cy="20" r="19" fill="${c}"/><path d="M22 6 L11 23 H19 L17 34 L29 16 H21 Z" fill="#fff"/></svg>`,
  shield: (c) => `<svg width="40" height="40" viewBox="0 0 40 40"><path d="M20 3 L35 9 V19 C35 28 28 35 20 38 C12 35 5 28 5 19 V9 Z" fill="${c}"/><path d="M13 20 L18 25 L28 14" stroke="#fff" stroke-width="3.5" fill="none"/></svg>`,
  house: (c) => `<svg width="40" height="40" viewBox="0 0 40 40"><rect width="40" height="40" rx="8" fill="${c}"/><path d="M8 21 L20 10 L32 21 M12 18 V31 H28 V18" stroke="#fff" stroke-width="3" fill="none"/></svg>`,
  city: (c) => `<svg width="44" height="44" viewBox="0 0 44 44"><circle cx="22" cy="22" r="21" fill="none" stroke="${c}" stroke-width="2"/><circle cx="22" cy="22" r="16" fill="${c}"/><path d="M12 30 V20 L17 16 L22 20 V30 M22 30 V13 H31 V30" stroke="#fff" stroke-width="2" fill="none"/></svg>`,
  peak: (c) => `<svg width="40" height="40" viewBox="0 0 40 40"><rect width="40" height="40" rx="20" fill="${c}"/><path d="M6 30 L16 13 L22 22 L26 17 L34 30 Z" fill="#fff"/></svg>`,
  apple: (c) => `<svg width="40" height="40" viewBox="0 0 40 40"><rect width="40" height="40" rx="6" fill="${c}"/><path d="M20 14 C14 10 8 14 9 22 C10 30 15 34 20 31 C25 34 30 30 31 22 C32 14 26 10 20 14 Z" fill="#fff"/><path d="M20 14 C20 10 22 7 25 6" stroke="#fff" stroke-width="2" fill="none"/></svg>`,
  drop: (c) => `<svg width="40" height="40" viewBox="0 0 40 40"><circle cx="20" cy="20" r="19" fill="${c}"/><path d="M20 7 C20 7 11 18 11 24 A9 9 0 0 0 29 24 C29 18 20 7 20 7 Z" fill="#fff"/></svg>`,
};

// ---------- The documents ----------
// Each document has: file name, formats, the HTML, and the key facts for README.md.

const documents = [
  {
    file: "01-brightwave-electricity-bill",
    formats: ["png"],
    title: "Brightwave Energy electricity bill",
    seedId: "doc-brightwave-bill",
    facts: [
      ["Type", "bill"],
      ["Issuer", "Brightwave Energy"],
      ["Account number", "BW-4471-2209"],
      ["Issue date", `${d(-12)} (today - 12)`],
      ["Usage", "412 kWh"],
      ["Amount due", "$84.20 USD"],
      ["Due date (payment_due)", `${d(9)} (today + 9)`],
      ["Late payment fee", "$10.00"],
    ],
    html: page({
      accent: "#d97706",
      tint: "#fff8eb",
      body: `
${header({
  logo: logos.bolt("#d97706"),
  name: "Brightwave Energy",
  tag: "Power for every home",
  senderLines: ["Brightwave Energy Customer Care", "PO Box 4400, Sunvale, ST 00000", "1-800-555-0110", "brightwave.example"],
})}
<div class="title">Your Electricity Bill</div>
<div class="row">
  ${recipient(HOUSEHOLD)}
  <div class="col box">
    ${field("Account number", "BW-4471-2209")}
    <div style="margin-top:6px">${field("Bill date", long(d(-12)))}</div>
    <div style="margin-top:6px">${field("Billing period", `${short(d(-42))} &ndash; ${short(d(-13))}`)}</div>
  </div>
  <div class="col box highlight">
    <div class="label">Amount due</div>
    <div class="big">${money(84.2)}</div>
    <div class="label" style="margin-top:6px">Due date</div>
    <div class="value">${long(d(9))}</div>
  </div>
</div>
<div class="section">
  <h3>Usage this period</h3>
  <table>
    <tr><th>Meter</th><th>Previous reading</th><th>Current reading</th><th class="num">Usage</th></tr>
    <tr><td>E-209917</td><td>31,588</td><td>32,000</td><td class="num">412 kWh</td></tr>
  </table>
</div>
<div class="section">
  <h3>Charges</h3>
  <table>
    <tr><th>Description</th><th class="num">Amount</th></tr>
    <tr><td>Energy charge: 412 kWh &times; $0.155</td><td class="num">${money(63.86)}</td></tr>
    <tr><td>Monthly service charge</td><td class="num">${money(12)}</td></tr>
    <tr><td>Taxes and fees</td><td class="num">${money(8.34)}</td></tr>
    <tr class="total"><td>Total amount due</td><td class="num">${money(84.2)}</td></tr>
  </table>
</div>
<div class="notice">Please pay by <b>${long(d(9))}</b>. A <b>late payment fee of $10.00</b> will be added if we do not receive your payment by the due date.</div>
<div class="section small">Ways to pay: online at brightwave.example/pay, by phone at 1-800-555-0110, or set up direct debit. Have your account number ready.</div>
<div class="stub">
  <span class="stub-cut">&#9986; Detach and return with your payment</span>
  <div class="row" style="margin-top:4px">
    ${field("Account number", "BW-4471-2209")}
    ${field("Due date", long(d(9)))}
    ${field("Amount due", money(84.2))}
    ${field("Amount enclosed", '<span class="line" style="min-width:120px"></span>')}
  </div>
</div>`,
    }),
  },
  {
    file: "02-northpoint-car-insurance-renewal",
    formats: ["png"],
    title: "Northpoint Mutual car insurance renewal",
    seedId: "doc-northpoint-car-insurance",
    facts: [
      ["Type", "insurance"],
      ["Issuer", "Northpoint Mutual"],
      ["Policy number", "NM-88213"],
      ["Issue date", `${d(-9)} (today - 9)`],
      ["Vehicle", "2019 hatchback"],
      ["New annual premium", "$612.00 USD (previous: $548.00)"],
      ["Renewal date (renewal)", `${d(21)} (today + 21), renews automatically`],
      ["Phone", "1-800-555-0142"],
    ],
    html: page({
      accent: "#1d4ed8",
      tint: "#eff4ff",
      body: `
${header({
  logo: logos.shield("#1d4ed8"),
  name: "Northpoint Mutual",
  tag: "Auto &middot; Home &middot; Life",
  senderLines: ["Northpoint Mutual Insurance Co.", "1200 Harbor Way, Bayfield, ST 00000", "1-800-555-0142", "northpoint.example"],
})}
<div class="row">
  ${recipient(HOUSEHOLD)}
  <div class="col" style="text-align:right">
    ${field("Date", long(d(-9)))}
    <div style="margin-top:6px">${field("Policy number", "NM-88213")}</div>
  </div>
</div>
<div class="title">Your Car Insurance Renewal Notice</div>
<div class="letter">
  <p>Dear Alex Rivera,</p>
  <p>Thank you for insuring your vehicle with Northpoint Mutual. Your auto policy <b>NM-88213</b> is due for renewal. Your policy <b>will renew automatically on ${long(d(21))}</b> and the new premium will be charged to your payment method on file.</p>
</div>
<div class="row">
  <div class="col box">${field("Insured vehicle", "2019 hatchback")}</div>
  <div class="col box">${field("Current annual premium", money(548))}</div>
  <div class="col box highlight"><div class="label">New annual premium</div><div class="big">${money(612)}</div></div>
</div>
<div class="section">
  <h3>Renewal summary</h3>
  <table>
    <tr><th>Item</th><th class="num">Details</th></tr>
    <tr><td>Renewal date</td><td class="num">${long(d(21))}</td></tr>
    <tr><td>New policy period</td><td class="num">12 months</td></tr>
    <tr><td>Coverage</td><td class="num">Liability, collision, comprehensive</td></tr>
    <tr><td>Previous annual premium</td><td class="num">${money(548)}</td></tr>
    <tr class="total"><td>New annual premium</td><td class="num">${money(612)}</td></tr>
  </table>
</div>
<div class="letter">
  <p><b>Why did my premium change?</b> Premiums are reviewed every year based on repair costs and claims in your area.</p>
  <p><b>You don't need to do anything</b> to keep your coverage. If you want to change or cancel your policy, please call us at <b>1-800-555-0142</b> before the renewal date.</p>
  <p>Sincerely,<br><b>Northpoint Mutual Renewals Team</b></p>
</div>`,
    }),
  },
  {
    file: "03-homehub-dishwasher-receipt",
    formats: ["png"],
    title: "HomeHub Appliances dishwasher receipt with 2-year warranty",
    seedId: "doc-homehub-dishwasher",
    facts: [
      ["Type", "warranty"],
      ["Issuer", "HomeHub Appliances"],
      ["Receipt number", "HH-55021"],
      ["Purchase date", `${d(-400)} (today - 400)`],
      ["Product", "QuietClean 45 dishwasher"],
      ["Amount", "$549.99 USD"],
      ["Warranty", "2 years, parts and labor"],
      ["Warranty ends (warranty_ends)", `${d(330)} (today + 330)`],
      ["Warranty claims", "1-800-555-0177, homehub.example/warranty"],
    ],
    html: page({
      accent: "#0f766e",
      tint: "#ecfdf8",
      body: `
${header({
  logo: logos.house("#0f766e"),
  name: "HomeHub Appliances",
  tag: "Kitchen &middot; Laundry &middot; Home",
  senderLines: ["HomeHub Appliances &ndash; Store #218", "88 Market Street, Maplewood, ST 00000", "1-800-555-0177", "homehub.example"],
})}
<div class="title">Sales Receipt</div>
<div class="row">
  ${recipient(HOUSEHOLD)}
  <div class="col box">
    ${field("Receipt number", "HH-55021")}
    <div style="margin-top:6px">${field("Purchase date", long(d(-400)))}</div>
    <div style="margin-top:6px">${field("Payment", "Card ending 0000")}</div>
  </div>
</div>
<div class="section">
  <h3>Items</h3>
  <table>
    <tr><th>Item</th><th>Qty</th><th class="num">Price</th></tr>
    <tr><td>QuietClean 45 dishwasher<br><span class="small">Model QC-45, stainless steel</span></td><td>1</td><td class="num">${money(549.99)}</td></tr>
    <tr><td>Delivery and installation</td><td>1</td><td class="num">${money(0)}</td></tr>
    <tr class="total"><td colspan="2">Total paid (tax included)</td><td class="num">${money(549.99)}</td></tr>
  </table>
</div>
<div class="section box highlight">
  <h3>2-Year Manufacturer Warranty</h3>
  <p>Your QuietClean 45 dishwasher is covered by a <b>2-year warranty for parts and labor</b>.</p>
  <div class="row" style="margin-top:10px">
    ${field("Warranty starts", long(d(-400)))}
    ${field("Warranty valid until", long(d(330)))}
  </div>
</div>
<div class="section">
  <h3>How to make a warranty claim</h3>
  <p>Call HomeHub Appliances at <b>1-800-555-0177</b> or visit <b>homehub.example/warranty</b>. Please have this receipt number (HH-55021) and the serial number from the label inside the dishwasher door ready.</p>
  <p class="small" style="margin-top:8px">Keep this receipt. It is your proof of purchase for the warranty.</p>
</div>
<div class="section small" style="text-align:center">Thank you for shopping at HomeHub Appliances!</div>`,
    }),
  },
  {
    file: "04-maplewood-parking-notice",
    formats: ["png", "pdf"],
    title: "City of Maplewood parking violation notice",
    seedId: "doc-maplewood-parking",
    facts: [
      ["Type", "official_letter"],
      ["Issuer", "City of Maplewood (Parking Services)"],
      ["Notice number", "PK-30918"],
      ["Issue date", `${d(-3)} (today - 3)`],
      ["Violation", "Parking during street cleaning"],
      ["Fine", "$45.00 USD"],
      ["Pay or appeal by (payment_due)", `${d(12)} (today + 12)`],
      ["Fine after deadline", "$90.00"],
    ],
    html: page({
      accent: "#334155",
      tint: "#f1f5f9",
      body: `
${header({
  logo: logos.city("#334155"),
  name: "City of Maplewood",
  tag: "Department of Transportation &ndash; Parking Services",
  senderLines: ["Parking Services Office", "City Hall, 1 Civic Plaza, Maplewood, ST 00000", "(555) 555-0190", "maplewood.example/parking"],
})}
<div class="row">
  ${recipient(HOUSEHOLD)}
  <div class="col box">
    ${field("Notice number", "PK-30918")}
    <div style="margin-top:6px">${field("Date of notice", long(d(-3)))}</div>
  </div>
</div>
<div class="title">Notice of Parking Violation</div>
<div class="section">
  <table>
    <tr><th>Detail</th><th>Information</th></tr>
    <tr><td>Violation</td><td>Parking during street cleaning (Code 7.12)</td></tr>
    <tr><td>Date of violation</td><td>${long(d(-3))}, 9:15 AM</td></tr>
    <tr><td>Location</td><td>400 block of Oak Street</td></tr>
    <tr><td>Vehicle</td><td>Gray hatchback</td></tr>
  </table>
</div>
<div class="row">
  <div class="col box highlight"><div class="label">Fine amount</div><div class="big">${money(45)}</div></div>
  <div class="col box highlight"><div class="label">Pay or appeal by</div><div class="big" style="font-size:20px">${long(d(12))}</div></div>
</div>
<div class="notice"><b>Important:</b> If the fine is not paid or appealed by <b>${long(d(12))}</b>, the fine increases to <b>${money(90)}</b>.</div>
<div class="section">
  <h3>Your options</h3>
  <p><b>1. Pay the fine.</b> Pay ${money(45)} online at maplewood.example/parking using notice number PK-30918, or in person at City Hall.</p>
  <p style="margin-top:6px"><b>2. File an appeal.</b> If you believe this notice was issued in error, you may file an appeal by the same date. Include your notice number and any photos or documents that support your appeal.</p>
</div>
<div class="section small">This notice was issued by the City of Maplewood Parking Services. Questions: (555) 555-0190, Monday to Friday, 8 AM to 5 PM.</div>`,
    }),
  },
  {
    file: "05-peakfit-membership-renewal",
    formats: ["png"],
    title: "PeakFit gym membership auto-renewal reminder",
    seedId: "doc-peakfit-renewal",
    facts: [
      ["Type", "subscription"],
      ["Issuer", "PeakFit"],
      ["Member ID", "PF-7730"],
      ["Issue date", `${d(-5)} (today - 5)`],
      ["Monthly fee", "$39.99 USD"],
      ["Cancel by (reply_by)", `${d(4)} (today + 4)`],
      ["Renewal date (renewal)", `${d(6)} (today + 6)`],
    ],
    html: page({
      accent: "#7c3aed",
      tint: "#f5f0ff",
      body: `
${header({
  logo: logos.peak("#7c3aed"),
  name: "PeakFit",
  tag: "Gym &amp; Fitness Clubs",
  senderLines: ["PeakFit Member Services", "550 River Road, Maplewood, ST 00000", "members@peakfit.example", "peakfit.example"],
})}
<div class="row">
  ${recipient(HOUSEHOLD)}
  <div class="col" style="text-align:right">
    ${field("Date", long(d(-5)))}
    <div style="margin-top:6px">${field("Member ID", "PF-7730")}</div>
  </div>
</div>
<div class="title">Your membership renews soon</div>
<div class="letter">
  <p>Hi Alex,</p>
  <p>This is a friendly reminder that your <b>PeakFit monthly membership</b> will <b>renew automatically</b> on <b>${long(d(6))}</b>. We will charge <b>${money(39.99)}</b> to your card on file.</p>
</div>
<div class="row">
  <div class="col box">${field("Plan", "Monthly &ndash; All Clubs")}</div>
  <div class="col box highlight"><div class="label">Monthly fee</div><div class="big">${money(39.99)}</div></div>
  <div class="col box">${field("Renewal date", long(d(6)))}</div>
</div>
<div class="notice">Don't want to renew? You must cancel <b>at least 2 days before</b> the renewal date. <b>Cancel by ${long(d(4))}</b> to avoid being charged.</div>
<div class="section">
  <h3>How to cancel</h3>
  <p>Open the PeakFit app and go to <b>Account &rarr; Membership &rarr; Cancel</b>, or visit the front desk of any PeakFit club with your Member ID (PF-7730).</p>
</div>
<div class="letter">
  <p>Want to keep training? You don't need to do anything. Thank you for being part of PeakFit!</p>
  <p>The PeakFit Team</p>
</div>`,
    }),
  },
  {
    file: "06-maplewood-elementary-field-trip",
    formats: ["png"],
    title: "Maplewood Elementary field-trip permission form",
    seedId: "doc-maplewood-field-trip",
    facts: [
      ["Type", "school"],
      ["Issuer", "Maplewood Elementary"],
      ["Issue date", `${d(-2)} (today - 2)`],
      ["Event", "Grade 3 field trip to the Maplewood Science Museum"],
      ["Fee", "$15.00 USD"],
      ["Return form and fee by (reply_by)", `${d(5)} (today + 5)`],
      ["Trip date (appointment)", `${d(18)} (today + 18)`],
    ],
    html: page({
      accent: "#15803d",
      tint: "#effaf2",
      body: `
${header({
  logo: logos.apple("#15803d"),
  name: "Maplewood Elementary",
  tag: "Learning together since 1962",
  senderLines: ["Maplewood Elementary School", "300 School Street, Maplewood, ST 00000", "(555) 555-0123", "maplewood-elementary.example"],
})}
<div class="row">
  <div class="col">${field("Date", long(d(-2)))}</div>
  <div class="col" style="text-align:right">${field("Class", "Grade 3 &ndash; Ms. Patel")}</div>
</div>
<div class="title">Field Trip Permission Form</div>
<div class="letter">
  <p>Dear Parents and Guardians,</p>
  <p>Our 3rd-grade class will visit the <b>Maplewood Science Museum</b> on <b>${long(d(18))}</b>. Students will explore the planetarium and the hands-on science hall.</p>
</div>
<div class="row">
  <div class="col box">${field("Trip date", long(d(18)))}<div class="small" style="margin-top:4px">Leave 9:00 AM, return 2:30 PM</div></div>
  <div class="col box highlight"><div class="label">Fee</div><div class="big">${money(15)}</div></div>
  <div class="col box highlight">${field("Return form and fee by", long(d(5)))}</div>
</div>
<div class="letter">
  <p>Please sign the form below and send it to school with your child, together with the <b>$15.00 fee</b> (cash or check payable to Maplewood Elementary), <b>by ${long(d(5))}</b>. Students without a signed form cannot join the trip.</p>
  <p>Thank you,<br><b>Ms. Patel</b>, Grade 3 Teacher</p>
</div>
<div class="stub" style="bottom:60px">
  <span class="stub-cut">&#9986; Cut here and return to school</span>
  <p style="font-weight:700; margin-top:4px">Permission Slip &ndash; Science Museum Field Trip (${long(d(18))})</p>
  <p style="margin-top:12px">Student name: <span class="line"></span> &nbsp; Class: Grade 3</p>
  <p style="margin-top:12px">I give permission for my child to attend the field trip. &nbsp; &#9744; $15.00 fee enclosed</p>
  <p style="margin-top:12px">Parent/guardian signature: <span class="line"></span> &nbsp; Date: <span class="line" style="min-width:110px"></span></p>
</div>`,
    }),
  },
  {
    // Not in seed.ts: used for the live upload demo (add_document).
    file: "07-riverside-water-bill",
    formats: ["png", "pdf"],
    title: "Riverside Water Company water bill (live upload demo, not in the seed)",
    seedId: null,
    facts: [
      ["Type", "bill"],
      ["Issuer", "Riverside Water Company"],
      ["Account number", "RW-1180-33"],
      ["Issue date", `${d(0)} (today)`],
      ["Usage", "4,200 gallons"],
      ["Amount due", "$56.75 USD"],
      ["Due date (payment_due)", `${d(14)} (today + 14, \"pay within 14 days\")`],
      ["Late fee", "$5.00"],
    ],
    html: page({
      accent: "#0369a1",
      tint: "#eef8ff",
      body: `
${header({
  logo: logos.drop("#0369a1"),
  name: "Riverside Water Company",
  tag: "Clean water, every day",
  senderLines: ["Riverside Water Company", "75 Mill Road, Riverside, ST 00000", "1-800-555-0166", "riversidewater.example"],
})}
<div class="title">Water Service Bill</div>
<div class="row">
  ${recipient(HOUSEHOLD)}
  <div class="col box">
    ${field("Account number", "RW-1180-33")}
    <div style="margin-top:6px">${field("Bill date", long(d(0)))}</div>
    <div style="margin-top:6px">${field("Service period", `${short(d(-31))} &ndash; ${short(d(-1))}`)}</div>
  </div>
  <div class="col box highlight">
    <div class="label">Amount due</div>
    <div class="big">${money(56.75)}</div>
    <div class="label" style="margin-top:6px">Due date</div>
    <div class="value">${long(d(14))}</div>
  </div>
</div>
<div class="section">
  <h3>Water usage</h3>
  <table>
    <tr><th>Meter</th><th>Previous reading</th><th>Current reading</th><th class="num">Usage</th></tr>
    <tr><td>W-55120</td><td>118,300 gal</td><td>122,500 gal</td><td class="num">4,200 gallons</td></tr>
  </table>
</div>
<div class="section">
  <h3>Charges</h3>
  <table>
    <tr><th>Description</th><th class="num">Amount</th></tr>
    <tr><td>Base service charge</td><td class="num">${money(18.5)}</td></tr>
    <tr><td>Water usage: 4.2 thousand gallons &times; $6.25</td><td class="num">${money(26.25)}</td></tr>
    <tr><td>Stormwater fee</td><td class="num">${money(12)}</td></tr>
    <tr class="total"><td>Total amount due</td><td class="num">${money(56.75)}</td></tr>
  </table>
</div>
<div class="notice">Payment is due <b>within 14 days</b> of the bill date, by <b>${long(d(14))}</b>. A <b>late fee of $5.00</b> will be added to unpaid balances after the due date.</div>
<div class="section small">Pay online at riversidewater.example/pay, call 1-800-555-0166, or mail the payment stub below. Please include your account number.</div>
<div class="stub">
  <span class="stub-cut">&#9986; Detach and return with your payment</span>
  <div class="row" style="margin-top:4px">
    ${field("Account number", "RW-1180-33")}
    ${field("Due date", long(d(14)))}
    ${field("Amount due", money(56.75))}
    ${field("Amount enclosed", '<span class="line" style="min-width:120px"></span>')}
  </div>
</div>`,
    }),
  },
];

// ---------- Rendering with headless Chrome ----------
// We talk to Chrome through the DevTools Protocol (a WebSocket built into Node 22),
// so we can set the exact page size and need no extra npm packages.

function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const candidates = [
    "/opt/pw-browsers/chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  ];
  const found = candidates.find((path) => existsSync(path));
  if (!found) {
    throw new Error("Chrome or Chromium not found. Install Google Chrome or set CHROME_PATH to its executable.");
  }
  return found;
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

// Starts Chrome and returns a small client: send(method, params) and waitFor(eventName).
async function launchChrome(chromePath, profileDir) {
  const chrome = spawn(
    chromePath,
    ["--headless", "--disable-gpu", "--no-sandbox", "--no-first-run", "--remote-debugging-port=0", `--user-data-dir=${profileDir}`, "about:blank"],
    { stdio: "ignore" },
  );

  // Chrome writes its debugging port and address to this file when it is ready.
  const portFile = join(profileDir, "DevToolsActivePort");
  for (let i = 0; i < 150 && !existsSync(portFile); i++) await sleep(100);
  if (!existsSync(portFile)) {
    chrome.kill();
    throw new Error("Chrome did not start (no DevToolsActivePort file after 15 s).");
  }
  const [port, path] = readFileSync(portFile, "utf8").trim().split("\n");

  const socket = new WebSocket(`ws://127.0.0.1:${port}${path}`);
  await new Promise((open, fail) => {
    socket.addEventListener("open", open);
    socket.addEventListener("error", () => fail(new Error("Could not connect to Chrome.")));
  });

  let nextId = 1;
  let sessionId;
  const pending = new Map();
  const waiters = [];
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const { resolve: ok, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(`Chrome: ${message.error.message}`));
      else ok(message.result);
    } else if (message.method) {
      const index = waiters.findIndex((w) => w.method === message.method);
      if (index >= 0) waiters.splice(index, 1)[0].resolve(message.params);
    }
  });

  const send = (method, params = {}) =>
    new Promise((ok, reject) => {
      const id = nextId++;
      pending.set(id, { resolve: ok, reject });
      socket.send(JSON.stringify({ id, method, params, sessionId }));
    });
  const waitFor = (method) => new Promise((ok) => waiters.push({ method, resolve: ok }));

  // Open one tab and send every later command to it.
  const { targetId } = await send("Target.createTarget", { url: "about:blank" });
  ({ sessionId } = await send("Target.attachToTarget", { targetId, flatten: true }));
  await send("Page.enable");

  const close = () => {
    socket.close();
    chrome.kill();
  };
  return { send, waitFor, close };
}

async function render(browser, htmlPath, doc) {
  const loaded = browser.waitFor("Page.loadEventFired");
  await browser.send("Page.navigate", { url: pathToFileURL(htmlPath).href });
  await loaded;

  if (doc.formats.includes("png")) {
    const { data } = await browser.send("Page.captureScreenshot", { format: "png" });
    const png = Buffer.from(data, "base64");
    if (png.length > MAX_PNG_BYTES) throw new Error(`${doc.file}.png is ${png.length} bytes (limit 1 MB).`);
    writeFileSync(join(OUT_DIR, `${doc.file}.png`), png);
    console.log(`  ${doc.file}.png (${Math.round(png.length / 1024)} KB)`);
  }

  if (doc.formats.includes("pdf")) {
    const { data } = await browser.send("Page.printToPDF", {
      printBackground: true,
      preferCSSPageSize: true,
      marginTop: 0,
      marginBottom: 0,
      marginLeft: 0,
      marginRight: 0,
    });
    const pdf = Buffer.from(data, "base64");
    writeFileSync(join(OUT_DIR, `${doc.file}.pdf`), pdf);
    console.log(`  ${doc.file}.pdf (${Math.round(pdf.length / 1024)} KB)`);
  }
}

async function main() {
  // Find the browser first, so a missing Chrome never leaves samples/ empty.
  const chromePath = findChrome();
  const workDir = mkdtempSync(join(tmpdir(), "duly-samples-"));
  mkdirSync(OUT_DIR, { recursive: true });

  // Remove old generated files so a renamed document doesn't leave a stale copy.
  for (const name of readdirSync(OUT_DIR)) {
    if (/\.(png|pdf)$/.test(name)) rmSync(join(OUT_DIR, name));
  }

  const browser = await launchChrome(chromePath, join(workDir, "profile"));
  try {
    await browser.send("Emulation.setDeviceMetricsOverride", {
      width: PAGE_WIDTH,
      height: PAGE_HEIGHT,
      deviceScaleFactor: SCALE,
      mobile: false,
    });
    for (const doc of documents) {
      const htmlPath = join(workDir, `${doc.file}.html`);
      writeFileSync(htmlPath, doc.html);
      await render(browser, htmlPath, doc);
    }
  } finally {
    browser.close();
    await sleep(500); // give Chrome a moment to release its profile folder
    rmSync(workDir, { recursive: true, force: true });
  }

  writeFileSync(join(OUT_DIR, "README.md"), buildReadme());
  console.log(`Done: ${documents.length} documents in samples/ (dates relative to ${today}).`);
}

// ---------- samples/README.md ----------

function buildReadme() {
  const sections = documents.map((doc) => {
    const files = doc.formats.map((f) => `\`${doc.file}.${f}\``).join(", ");
    const seed = doc.seedId ? `Seed document: \`${doc.seedId}\`` : "**Not in the seed.** Use it for the live upload demo (`add_document`).";
    const rows = doc.facts.map(([key, value]) => `| ${key} | ${value} |`).join("\n");
    return `## ${doc.title}\n\nFiles: ${files}  \n${seed}\n\n| Fact | Expected value |\n| --- | --- |\n${rows}\n`;
  });

  return `# Sample documents

Clearly fictional documents for the Duly demo (SPEC.md section 8). Every brand,
person, address and number is made up, and every page carries a "SAMPLE" mark.

Documents 1-6 match the seed data in \`lib/storage/seed.ts\` (same issuers, amounts,
numbers and day offsets). Document 7 is extra, for the live upload demo.

**Generated on ${today}.** Dates are relative to that day, like the seed. Regenerate on
demo day so the dates on paper match the seed and every deadline is upcoming:

\`\`\`bash
npm run samples
\`\`\`

The script (\`scripts/generate-samples.mjs\`) uses Google Chrome or Chromium in headless
mode. If it can't find the browser, set \`CHROME_PATH\` to its executable.

Use the tables below to check extraction accuracy. For deadlines, the word in
parentheses after the fact name is the deadline \`kind\` the extractor should return.

${sections.join("\n")}`;
}

main().catch((error) => {
  console.error(`Could not generate the samples: ${error.message}`);
  process.exit(1);
});
