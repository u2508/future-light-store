#!/usr/bin/env node

import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { US_SHIPPING_PROMISE } from "../src/lib/shipping-promise.mjs";
import {
  buildCollectionAnswer,
  buildHomepageAnswer,
  buildHomepageMetaDescription,
  formatProductPriceRange,
  resolveCollectionProducts,
} from "./lib/future-light-seo-page-content.mjs";

const rootDir = process.cwd();
const distDir = resolve(rootDir, "dist");
const publicDir = resolve(rootDir, "public");
const siteUrl = String(process.env.VITE_SITE_URL || "https://future-light-store.vercel.app")
  .trim()
  .replace(/\/+$/, "");
const productIndexPath = resolve(publicDir, "data", "products.json");
const collectionsPath = resolve(publicDir, "data", "collections.json");
const collectionProductsPath = resolve(publicDir, "data", "collection-products.json");
const knowledgePath = resolve(rootDir, "output", "product-knowledge.json");
const productSeoPath = resolve(publicDir, "data", "product-seo.json");
const WRITE_CONCURRENCY = Math.max(4, Math.min(32, Number(process.env.SEO_STATIC_WRITE_CONCURRENCY || 16)));
const countFormatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

const STATIC_PAGES = [
  {
    path: "/",
    title: "VS Associates — Product Discovery Made Clear",
    description: "Shop useful products across electronics, home, fashion, travel, wellness and more at VS Associates with clear details and secure checkout.",
    heading: "Discover products that fit your everyday life",
    summary: "Explore a carefully organized catalog with practical product details, transparent pricing and tracked fulfilment.",
    answerBlocks: [
      {
        question: "What is VS Associates?",
        answer: "VS Associates is a curated online marketplace for practical everyday essentials, future-ready tech and lifestyle accessories, with secure Shopify checkout and tracked fulfilment.",
      },
      {
        question: "How can I find the right product?",
        answer: "Shop by collection, search the catalog, or compare products by price, availability, category, brand, size, colour and discount.",
      },
      {
        question: "Can I track a VS Associates order?",
        answer: "Yes. Enter the order number and checkout email on the track-order page to view the latest fulfilment status and carrier tracking links.",
      },
      {
        question: "How long does US shipping take?",
        answer: `${US_SHIPPING_PROMISE.summary}. Shopify confirms the eligible service and final charge for the entered address and cart before payment.`,
      },
    ],
  },
  {
    path: "/shop",
    title: "Shop All Products | VS Associates",
    description: "Browse the full VS Associates catalog by product type, category, price and practical use.",
    heading: "Shop all products",
    summary: "Search the full catalog and compare product details before you order.",
  },
  {
    path: "/collections",
    title: "Product Collections | VS Associates",
    description: "Browse VS Associates collections organized by product type, use case, price range and seasonal shopping intent.",
    heading: "Browse collections",
    summary: "Find a focused starting point for your next purchase.",
  },
  {
    path: "/offers",
    title: "Offers and Value Picks | VS Associates",
    description: "Find current VS Associates offers and value picks with product details, pricing and delivery information.",
    heading: "Offers and value picks",
    summary: "Compare available value-focused products and current offers.",
  },
  {
    path: "/about",
    title: "About VS Associates",
    description: "Learn how VS Associates organizes useful products with clear information, secure checkout and tracked fulfilment.",
    heading: "About VS Associates",
    summary: "VS Associates helps shoppers discover practical products with clearer product information and a straightforward buying experience.",
  },
  {
    path: "/policies",
    title: "Policies & Support | VS Associates",
    description: "Read VS Associates shipping, returns, privacy and terms information before placing an order.",
    heading: "Policies & support",
    summary: "Review shipping, returns, privacy and terms information before ordering.",
  },
  {
    path: "/help",
    title: "Help and Shopping Information | VS Associates",
    description: "Get help with shopping, orders, delivery, returns and product questions at VS Associates.",
    heading: "How can we help?",
    summary: "Find answers before and after placing an order.",
    faqs: [
      {
        question: "How long does delivery take?",
        answer: `${US_SHIPPING_PROMISE.summary}. Shopify confirms the eligible service and final charge for the entered address and cart before payment.`,
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
    title: "Track Your Order | VS Associates",
    description: "Use VS Associates order information to check delivery progress and get help with an order.",
    heading: "Track your order",
    summary: "Check the status of your VS Associates purchase.",
  },
  ...["shipping", "returns", "privacy", "terms"].map((slug) => ({
    path: `/policies/${slug}`,
    title: `${slug[0].toUpperCase()}${slug.slice(1)} Policy | VS Associates`,
    description: `Read the VS Associates ${slug} policy and understand the terms that apply to your shopping experience.`,
    heading: `${slug[0].toUpperCase()}${slug.slice(1)} policy`,
    summary: `Review the VS Associates ${slug} information before ordering.`,
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

function productMetaDescription(product, knowledge, seo) {
  const optimized = String(seo?.seoDescription || "").trim();
  if (optimized) return optimized;
  const summaryTail = usefulProductSummary(product, knowledge)
    .replace(new RegExp(`^${escapeRegExp(product.title)}\\s*`, "i"), "")
    .trim();
  const summary = /^is\b/i.test(summaryTail) ? `This product ${summaryTail}` : summaryTail;
  const value = `Shop ${product.title} at VS Associates. ${summary}`;
  return value.length <= 158 ? value : `${value.slice(0, 155).replace(/\s+\S*$/, "")}...`;
}

function imageUrls(product) {
  return (Array.isArray(product.images) ? product.images : [])
    .map((image) => image?.src || image?.url)
    .filter(Boolean)
    .slice(0, 8);
}

function primaryImage(product) {
  return (Array.isArray(product.images) ? product.images : [])
    .find((image) => image?.src || image?.url) || null;
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

function productStructuredData(product, knowledge, seo, catalogDate) {
  const url = canonicalUrl(`/products/${product.handle}`);
  const optimizedTitle = String(seo?.seoTitle || seo?.title || product.title).trim();
  const optimizedDescription = String(seo?.seoDescription || usefulProductSummary(product, knowledge)).trim();
  const offer = firstOffer(product);
  const graph = [
    {
      "@type": "Product",
      name: optimizedTitle,
      description: optimizedDescription,
      url,
      image: imageUrls(product),
      dateModified: product.updated_at || catalogDate,
      ...(product.vendor ? { brand: { "@type": "Brand", name: product.vendor } } : {}),
      ...(offer ? { offers: offer } : {}),
    },
    {
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: canonicalUrl("/") },
        { "@type": "ListItem", position: 2, name: "Shop all", item: canonicalUrl("/shop") },
        { "@type": "ListItem", position: 3, name: optimizedTitle, item: url },
      ],
    },
  ];
  return { "@context": "https://schema.org", "@graph": graph };
}

function collectionStructuredData(collection, products = [], catalogDate) {
  const url = canonicalUrl(`/collections/${collection.handle}`);
  const faq = collectionFaqs(collection, products.length, catalogDate);
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "CollectionPage",
        name: collection.title,
        description: htmlToText(collection.description || collection.customData?.heroSummary || `Browse ${collection.title} at VS Associates.`),
        url,
        dateModified: collection.updated_at || catalogDate,
        ...(collection.image?.src ? { image: collection.image.src } : {}),
        mainEntity: {
          "@type": "ItemList",
          numberOfItems: products.length,
          itemListElement: products.slice(0, 12).map((product, index) => ({
            "@type": "ListItem",
            position: index + 1,
            name: product.title,
            url: canonicalUrl(`/products/${product.handle}`),
          })),
        },
      },
      {
        "@type": "FAQPage",
        url,
        mainEntity: faq.map(({ question, answer }) => ({
          "@type": "Question",
          name: question,
          acceptedAnswer: { "@type": "Answer", text: answer },
        })),
      },
    ],
  };
}

function rootStructuredData(homepage, modifiedAt) {
  const graph = [
    {
      "@type": "Organization",
      name: "VS Associates",
      url: canonicalUrl("/"),
      logo: canonicalUrl("/favicon.svg"),
    },
    {
      "@type": "WebSite",
      name: "VS Associates",
      url: canonicalUrl("/"),
      description: "A curated online marketplace for practical everyday essentials, home, tech and lifestyle products.",
      potentialAction: {
        "@type": "SearchAction",
        target: `${canonicalUrl("/search")}?q={search_term_string}`,
        "query-input": "required name=search_term_string",
      },
    },
    {
      "@type": "WebPage",
      name: homepage.title,
      description: homepage.summary,
      url: canonicalUrl("/"),
      dateModified: modifiedAt,
    },
  ];
  if (homepage.answerBlocks?.length) {
    graph.push({
      "@type": "FAQPage",
      url: canonicalUrl("/"),
      mainEntity: homepage.answerBlocks.map(({ question, answer }) => ({
        "@type": "Question",
        name: question,
        acceptedAnswer: { "@type": "Answer", text: answer },
      })),
    });
  }
  return {
    "@context": "https://schema.org",
    "@graph": graph,
  };
}

function answerBlocksMarkup(blocks = []) {
  if (!blocks.length) return "";
  return `<section aria-labelledby="answer-guide"><h2 id="answer-guide">Frequently asked questions</h2><dl>${blocks
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
  const collectionLinks = (page.collectionDirectory || []).map((collection) =>
    `<tr><th scope="row"><a href="${escapeHtml(`/collections/${collection.handle}`)}">${escapeHtml(collection.title)}</a></th><td>${escapeHtml(countFormatter.format(collection.productCount))}</td></tr>`,
  ).join("");
  const directory = collectionLinks
    ? `<section aria-labelledby="collection-directory"><h2 id="collection-directory">Browse collections</h2><table><thead><tr><th scope="col">Collection</th><th scope="col">Catalog listings</th></tr></thead><tbody>${collectionLinks}</tbody></table></section>`
    : "";
  const heroImage = page.heroImage
    ? `<figure><img src="${escapeHtml(page.heroImage)}" alt="VS Associates — practical everyday essentials, home, tech and lifestyle finds" loading="eager" width="1200" height="640" style="max-width:100%;height:auto" /><figcaption>VS Associates product discovery and everyday essentials.</figcaption></figure>`
    : "";
  const shoppingSteps = page.path === "/"
    ? `<section aria-labelledby="shopping-steps"><h2 id="shopping-steps">How to shop VS Associates</h2><ol><li>Choose a collection or search for the product you need.</li><li>Review product photos, listing details, available variants and listed prices.</li><li>Confirm the selected option, address-specific shipping and final total in Shopify checkout before payment.</li></ol></section>`
    : "";
  const internalLinks = page.path === "/" ? "" : `<nav aria-label="Company information"><a href="/shop">Shop all</a> · <a href="/collections">Collections</a> · <a href="/policies/shipping">Shipping</a> · <a href="/policies/returns">Returns</a> · <a href="/help">Help</a></nav>`;
  return `<main><h1>${escapeHtml(page.heading)}</h1><p>${escapeHtml(page.summary)}</p>${heroImage}${internalLinks}${answerBlocksMarkup(page.answerBlocks)}${shoppingSteps}${faqMarkup(page.faqs)}${directory}</main>`;
}

function staticStructuredData(page) {
  const webPage = {
    "@type": "WebPage",
    name: page.title,
    description: page.description,
    url: canonicalUrl(page.path),
    ...(page.dateModified ? { dateModified: page.dateModified } : {}),
  };
  const questions = [...(page.answerBlocks || []), ...(page.faqs || [])];
  const graph = [
    webPage,
    {
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: canonicalUrl("/") },
        ...(page.path === "/" ? [] : [{ "@type": "ListItem", position: 2, name: page.heading, item: canonicalUrl(page.path) }]),
      ],
    },
  ];
  if (!questions.length) return { "@context": "https://schema.org", "@graph": graph };
  graph.push({
    "@type": "FAQPage",
    mainEntity: questions.map((faq) => ({
      "@type": "Question",
      name: faq.question,
      acceptedAnswer: { "@type": "Answer", text: faq.answer },
    })),
  });
  return {
    "@context": "https://schema.org",
    "@graph": graph,
  };
}

function productBody(product, knowledge, seo) {
  const optimizedTitle = String(seo?.seoTitle || seo?.title || product.title).trim();
  const optimizedBody = sanitizeDescriptionHtml(seo?.descriptionHtml || "");
  const productImage = primaryImage(product);
  const image = productImage?.src || productImage?.url;
  const imageMarkup = image
    ? `<img src="${escapeHtml(image)}" alt="${escapeHtml(product.title)}" loading="eager" fetchpriority="high"${productImage.width ? ` width="${escapeHtml(productImage.width)}"` : ""}${productImage.height ? ` height="${escapeHtml(productImage.height)}"` : ""} style="max-width:100%;height:auto" />`
    : "";
  const listedPrice = formatProductPriceRange(product);
  const priceMarkup = listedPrice
    ? `<p><strong>Listed variant price (USD):</strong> ${escapeHtml(listedPrice)}. Product options and the final order total are confirmed at Shopify checkout.</p>`
    : "";
  const shoppingNotes = `<section aria-labelledby="shipping-and-returns"><h2 id="shipping-and-returns">Shipping and returns</h2><p>${escapeHtml(US_SHIPPING_PROMISE.summary)}. See the <a href="/policies/shipping">shipping policy</a> and <a href="/policies/returns">returns policy</a>; checkout confirms address-specific options and totals.</p></section><nav aria-label="Continue shopping"><a href="/collections">Browse collections</a> · <a href="/help">Shopping help</a></nav>`;
  const breadcrumb = `<nav aria-label="Breadcrumb"><a href="/">Home</a> › <a href="/shop">Shop all</a></nav>`;
  if (optimizedBody) {
    return `<main>${breadcrumb}<article>${imageMarkup}<h1>${escapeHtml(optimizedTitle)}</h1>${optimizedBody}${priceMarkup}${shoppingNotes}</article></main>`;
  }
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
    `The ${optimizedTitle}`,
  );
  return `<main>${breadcrumb}<article>${imageMarkup}<h1>${escapeHtml(optimizedTitle)}</h1><p>${escapeHtml(summary)}</p>${priceMarkup}<section aria-label="Product details"><h2>Product details</h2><dl>${factsMarkup}</dl></section>${optionsMarkup}<section aria-label="Before ordering"><h2>Before ordering</h2><p>${escapeHtml(orderingText)}</p></section>${shoppingNotes}</article></main>`;
}

function collectionFaqs(collection, productCount, catalogDate) {
  const title = String(collection.title || "this").trim();
  return [
    {
      question: `What products are in the ${title} collection?`,
      answer: buildCollectionAnswer({ title, productCount, catalogDate }),
    },
    {
      question: "How long does US shipping take?",
      answer: `${US_SHIPPING_PROMISE.summary}. Shopify confirms the eligible service and final charge for the entered address and cart before payment.`,
    },
    {
      question: "How can I check product options and prices?",
      answer: "Open a product listing to review its available variants and listed prices. The selected option, availability and final order total are confirmed at Shopify checkout.",
    },
    {
      question: "Where can I check returns information?",
      answer: "Review the VS Associates returns policy for current eligibility, conditions and instructions before ordering.",
    },
  ];
}

function collectionBody(collection, products, productCount, catalogDate) {
  const description = htmlToText(collection.customData?.heroSummary || collection.description || `Browse ${collection.title} at VS Associates.`);
  const examples = products.slice(0, 8);
  const rows = examples.map((product) => {
    const price = formatProductPriceRange(product);
    return `<tr><th scope="row"><a href="${escapeHtml(`/products/${product.handle}`)}">${escapeHtml(product.title)}</a></th><td>${escapeHtml(price ? `${price} USD` : "See listing")}</td></tr>`;
  }).join("");
  const examplesMarkup = rows
    ? `<section aria-labelledby="collection-examples"><h2 id="collection-examples">Products in this collection</h2><p>Examples from the Shopify catalog snapshot; visit a product page for its full details and options.</p><table><thead><tr><th scope="col">Product</th><th scope="col">Listed variant price</th></tr></thead><tbody>${rows}</tbody></table><h3>How to compare products</h3><ol><li>Open a listing to inspect its photos and product-specific details.</li><li>Review the available variant names and listed price range.</li><li>Confirm option availability, shipping and the final total at Shopify checkout.</li></ol></section>`
    : "";
  const answer = buildCollectionAnswer({ title: collection.title, productCount, catalogDate });
  const faqs = collectionFaqs(collection, productCount, catalogDate);
  const image = collection.image?.src
    ? `<img src="${escapeHtml(collection.image.src)}" alt="${escapeHtml(collection.image.alt || `${collection.title} collection`)}" loading="eager" style="max-width:100%;height:auto" />`
    : "";
  return `<main><nav aria-label="Breadcrumb"><a href="/">Home</a> › <a href="/collections">Collections</a></nav>${image}<h1>${escapeHtml(collection.title)}</h1><p>${escapeHtml(answer)}</p><p>${escapeHtml(description)}</p>${examplesMarkup}<p>${escapeHtml(US_SHIPPING_PROMISE.summary)}. <a href="/policies/shipping">Shipping details</a> · <a href="/policies/returns">Returns</a> · <a href="/help">Shopping help</a>.</p>${faqMarkup(faqs)}</main>`;
}

function renderDocument(template, { path, title, description, body, structuredData, ogType = "website", ogImage }) {
  const canonical = canonicalUrl(path);
  const socialImage = ogImage || canonicalUrl("/favicon.svg");
  const staticHeadAttr = ' data-vs-static-head="true"';
  // Preserve the closing tag on Vite's external module script. Matching only
  // through the first `>` turns `<script ...></script>` into an unclosed
  // script, causing every following stylesheet link to be parsed as script
  // text and leaving the deployed storefront unstyled.
  const assetTags = [...template.matchAll(/<link\b[^>]*>|<script\b[^>]*\bsrc=["'][^"']+["'][^>]*>(?:<\/script>)?/gi)]
    .map((match) => {
      // Vite's relative base keeps imported assets portable to Shopify's CDN.
      // Static HTML pages live at different depths, but their entry tags must
      // always start at the web root (not /collections/foo/assets/).
      const tag = match[0].replace(/\b(src|href)=(["'])\.\/assets\//g, "$1=$2/assets/");
      // Also repair an already-generated stale document so a partial local
      // build cannot silently drop the app entry while the fixed pipeline is
      // being rolled out.
      return /^<script\b/i.test(tag) && !/<\/script>$/i.test(tag) ? `${tag}</script>` : tag;
    })
    .filter((tag) => /rel=["'](?:stylesheet|modulepreload)["']|type=["']module["']/i.test(tag));
  const head = [
    `<meta charset="UTF-8"${staticHeadAttr} />`,
    `<meta name="viewport" content="width=device-width, initial-scale=1.0"${staticHeadAttr} />`,
    `<meta name="google-site-verification" content="T5OO6im9_fwXtSjarVqkZvx-JHYudcUe_B6jhJH-BeY"${staticHeadAttr} />`,
    `<meta name="description" content="${escapeHtml(description)}"${staticHeadAttr} />`,
    `<meta name="robots" content="index,follow,max-image-preview:large"${staticHeadAttr} />`,
    `<link rel="canonical" href="${escapeHtml(canonical)}"${staticHeadAttr} />`,
    `<meta property="og:title" content="${escapeHtml(title)}"${staticHeadAttr} />`,
    `<meta property="og:description" content="${escapeHtml(description)}"${staticHeadAttr} />`,
    `<meta property="og:type" content="${escapeHtml(ogType)}"${staticHeadAttr} />`,
    `<meta property="og:url" content="${escapeHtml(canonical)}"${staticHeadAttr} />`,
    `<meta property="og:site_name" content="VS Associates"${staticHeadAttr} />`,
    `<meta property="og:image" content="${escapeHtml(socialImage)}"${staticHeadAttr} />`,
    `<meta property="og:image:alt" content="${escapeHtml(title)}"${staticHeadAttr} />`,
    `<meta name="twitter:card" content="summary_large_image"${staticHeadAttr} />`,
    `<meta name="twitter:image" content="${escapeHtml(socialImage)}"${staticHeadAttr} />`,
    `<title${staticHeadAttr}>${escapeHtml(title)}</title>`,
    `<link rel="icon" href="/favicon.svg" type="image/svg+xml" />`,
    ...assetTags,
    `<script type="application/ld+json"${staticHeadAttr}>${escapeJson(structuredData)}</script>`,
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

function assertFreshLiveCatalog(productsManifest, collectionsPayload) {
  const generatedAt = String(productsManifest?.generatedAt || collectionsPayload?.generatedAt || "");
  const source = String(productsManifest?.source || collectionsPayload?.source || "").trim();
  const parsedGeneratedAt = Date.parse(generatedAt);
  const maxAgeMs = Math.max(
    60_000,
    Number(process.env.SALT_WEB_BUILD_MAX_CATALOG_AGE_MS || 30 * 60 * 1000),
  );
  if (!source || !Number.isFinite(parsedGeneratedAt)) {
    throw new Error("Live catalog manifest is missing source or generatedAt; refusing stale build data.");
  }

  const expectedShopUrl = String(process.env.SALT_SHOP_URL || "").trim();
  if (expectedShopUrl) {
    const sourceHost = new URL(source).hostname;
    const expectedHost = new URL(expectedShopUrl).hostname;
    if (sourceHost !== expectedHost) {
      throw new Error(`Live catalog source ${sourceHost} does not match configured Shopify store ${expectedHost}.`);
    }
  }

  const ageMs = Date.now() - parsedGeneratedAt;
  if (ageMs > maxAgeMs) {
    throw new Error(
      `Live catalog snapshot is ${Math.round(ageMs / 60_000)} minutes old; refresh Shopify data before building.`,
    );
  }
  if (!Number(productsManifest?.total) || !Number(collectionsPayload?.total)) {
    throw new Error("Live catalog manifest is incomplete; refusing to build from fallback data.");
  }
}

function assertFreshCollectionMembership(membershipPayload, productsManifest, collectionsPayload) {
  const generatedAt = Date.parse(String(membershipPayload?.generatedAt || ""));
  const maxAgeMs = Math.max(
    60_000,
    Number(process.env.SALT_WEB_BUILD_MAX_CATALOG_AGE_MS || 30 * 60 * 1000),
  );
  if (!Number.isFinite(generatedAt) || Date.now() - generatedAt > maxAgeMs) {
    throw new Error("Live collection membership is missing or stale; refresh Shopify data before building.");
  }

  const expectedSourceHost = new URL(productsManifest.source).hostname;
  for (const payload of [membershipPayload, collectionsPayload]) {
    if (new URL(payload.source).hostname !== expectedSourceHost) {
      throw new Error("Product, collection, and collection-membership snapshots must come from the same Shopify store.");
    }
  }
  if (Number(membershipPayload.totalCollections) !== Number(collectionsPayload.total)) {
    throw new Error("Live collection membership is incomplete; refusing to generate partial collection pages.");
  }
}

async function defaultSocialImage() {
  try {
    const assets = await readdir(resolve(distDir, "assets"));
    const file = assets.find((name) => /^vs-og[-.].+\.(?:jpe?g|png|webp)$/i.test(name));
    if (file) return canonicalUrl(`/assets/${file}`);
  } catch {
    // The stable, crawlable brand mark remains available if the build has no OG asset.
  }
  return canonicalUrl("/favicon.svg");
}

async function main() {
  const template = (await readFile(resolve(distDir, "index.html"), "utf8"))
    .replace(/<div id="root">[\s\S]*?<\/div>/i, '<div id="root"></div>');
  const [productsManifest, collectionsPayload, collectionMembership, knowledge, seoPayload, defaultOgImage] = await Promise.all([
    readFile(productIndexPath, "utf8").then(JSON.parse),
    readFile(collectionsPath, "utf8").then(JSON.parse),
    readFile(collectionProductsPath, "utf8").then(JSON.parse),
    readFile(knowledgePath, "utf8").then(JSON.parse).catch(() => null),
    readFile(productSeoPath, "utf8").then(JSON.parse).catch(() => null),
    defaultSocialImage(),
  ]);
  assertFreshLiveCatalog(productsManifest, collectionsPayload);
  assertFreshCollectionMembership(collectionMembership, productsManifest, collectionsPayload);
  const products = await loadProducts();
  const knowledgeByHandle = productKnowledgeByHandle(knowledge);
  const seoByHandle = new Map((seoPayload?.products || []).map((record) => [record.handle, record]));
  const collections = collectionsPayload.collections || [];
  const productsById = new Map(products.map((product) => [String(product.id), product]));
  const membershipByHandle = collectionMembership.collections || {};
  const catalogDate = new Date(productsManifest.generatedAt).toISOString().slice(0, 10);
  const collectionProducts = new Map(collections.map((collection) => {
    const ids = membershipByHandle[collection.handle]?.productIds || [];
    const members = resolveCollectionProducts(ids, productsById);
    return [collection.handle, members];
  }));
  const collectionDirectory = collections
    .filter((collection) => collection?.handle)
    .map((collection) => ({
      handle: collection.handle,
      title: collection.title,
      productCount: collectionProducts.get(collection.handle)?.length || 0,
    }))
    .filter((collection) => collection.productCount > 0)
    .sort((left, right) => left.title.localeCompare(right.title))
    .slice(0, 12);
  const homepage = {
    ...STATIC_PAGES.find((page) => page.path === "/"),
    description: buildHomepageMetaDescription({
      productCount: products.length,
      collectionCount: collections.length,
    }),
    summary: buildHomepageAnswer({
      productCount: products.length,
      collectionCount: collections.length,
      catalogDate,
      shippingSummary: `${US_SHIPPING_PROMISE.summary}. Shopify confirms the eligible service and final charge for the entered address and cart before payment.`,
    }),
    heroImage: defaultOgImage,
    dateModified: productsManifest.generatedAt,
    collectionDirectory,
  };

  const tasks = [];
  for (const page of STATIC_PAGES) {
    const currentPage = page.path === "/" ? homepage : page;
    const target = page.path === "/" ? resolve(distDir, "index.html") : resolve(distDir, page.path.slice(1), "index.html");
    tasks.push({ target, content: renderDocument(template, {
      ...currentPage,
      structuredData: page.path === "/"
        ? rootStructuredData(homepage, productsManifest.generatedAt)
        : staticStructuredData(currentPage),
      body: staticBody(currentPage),
      ogImage: defaultOgImage,
    }) });
  }

  for (const product of products) {
    const path = `/products/${product.handle}`;
    const target = resolve(distDir, "products", product.handle, "index.html");
    const knowledgeRecord = knowledgeByHandle.get(product.handle);
    const seoRecord = seoByHandle.get(product.handle);
    tasks.push({ target, content: renderDocument(template, {
      path,
      title: `${seoRecord?.seoTitle || seoRecord?.title || product.title} | VS Associates`,
      description: productMetaDescription(product, knowledgeRecord, seoRecord),
      body: productBody(product, knowledgeRecord, seoRecord),
      structuredData: productStructuredData(product, knowledgeRecord, seoRecord, catalogDate),
      ogImage: imageUrls(product)[0] || defaultOgImage,
      ogType: "product",
    }) });
  }

  for (const collection of collections.filter((entry) => entry?.handle)) {
    const path = `/collections/${collection.handle}`;
    const target = resolve(distDir, "collections", collection.handle, "index.html");
    const members = collectionProducts.get(collection.handle) || [];
    const description = buildCollectionAnswer({
      title: collection.title,
      productCount: members.length,
      catalogDate,
    });
    tasks.push({ target, content: renderDocument(template, {
      path,
      title: `${collection.title} | VS Associates`,
      description: description.length <= 158 ? description : `${description.slice(0, 155).replace(/\s+\S*$/, "")}...`,
      body: collectionBody(collection, members, members.length, catalogDate),
      structuredData: collectionStructuredData(collection, members, catalogDate),
      ogImage: collection.image?.src || members.flatMap(imageUrls)[0] || defaultOgImage,
    }) });
  }

  await writeGeneratedPages(tasks);
  process.stdout.write(`Generated ${tasks.length} crawlable SEO/AEO HTML pages (${products.length} products, ${collections.length} collections) with ${WRITE_CONCURRENCY} concurrent writers.\n`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
