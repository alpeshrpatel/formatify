/** Ready-made documents so the app is useful the second it opens. */

function buildLargeSample() {
  return `[
${Array.from({ length: 60 }, (_, index) =>
  `  { "id": ${1000 + index}, "name": "Item ${index + 1}", "price": ${(index * 3.75).toFixed(2)}, "tags": ["alpha", "beta"], "inStock": ${index % 3 !== 0} }`,
).join(',\n')}
]`;
}

export const SAMPLES = [
  {
    id: 'api',
    label: 'Product API response',
    description: 'A well-formed document with nesting, arrays and escapes.',
    text: `{
  "status": "ok",
  "generatedAt": "2026-09-21T09:12:44Z",
  "page": 1,
  "totalPages": 3,
  "products": [
    {
      "sku": "KB-8842",
      "name": "Mechanical Keyboard",
      "brand": "Ergo Labs",
      "price": { "amount": 129.5, "currency": "EUR" },
      "tags": ["keyboard", "wireless", "hot-swap"],
      "inStock": true,
      "rating": 4.7,
      "released": null
    },
    {
      "sku": "MS-1043",
      "name": "Vertical Mouse",
      "brand": "Ergo Labs",
      "price": { "amount": 59, "currency": "EUR" },
      "tags": ["mouse", "ergonomic"],
      "inStock": false,
      "rating": 4.2,
      "released": "2025-11-02"
    }
  ],
  "meta": {
    "traceId": "8f14e45fceea167a5a36dedd4bea2543",
    "notes": "Prices include VAT \\u2014 shipping is calculated at checkout."
  }
}`,
  },
  {
    id: 'broken',
    label: 'Broken config',
    description: 'Shows the error reporting: the trailing comma is reported on line 8.',
    text: `{
  "name": "checkout-service",
  "version": "2.4.1",
  "port": 8080,
  "features": {
    "guestCheckout": true,
    "giftCards": false,
  },
  "retries": 3,
  "timeoutMs": 1500
}`,
  },
  {
    id: 'messy',
    label: 'Hand-written notes',
    description: 'Pseudo JSON with curly quotes, comments and bare keys — try Auto-fix.',
    text: `{
  // copied out of a design doc
  id: 42,
  name: \u2018Ada Lovelace\u2019,
  role: 'engineer',
  active: True,
  score: NaN,
  skills: ["maths", "logic",],
  joined: 2024-05-01
}`,
  },
  {
    id: 'ndjson',
    label: 'JSON Lines (two documents)',
    description: 'Two values in one file — the parser explains the fix.',
    text: `{"event":"signup","userId":17,"plan":"pro"}
{"event":"login","userId":17,"at":"2026-09-20T18:03:11Z"}`,
  },
  {
    id: 'large',
    label: 'Large list (60 records)',
    description: 'A bigger document for testing formatting speed.',
    text: buildLargeSample(),
  },
];

export const DEFAULT_SAMPLE = SAMPLES[0];
