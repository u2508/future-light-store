#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const rootDir = process.cwd();
const distDir = resolve(rootDir, "dist");
const publicDir = resolve(rootDir, "public");
const siteUrl = String(process.env.VITE_SITE_URL || "https://vss-store.vercel.app")
  .trim()
  .replace(/\/+$/, "");
const productIndexPath = resolve(publicDir, "data", "products.json");
const collectionsPath = resolve(publicDir, "data", "collections.json");
const knowledgePath = resolve(rootDir, "output", "product-knowledge.json");
const WRITE_CONCURRENCY = Math.max(4, Math.min(32, Number(process.env.SEO_STATIC_WRITE_CONCURRENCY || 16)));

const STATIC_PAGES = [
  {
    path: "/",
    title: "VS Store — Product Discovery Made Clear",
    description: "Shop useful products across electronics, home, fashion, travel, wellness and more at VS Store with clear details and secure checkout.",
    heading: "Discover products that fit your everyday life",
    summary: "Explore a carefully organized catalog with practical product details, transparent pricing and tracked fulfilment.",
    answerBlocks: [
      {
        question: "What is VS Store?",
        answer: "VS Store is a curated online marketplace for practical everyday essentials, future-ready tech and lifestyle accessories, with secure Shopify checkout and tracked fulfilment.",
      },
      {
        question: "How can I find the right product?",
        answer: "Shop by collection, search the catalog, or compare products by price, availability, category, brand, size, colour and discount.",
      },
      {
        question: "Can I track a VS Store order?",
        answer: "Yes. Enter the order number and checkout email on the track-order page to view the latest fulfilment status and carrier tracking links.",
      },
    ],
  },
  {
    path: "/shop",
    title: "Shop All Products | VS Store",
    description: "Browse the full VS Store catalog by product type, category, price and practical use.",
    heading: "Shop all products",
    summary: "Search the full catalog and compare product details before you order.",
  },
  {
    path: "/collections",
    title: "Product Collections | VS Store",
    description: "Browse VS Store collections organized by product type, use case, price range and seasonal shopping intent.",
    heading: "Browse collections",
    summary: "Find a focused starting point for your next purchase.",
  },
  {
    path: "/offers",
    title: "Offers and Value Picks | VS Store",
    description: "Find current VS Store offers and value picks with product details, pricing and delivery information.",
    heading: "Offers and value picks",
    summary: "Compare available value-focused products and current offers.",
  },
  {
    path: "/about",
    title: "About VS Store",
    description: "Learn how VS Store organizes useful products with clear information, secure checkout and tracked fulfilment.",
    heading: "About VS Store",
    summary: "VS Store helps shoppers discover practical products with clearer product information and a straightforward buying experience.",
  },
  {
    path: "/policies",
    title: "Store Policies | VS Store",
    description: "Read VS Store shipping, returns, privacy and terms information before placing an order.",
    heading: "Store policies",
    summary: "Review shipping, returns, privacy and terms information before ordering.",
  },
  {
    path: "/help",
    title: "Help and Shopping Information | VS Store",
    description: "Get help with shopping, orders, delivery, returns and product questions at VS Store.",
    heading: "How can we help?",
    summary: "Find answers before and after placing an order.",
    faqs: [
      {
        question: "How long does delivery take?",
        answer: "Most orders ship within 1–2 business days; delivery estimates are shown at checkout.",
      },
      {
        question: "Can I return an item?",
        answer: "Yes — unused items can be returned within 30 days of delivery.",
      },
      {
        question: "Which payment methods are accepted?",
        answer: "Checkout is handled securely by Shopify and supports major cards and wallets.",
      },
      {
        question: "Where is my order?",
        answer: "Use the order number from your confirmation email on the tracking page.",
      },
    ],
  },
  {
    path: "/track-order",
    title: "Track Your Order | VS Store",
    description: "Use VS Store order information to check delivery progress and get help with an order.",
    heading: "Track your order",
    summary: "Check the status of your VS Store purchase.",
  },
  ...["shipping", "returns", "privacy", "terms"].map((slug) => ({
    path: `/policies/${slug}`,
    title: `${slug[0].toUpperCase()}${slug.slice(1)} Policy | VS Store`,
    description: `Read the VS Store ${slug} policy and understand the terms that apply to your shopping experience.`,
    heading: `${slug[0].toUpperCase()}${slug.slice(1)} policy`,
    summary: `Review the VS Store ${slug} information before ordering.`,
  })),
];

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeJson(value) {
  return JSON.stringify(value)
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll("&", "\\u0026");
}

