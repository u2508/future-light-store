# DSers new-cohort stock audit — 2026-09-21

## Scope

- DSers My Products: `All (3000)` / `AliExpress (3000)`.
- Read-only internal-browser audit with page size set to `100 / page`.
- The frozen Shopify cohort is 679 products, so the first 6 pages plus the
  first 79 records on page 7 represent the current new-cohort range in the
  DSers ordering observed during the audit.
- No Shopify or DSers delete, hide, replace, or push action was performed.

## Findings

Six products in the new-cohort range are below the required supplier-stock
floor of 200:

| DSers page | Position | Product | Stock |
| ---: | ---: | --- | ---: |
| 5 | 16 | Stem Building Blocks Everyday Accessory | 5 |
| 5 | 18 | Rompers Toddler Ruffles Cotton Denim Baby Romper | 39 |
| 6 | 76 | Interactive Pet Toy For Dogs | 197 |
| 6 | 86 | Watches Luxury Brand Men's Wristwatch | 171 |
| 7 | 75 | Montessori Toddler Busy Toy | 141 |
| 7 | 77 | Interactive Pet Toy For Dogs - Cat | 195 |

The same cohort also has one non-stock policy hold:

| Handle | Signal | Evidence |
| --- | --- | --- |
| `cartoon-silicone-case-for-airpods-pro3-4-protective-sleeve-for-airpods-pro2-3rd-soft-shell-earphone-shockproof-cover` | replacement | Variant/media evidence contains `AirPods Pro Replacement Silicone Ear Tips`, which does not describe the silicone case listing and needs an identity-safe media review. |

The first four products are on pages 5–6. The page-7 records are positions 75
and 77, both inside the first 679-record cohort boundary. The remaining
observed pages contained additional low-stock products, but those are outside
the new-cohort boundary and were not included in this table.

## Decision

These six stock records plus the one media/content record are held for an
explicit cleanup decision. They must not be treated as passing the intake
gate. The new DSers policy now rejects missing stock evidence, stock below
200, and replacement signals before future intake.

## Import-list replacement check

- The live Import List contains `194` records and is currently `2 / 2` at
  `100 / page`.
- The store is already at the DSers/Shopify cap of `3000`, so no additional
  push was attempted.
- Among the currently unpushed records observed in the read-only scan, the
  only clearly eligible stock-200+ family-store candidate was:
  `DoreenBox 30 /70/100PCs Bronze Tone Beads Vintage Loose Spacer Beads For
  DIY Jewelry Making 13x12mm` (stock `4994`).
- Other unpushed records observed in the scan were below stock `200` or did
  not provide enough evidence for a safe replacement decision. No DSers or
  Shopify mutation was performed during this replacement check.

## Family-store collection coverage

The current synced Shopify collection snapshot has non-empty coverage across
the requested family-store groups (counts are product IDs per collection and
can overlap):

| Collection | Products |
| --- | ---: |
| Kids | 206 |
| Kids Toys & Games | 36 |
| Kids Wear | 86 |
| Pet Essentials | 110 |
| Women's Fashion | 185 |
| Women's Beauty & Skincare | 12 |
| Men's Fashion | 259 |
| Jewelry & Accessories | 59 |
| Anime Collectables | 241 |
| Electronic Accessories | 884 |
| iPhone Cases | 133 |
| Home & Decor | 143 |
| Bedsheets, Handlooms & Towels | 34 |
| Watches | 77 |
| Beauty Makeup Essentials | 150 |
