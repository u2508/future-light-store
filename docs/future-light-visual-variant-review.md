# Future Light visual variant review gate

The full visual task is intentionally separate from the SEO artifact. It covers customer-facing option labels, variant-to-media associations, and image candidates that require a `keep` or `recreate` decision.

Keep is the default. A beautiful, product-accurate image that already fits the VS Store presentation must not be regenerated. `recreate` is allowed only for an objective issue: supplier or China branding/watermark, wrong product or variant, broken/unusable image, materially misleading crop/composition, or clearly off-brand presentation. Personal preference alone is not a regeneration reason.

Product identity is a hard safety gate: a generated image must depict the exact same product and design as its reviewed source. A visually attractive but different product, changed pattern, invented variant, or generic substitute is rejected and cannot be uploaded. The generated candidate shown in the local review progress is not approved for Shopify.

The evidence queue is generated from the Future Light Shopify target only:

```sh
npm run shopify:variants:options:media
npm run shopify:variants:visual:queue
```

The queue is saved at `output/future-light-visual-review/queue.json`. It must be reviewed by ChatGPT using the live image URLs before `output/future-light-visual-review/approved-mappings.json` is created. The approval file must contain:

When an image is clearly mismatched, technically unusable, age/safety-sensitive, or needs a source-product check, record it as a local `hold` with `--hold-reason`. Holds are persisted in `chatgpt-image-decisions.json` but are not approvals and never allow the Shopify gate to pass. They remain pending until an exact source identity is verified and a compliant keep or identity-preserving recreate decision is recorded.

```json
{
  "targetStoreDomain": "vs-future-store-0jl2t-jxu6tnr3.myshopify.com",
  "queueFingerprint": "<exact queue fingerprint>",
  "approval": {
    "mode": "chatgpt-manual-visual-review",
    "reviewedAt": "<ISO timestamp>"
  },
  "optionValueDecisions": [
    { "optionValueId": "gid://shopify/ProductOptionValue/...", "newName": "Human-readable label" }
  ],
  "variantMediaAssignments": [
    { "variantId": "gid://shopify/ProductVariant/...", "mediaId": "gid://shopify/MediaImage/..." }
  ],
  "imageDecisions": [
    { "handle": "product-handle", "imageUrl": "https://cdn.shopify.com/...", "action": "keep" },
    {
      "handle": "product-handle",
      "imageUrl": "https://cdn.shopify.com/...",
      "action": "recreate",
      "reasonCode": "supplier-or-China branding/watermark",
      "reviewNote": "Visible supplier branding makes the image unsuitable for the storefront.",
      "sourceProductId": "gid://shopify/Product/...",
      "productIdentityPreserved": true,
      "identityReviewNote": "The replacement shows the same product form, design, and variant as the reviewed source image.",
      "generatedAssetPath": "output/imagegen/future-light/replacement.png"
    }
  ]
}
```

For `action: "recreate"`, `generatedAssetPath` must point inside `output/imagegen`. Generate that asset with the native image-generation tool only after reviewing the source image and product evidence. Never invent a color, material, size, or product form from a raw option code.

For the held-image repair batch, prepare the native Image Gen queue after the
held-image plan is refreshed:

```sh
npm run shopify:images:recreate:draft:plan
npm run shopify:images:recreate:queue
npm run shopify:images:recreate:generate
npm run shopify:images:recreate:draft:sync
npm run shopify:images:recreate:draft:validate
```

The queue is saved at
`output/imagegen/future-light/held-repair-queue.json`. It contains 1 entry per
identity-safe held source, the exact local source path under
`tmp/imagegen/future-light-held/`, the identity-preserving edit prompt, and a
stable generated-asset path. The queue downloads sources in parallel and
resumes from existing files. It records `waiting_for_network` rather than
changing a source when a CDN request fails. A missing `OPENAI_API_KEY` leaves
the queue at `ready_for_native_imagegen`; no model call is attempted. After
native Image Gen outputs are created, the draft sync adds only existing,
non-rejected assets as unapproved `recreate_candidate` entries. Every generated
asset still requires a fresh ChatGPT visual review before an approval file can
be created.

The release graph runs the plan, queue, draft sync, sanitization, and draft
validation before the complete visual-review gate. The queue step is local and
read-only against Shopify CDN media; it never uploads, deletes, renames, or
approves media. The 16 source-review-required holds remain outside the native
generation queue until their exact product identity is confirmed.

Record a held image without approving it:

```sh
npm run shopify:variants:visual:record -- \
  --offset 153 --limit 1 --action hold \
  --hold-reason "The MP3 listing shows a memory card, so the source image is a wrong-product match." \
  --note "ChatGPT visually inspected the image and held it pending exact product identity verification before any replacement is generated."
```

Validate the complete approval contract with:

```sh
npm run shopify:variants:visual:check
```

The release graph runs this gate before publication. A missing, stale, duplicate, raw, or unsupported decision blocks the release and persists the exact queue fingerprint and failure state for safe resume. The gate does not touch pricing, inventory, SKU data, SALT processes, or theme settings.