function canonicalUrl(path) {
  const pathname = String(path || "/").replace(/\/{2,}/g, "/");
  const normalized = pathname === "/" ? "/" : pathname.replace(/\/+$/, "");
  return `${siteUrl}${normalized}`;
}

function htmlToText(value) {
  return String(value || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function sanitizeDescriptionHtml(value) {
  const allowed = new Set(["h2", "h3", "p", "ul", "ol", "li", "strong", "em", "br"]);
  return String(value || "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<\s*(script|style|iframe|object|embed|form|svg|math)\b[^>]*>[\s\S]*?<\/\s*\1\s*>/gi, "")
    .replace(/<[^>]*>/g, (tag) => {
      const tagName = tag.match(/^<\s*\/?\s*([a-z0-9]+)/i)?.[1]?.toLowerCase();
      if (!tagName || !allowed.has(tagName)) return "";
      if (/^<\s*\//.test(tag)) return `</${tagName}>`;
      return tagName === "br" ? "<br>" : `<${tagName}>`;
    });
}

function titleCase(value) {
  return String(value || "")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function productKnowledgeByHandle(knowledge) {
  return new Map((knowledge?.products || []).map((record) => [record.handle, record]));
}

function productType(product, knowledge) {
  const listingType = extractListingFact(product, "Product type");
  const knowledgeType = knowledge?.canonicalTypeId || knowledge?.specificType || "";
  const broadListingTypes = new Set([
    "bag",
    "baby product",
    "home decor",
    "item",
    "lamp",
    "makeup product",
    "pet product",
    "product",
  ]);
  const titleAndHandle = `${product.title || ""} ${product.handle || ""}`.toLowerCase();
  const garmentConflict = /\b(?:dress|gown)\b/i.test(listingType)
    && /\b(?:top|pants|trousers|shirt|shorts|clothing|underwear|set)\b/i.test(titleAndHandle)
    && !/\b(?:dress|gown)\b/i.test(titleAndHandle);
  const preferredType = knowledgeType && (broadListingTypes.has(listingType.toLowerCase()) || garmentConflict)
    ? knowledgeType
    : listingType;
  return titleCase(
    preferredType
      || product.product_type
      || product.productType
      || knowledgeType
      || "product",
  );
}

function extractListingFacts(product) {
  const text = htmlToText(product.body_html || product.descriptionHtml || "");
  const labels = [
    "Product type",
    "Connector size",
    "Connection",
    "Connector layout",
    "Material",
    "Style or design",
    "Size or capacity",
    "Color",
    "Pattern",
    "Power source",
    "Frequency",
    "Supported features",
    "Device compatibility",
    "Use or occasion",
    "Placement or setting",
    "Available options",
    "Pack format",
    "Brand or supplier",
    "Origin",
    "Model number",
  ];
  const sectionMarkers = ["About", "Key Details", "Specifications", "Use & Care", "FAQs"];
  const facts = [];
  for (const label of labels) {
    const factLabels = labels.map(escapeRegExp).join("|");
    const markerLabels = sectionMarkers.map(escapeRegExp).join("|");
    const match = text.match(new RegExp(`(?:^|\\s)${escapeRegExp(label)}\\s*:\\s*([^|]+?)(?=\\s+(?:(?:${factLabels})\\s*:|(?:${markerLabels}))(?:\\s|$)|$)`, "i"));
    const value = match?.[1]?.replace(/\s+/g, " ").trim();
    if (value && !/^none$/i.test(value)) facts.push({ label, value });
  }
  return facts;
}

function extractListingFact(product, label) {
  return extractListingFacts(product).find((fact) => fact.label === label)?.value || "";
}

function relevantListingFacts(product, knowledge) {
  const titleAndHandle = `${product.title || ""} ${product.handle || ""}`.toLowerCase();
  const taxonomyText = `${knowledge?.departmentId || ""} ${knowledge?.categoryId || ""} ${knowledge?.subcategoryId || ""} ${knowledge?.canonicalTypeId || ""}`.toLowerCase();
  const personalProduct = /\b(?:apparel|clothing|fashion|jewelry|watches|wearable|kids|baby|women|men|personal)\b/i.test(taxonomyText);
  return extractListingFacts(product).filter((fact) => {
    if (fact.label !== "Intended user") return true;
    const audienceValue = fact.value.toLowerCase();
    const audienceTerms = /\b(?:women|woman|men|man|girls|girl|boys|boy|baby|babies|kids|children)\b/i;
    if (!audienceTerms.test(audienceValue) || personalProduct) return true;
    return audienceValue.split(/[^a-z]+/i).some((term) => term.length > 2 && titleAndHandle.includes(term));
  });
}

function naturalList(values) {
  const items = values.filter(Boolean);
  if (items.length < 2) return items[0] || "";
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items.at(-1)}`;
}

function normalizeFactValue(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .replace(/\b(\d+)\s*-\s*(\d+)\b/g, "$1–$2")
    .trim();
}

function factPhrase(fact) {
  const value = normalizeFactValue(fact.value);
  if (!value) return "";
  switch (fact.label) {
    case "Material":
      return `${value} construction`;
    case "Connector size":
      return `${value} connector`;
    case "Connection":
      return `${value} connection`;
    case "Connector layout":
      return `a ${value} connector layout`;
    case "Style or design":
      return `a ${value} design`;
    case "Intended user":
      return `options for ${value.replace(/\bbaby\b/gi, "babies")}`;
    case "Size or capacity":
      return `${value} sizing`;
    case "Color":
      return `${value} color`;
    case "Pattern":
      return `${value} pattern`;
    case "Power source":
      return `${value} power`;
    case "Frequency":
      return `${value} frequency`;
    case "Supported features":
      return `${value} support`;
    case "Device compatibility":
      return `compatibility with ${value}`;
    case "Use or occasion":
      return `use for ${value}`;
    case "Placement or setting":
      return `placement in ${value}`;
    case "Available options":
      return `options including ${value}`;
    case "Pack format":
      return `${value} pack format`;
    default:
      return `${fact.label.toLowerCase()}: ${value}`;
  }
}

function removeGenericProductCopy(value, title) {
  const escapedTitle = escapeRegExp(title);
  return String(value || "")
    .replace(new RegExp(`(?:the\\s+)?${escapedTitle}\\s+is\\s+(?:presented|intended)\\s+for\\s+the\\s+use[^.]*\\.?`, "gi"), "")
    .replace(/(?:the\s+)?product\s+is\s+(?:presented|intended)\s+for\s+the\s+use[^.]*\.?/gi, "")
    .replace(/serves\s+the\s+specific\s+function\s+identified\s+by\s+its\s+handle[^.]*\.?/gi, "")
    .replace(/is\s+presented\s+for\s+the\s+use\s+and\s+specifications\s+named\s+in\s+the\s+listing[^.]*\.?/gi, "")
    .replace(/is\s+intended\s+for\s+the\s+use\s+described\s+in\s+the\s+listing[^.]*\.?/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function usefulProductSummary(product, knowledge) {
  const title = String(product.title || titleCase(product.handle));
  const type = productType(product, knowledge);
  const facts = relevantListingFacts(product, knowledge);
  const usefulFacts = facts
    .filter((fact) => fact.label !== "Product type")
    .filter((fact) => fact.value.length >= 2)
    .map(factPhrase)
    .filter(Boolean)
    .slice(0, 4);
  const article = /^[aeiou]/i.test(type) ? "an" : "a";
  const factSentence = usefulFacts.length ? ` It includes ${naturalList(usefulFacts)}.` : "";
  const sourceText = htmlToText(product.body_html || product.descriptionHtml || "");
  const contentBeforeSections = sourceText.split(/\b(?:Key Details|Specifications|Use & Care|FAQs)\b/i)[0];
  const raw = removeGenericProductCopy(contentBeforeSections, title)
    .replace(new RegExp(`^about ${escapeRegExp(title)}\\s*`, "i"), "")
    .replace(new RegExp(`^${escapeRegExp(title)}\\s*[—:-]?\\s*`, "i"), "")
    .trim();
  const detail = raw
    .split(/(?<=[.!?])\s+/)
    .find((sentence) => sentence.length > 28 && !/^(?:specifications?|key details?|use & care|faqs?)$/i.test(sentence)) || "";
  const detailSentence = detail && !/\b(?:listed details|available options)\b/i.test(detail)
    ? ` ${detail}`
    : "";
  return `${title} is ${article} ${type.toLowerCase()}.${factSentence}${detailSentence}`
    .replace(/\s+/g, " ")
    .trim();
}

function productMetaDescription(product, knowledge) {
  const summaryTail = usefulProductSummary(product, knowledge)
    .replace(new RegExp(`^${escapeRegExp(product.title)}\\s*`, "i"), "")
    .trim();
  const summary = /^is\b/i.test(summaryTail) ? `This product ${summaryTail}` : summaryTail;
  const value = `Shop ${product.title} at VS Store. ${summary}`;
  return value.length <= 158 ? value : `${value.slice(0, 155).replace(/\s+\S*$/, "")}...`;
}

function imageUrls(product) {
  return (Array.isArray(product.images) ? product.images : [])
    .map((image) => image?.src || image?.url)
    .filter(Boolean)
    .slice(0, 8);
}

function firstOffer(product) {
  const variants = Array.isArray(product.variants) ? product.variants : [];
  const variant = variants.find((candidate) => candidate?.available) || variants[0];
  if (!variant?.price) return null;
  return {
    "@type": "Offer",
    price: String(variant.price),
    priceCurrency: "USD",
    availability: variant.available === false ? "https://schema.org/OutOfStock" : "https://schema.org/InStock",
    url: canonicalUrl(`/products/${product.handle}`),
  };
}

function productStructuredData(product, knowledge) {
  const url = canonicalUrl(`/products/${product.handle}`);
  const offer = firstOffer(product);
  const graph = [
    {
      "@type": "Product",
      name: product.title,
      description: usefulProductSummary(product, knowledge),
      url,
      image: imageUrls(product),
      ...(product.vendor ? { brand: { "@type": "Brand", name: product.vendor } } : {}),
      ...(offer ? { offers: offer } : {}),
    },
    {
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: canonicalUrl("/") },
        { "@type": "ListItem", position: 2, name: "Shop all", item: canonicalUrl("/shop") },
        { "@type": "ListItem", position: 3, name: product.title, item: url },
      ],
    },
  ];
  return { "@context": "https://schema.org", "@graph": graph };
}

function collectionStructuredData(collection) {
  const url = canonicalUrl(`/collections/${collection.handle}`);
  const featured = collection.customData?.featuredProducts || [];
  return {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: collection.title,
    description: htmlToText(collection.description || collection.customData?.heroSummary || `Browse ${collection.title} at VS Store.`),
    url,
    mainEntity: {
      "@type": "ItemList",
      itemListElement: featured.slice(0, 12).map((product, index) => ({
        "@type": "ListItem",
        position: index + 1,
        name: product.title,
        url: canonicalUrl(`/products/${product.handle}`),
      })),
    },
  };
}

function rootStructuredData() {
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        name: "VS Store",
        url: canonicalUrl("/"),
      },
      {
        "@type": "WebSite",
        name: "VS Store",
        url: canonicalUrl("/"),
        potentialAction: {
          "@type": "SearchAction",
          target: `${canonicalUrl("/shop")}?q={search_term_string}`,
          "query-input": "required name=search_term_string",
        },
      },
    ],
  };
}

function answerBlocksMarkup(blocks = []) {
  if (!blocks.length) return "";
  return `<section aria-labelledby="answer-guide"><h2 id="answer-guide">Quick answers</h2><dl>${blocks
    .map(({ question, answer }) => `<dt>${escapeHtml(question)}</dt><dd>${escapeHtml(answer)}</dd>`)
    .join("")}</dl></section>`;
}

function faqMarkup(faqs = []) {
  if (!faqs.length) return "";
  return `<section aria-labelledby="frequently-asked-questions"><h2 id="frequently-asked-questions">Frequently asked questions</h2><dl>${faqs
    .map(({ question, answer }) => `<dt>${escapeHtml(question)}</dt><dd>${escapeHtml(answer)}</dd>`)
    .join("")}</dl></section>`;
}

function staticBody(page) {
  return `<main><h1>${escapeHtml(page.heading)}</h1><p>${escapeHtml(page.summary)}</p>${answerBlocksMarkup(page.answerBlocks)}${faqMarkup(page.faqs)}</main>`;
}

function staticStructuredData(page) {
  const webPage = { "@type": "WebPage", name: page.title, url: canonicalUrl(page.path) };
  if (!page.faqs?.length) return { "@context": "https://schema.org", ...webPage };
  return {
    "@context": "https://schema.org",
    "@graph": [
      webPage,
      {
        "@type": "FAQPage",
        mainEntity: page.faqs.map((faq) => ({
          "@type": "Question",
          name: faq.question,
          acceptedAnswer: { "@type": "Answer", text: faq.answer },
        })),
      },
    ],
  };
}

function productBody(product, knowledge) {
  const type = productType(product, knowledge);
  const listingFacts = relevantListingFacts(product, knowledge);
  const facts = [
    ["Product type", type],
    product.vendor ? ["Brand or supplier", product.vendor] : null,
    ...listingFacts
      .filter((fact) => !["Product type", "Brand or supplier"].includes(fact.label))
      .slice(0, 8)
      .map((fact) => [fact.label, normalizeFactValue(fact.value)]),
    knowledge?.categoryId ? ["Category", titleCase(knowledge.categoryId)] : null,
    knowledge?.subcategoryId ? ["Subcategory", titleCase(knowledge.subcategoryId)] : null,
  ].filter(Boolean);
  const factsMarkup = facts.map(([label, value]) => `<dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd>`).join("");
  const optionValues = [...new Set((product.variants || [])
    .map((variant) => String(variant?.title || "").trim())
    .filter((title) => title && !/^default title$/i.test(title)))].slice(0, 8);
  const optionsMarkup = optionValues.length
    ? `<section aria-label="Available options"><h2>Available options</h2><p>Choose from ${escapeHtml(naturalList(optionValues))} where offered.</p></section>`
    : "";
  const checks = listingFacts
    .filter((fact) => ["Size or capacity", "Device compatibility", "Available options", "Material"].includes(fact.label))
    .map((fact) => fact.label.toLowerCase());
  const orderingText = checks.length
    ? `Before ordering, check the listed ${naturalList(checks)} so you can choose the right product details and option.`
    : "Before ordering, review the listed product details and available options to make the right choice.";
  const summary = usefulProductSummary(product, knowledge).replace(
    new RegExp(`^${escapeRegExp(product.title)}`),
    `The ${product.title}`,
  );
  return `<main><article><h1>${escapeHtml(product.title)}</h1><p>${escapeHtml(summary)}</p><section aria-label="Product details"><h2>Product details</h2><dl>${factsMarkup}</dl></section>${optionsMarkup}<section aria-label="Before ordering"><h2>Before ordering</h2><p>${escapeHtml(orderingText)}</p></section></article></main>`;
}

function collectionBody(collection) {
  const summary = htmlToText(collection.customData?.heroSummary || collection.description || `Browse ${collection.title} at VS Store.`);
  const featured = (collection.customData?.featuredProducts || []).slice(0, 8);
  const links = featured.map((product) => `<li><a href="${escapeHtml(`/products/${product.handle}`)}">${escapeHtml(product.title)}</a></li>`).join("");
  return `<main><h1>${escapeHtml(collection.title)}</h1><p>${escapeHtml(summary)}</p>${links ? `<section aria-label="Featured products"><h2>Featured products</h2><ul>${links}</ul></section>` : ""}</main>`;
}

function renderDocument(template, { path, title, description, body, structuredData, ogType = "website" }) {
  const canonical = canonicalUrl(path);
  const assetTags = [...template.matchAll(/<(?:link|script)\b[^>]*(?:>|<\/script>)/gi)]
    .map((match) => match[0])
    .filter((tag) => /rel=["'](?:stylesheet|modulepreload)["']|type=["']module["']/i.test(tag));
  const head = [
    "<meta charset=\"UTF-8\" />",
    "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\" />",
    "<meta name=\"google-site-verification\" content=\"T5OO6im9_fwXtSjarVqkZvx-JHYudcUe_B6jhJH-BeY\" />",
    `<meta name="description" content="${escapeHtml(description)}" />`,
    `<meta name="robots" content="index,follow,max-image-preview:large" />`,
    `<link rel="canonical" href="${escapeHtml(canonical)}" />`,
    `<meta property="og:title" content="${escapeHtml(title)}" />`,
    `<meta property="og:description" content="${escapeHtml(description)}" />`,
    `<meta property="og:type" content="${escapeHtml(ogType)}" />`,
    `<meta property="og:url" content="${escapeHtml(canonical)}" />`,
    `<meta property="og:site_name" content="VS Store" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<title>${escapeHtml(title)}</title>`,
    `<link rel="icon" href="/favicon.svg" type="image/svg+xml" />`,
    ...assetTags,
    `<script type="application/ld+json">${escapeJson(structuredData)}</script>`,
  ].join("\n    ");
  return template
    .replace(/<head>[\s\S]*?<\/head>/i, `<head>\n    ${head}\n  </head>`)
    .replace('<div id="root"></div>', `<div id="root">${body}</div>`);
}

async function writeGeneratedPages(tasks) {
  let cursor = 0;
  const workerCount = Math.min(WRITE_CONCURRENCY, tasks.length);
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (cursor < tasks.length) {
      const task = tasks[cursor++];
      await mkdir(dirname(task.target), { recursive: true });
      await writeFile(task.target, task.content, "utf8");
    }
  }));
}

async function loadProducts() {
  const index = JSON.parse(await readFile(productIndexPath, "utf8"));
  const products = [];
  for (const shard of index.shards || []) {
    const payload = JSON.parse(await readFile(resolve(publicDir, "data", shard.file), "utf8"));
    products.push(...(payload.products || []));
  }
  return products.filter((product) => product?.handle && product.status !== "DRAFT");
}

async function main() {
  const template = (await readFile(resolve(distDir, "index.html"), "utf8"))
    .replace(/<div id="root">[\s\S]*?<\/div>/i, '<div id="root"></div>');
  const [products, collectionsPayload, knowledge] = await Promise.all([
    loadProducts(),
    readFile(collectionsPath, "utf8").then(JSON.parse),
    readFile(knowledgePath, "utf8").then(JSON.parse).catch(() => null),
  ]);
  const knowledgeByHandle = productKnowledgeByHandle(knowledge);
  const collections = collectionsPayload.collections || [];

  const tasks = [];
  for (const page of STATIC_PAGES) {
    const target = page.path === "/" ? resolve(distDir, "index.html") : resolve(distDir, page.path.slice(1), "index.html");
    tasks.push({ target, content: renderDocument(template, {
      ...page,
      structuredData: page.path === "/" ? rootStructuredData() : staticStructuredData(page),
      body: staticBody(page),
    }) });
  }

  for (const product of products) {
    const path = `/products/${product.handle}`;
    const target = resolve(distDir, "products", product.handle, "index.html");
    const knowledgeRecord = knowledgeByHandle.get(product.handle);
    tasks.push({ target, content: renderDocument(template, {
      path,
      title: `${product.title} | VS Store`,
      description: productMetaDescription(product, knowledgeRecord),
      body: productBody(product, knowledgeRecord),
      structuredData: productStructuredData(product, knowledgeRecord),
      ogType: "product",
    }) });
  }

  for (const collection of collections.filter((entry) => entry?.handle)) {
    const path = `/collections/${collection.handle}`;
    const target = resolve(distDir, "collections", collection.handle, "index.html");
    const description = htmlToText(collection.customData?.heroSummary || collection.description || `Browse ${collection.title} at VS Store.`);
    tasks.push({ target, content: renderDocument(template, {
      path,
      title: `${collection.title} | VS Store`,
      description: description.length <= 158 ? description : `${description.slice(0, 155).replace(/\s+\S*$/, "")}...`,
      body: collectionBody(collection),
      structuredData: collectionStructuredData(collection),
    }) });
  }

  await writeGeneratedPages(tasks);
  process.stdout.write(`Generated ${tasks.length} crawlable SEO/AEO HTML pages (${products.length} products, ${collections.length} collections) with ${WRITE_CONCURRENCY} concurrent writers.\n`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
