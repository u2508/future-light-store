#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const rootDir = resolve(import.meta.dirname, "..");
const sourceCommit = String(process.env.FUTURE_LIGHT_SEO_SOURCE_COMMIT || "ebfd860").trim();
const liveMediaPath = resolve(rootDir, process.env.FUTURE_LIGHT_LIVE_MEDIA_CATALOG_INPUT || "output/shopify-live-product-media-catalog-20260919.json");
const outputPath = resolve(rootDir, process.env.FUTURE_LIGHT_CURATED_SEO_OUTPUT || "output/future-light-curated-product-seo-artifact-20260919.json");

const NOISE = new Set([
  "a", "about", "all", "and", "as", "at", "by", "for", "from", "in", "into", "is", "it", "new", "of", "on", "or", "the", "to", "with",
  "best", "cheap", "classic", "cool", "daily", "fashion", "high", "hot", "latest", "original", "popular", "premium", "quality", "sale", "style", "supplier", "top", "wholesale", "women", "womens", "men", "mens", "girls", "boys", "unisex", "2024", "2025", "2026",
]);

const ACRONYMS = new Map([
  ["3d", "3D"], ["8bitdo", "8BitDo"], ["ai", "AI"], ["anc", "ANC"], ["aux", "AUX"], ["baseus", "Baseus"], ["bluetooth", "Bluetooth"], ["c", "C"], ["dji", "DJI"], ["f91w", "F91W"], ["fm", "FM"], ["gb", "GB"], ["gamesir", "GameSir"], ["gps", "GPS"], ["hdmi", "HDMI"], ["hifi", "Hi-Fi"], ["ips", "IPS"], ["iphone", "iPhone"], ["ipad", "iPad"], ["ipx", "IPX"], ["kz", "KZ"], ["led", "LED"], ["lenovo", "Lenovo"], ["mah", "mAh"], ["magsafe", "MagSafe"], ["mp3", "MP3"], ["pc", "PC"], ["pbt", "PBT"], ["ps5", "PS5"], ["qcy", "QCY"], ["rgb", "RGB"], ["sd", "SD"], ["tpu", "TPU"], ["tws", "TWS"], ["tv", "TV"], ["ubgreen", "UGREEN"], ["ugreen", "UGREEN"], ["usb", "USB"], ["vfd", "VFD"], ["vr", "VR"], ["xbox", "Xbox"], ["y2k", "Y2K"],
]);

const FAMILY_RULES = [
  ["game-controller", "gaming controller", /\b(?:controller|gamepad|joystick|gaming[- ]?pad)\b/i],
  ["tablet-case", "tablet case", /\b(?:ipad|tablet|kindle|galaxy[ -]?tab|surface)\b[\s\S]*\b(?:case|cover|shell)\b|\b(?:case|cover|shell)\b[\s\S]*\b(?:ipad|tablet|kindle|galaxy[ -]?tab|surface)\b/i],
  ["phone-case", "phone case", /\b(?:phone[- ]?case|phone[- ]?cover|phone[- ]?shell|bumper[- ]?cover)\b/i],
  ["gimbal", "phone gimbal", /\b(?:gimbal|stabilizer)\b/i],
  ["holder-stand", "device stand or holder", /\b(?:phone[- ]?holder|headphone[- ]?stand|headset[- ]?stand|tripod[- ]?stand|mount|bracket)\b/i],
  ["cable", "cable or adapter", /\b(?:cable|adapter|splitter|charger|charging[- ]?dock|switcher)\b/i],
  ["watch", "watch", /\b(?:smart[- ]?watch|smartwatch|wristwatch|watch[- ]?strap|watches|watch)\b/i],
  ["fitness", "fitness accessory", /\b(?:fitness|workout|resistance|exercise|yoga|gym)\b/i],
  ["pet", "pet accessory", /\b(?:pet|dog|cat|leash|collar)\b/i],
  ["earbuds", "audio accessory", /\b(?:earbuds?|earphones?|headphones?|headset|earphone)\b/i],
  ["camera", "camera accessory", /\b(?:camera|camcorder|webcam|lens)\b/i],
  ["backpack", "backpack", /\b(?:backpack|knapsack|daypack)\b/i],
  ["bag", "bag or organizer", /\b(?:bag|tote|purse|wallet|organizer|pouch|case)\b/i],
  ["shirt", "shirt or top", /\b(?:t[- ]?shirt|shirt|blouse|top|tee)\b/i],
  ["outerwear", "outerwear piece", /\b(?:jacket|coat|hoodie|sweater|cardigan|pullover|vest)\b/i],
  ["bottoms", "clothing piece", /\b(?:pants|shorts|jeans|skirt|leggings|tights|pantyhose)\b/i],
  ["dress", "dress", /\b(?:dress|jumpsuit|romper)\b/i],
  ["skincare", "skin-care product", /\b(?:skincare|skin[- ]?care|serum|toner|moisturizer|moisturiser|essence|facial[- ]?cream|face[- ]?cream|acne[- ]?treatment|red[- ]?light|led[- ]?mask)\b/i],
  ["beauty-tool", "beauty tool", /\b(?:makeup[- ]?brush|lip[- ]?mask[- ]?brush|lip[- ]?brush|applicator|cosmetic[- ]?puff|makeup[- ]?sponge|beauty[- ]?sponge|powder[- ]?puff|face[- ]?roller)\b/i],
  ["makeup", "beauty product", /\b(?:makeup|blush|powder|mascara|eyebrow|lipstick|lip[- ]?liner|concealer|foundation|cosmetic)\b/i],
  ["jewelry", "jewelry piece", /\b(?:jewelry|necklace|bracelet|earring|pendant|ring)\b/i],
  ["toy", "toy or game", /\b(?:toy|puzzle|doll|building[- ]?block|montessori|board[- ]?game)\b/i],
  ["light", "lighting accessory", /\b(?:light|lamp|lantern|led[- ]?strip|flashlight)\b/i],
  ["home-kitchen", "home or kitchen accessory", /\b(?:kitchen|cookware|utensil|spatula|towel|decor|decoration|home|storage)\b/i],
];

const FEATURE_RULES = [
  [/\bhall[- ]?effect\b/i, "Hall-Effect joysticks"],
  [/\brgb\b/i, "RGB lighting"],
  [/\bbluetooth\b/i, "Bluetooth connectivity"],
  [/\bwireless\b/i, "wireless operation"],
  [/\bwired\b/i, "wired connection"],
  [/\b(?:noise[- ]?cancel(?:ling|ing)|anc)\b/i, "noise-control features"],
  [/\b(?:magnetic|magsafe)\b/i, "magnetic attachment"],
  [/\bwaterproof\b/i, "waterproof construction"],
  [/\b(?:shockproof|anti[- ]?shock)\b/i, "shock-resistant protection"],
  [/\b(?:usb[- ]?c|type[- ]?c)\b/i, "USB-C or Type-C connection"],
  [/\b(?:hdmi|arc|spdif)\b/i, "HDMI or digital-audio connectivity"],
  [/\b(?:4k|8k|120hz|144hz|vrr)\b/i, "the listed display specification"],
  [/\b(?:portable|foldable|adjustable|rotatable|360)\b/i, "portable or adjustable design"],
  [/\b(?:rechargeable|solar|hand[- ]?crank)\b/i, "rechargeable or alternative-power operation"],
  [/\b(?:quick[- ]?drying|breathable)\b/i, "quick-drying or breathable construction"],
];

const MATERIAL_RULES = [
  [/\bsilicone\b/i, "silicone construction"],
  [/\btpu\b/i, "TPU construction"],
  [/\bacrylic\b/i, "acrylic construction"],
  [/\bstainless[- ]?steel\b/i, "stainless-steel construction"],
  [/\bfaux[- ]?leather\b/i, "faux-leather construction"],
  [/\bcotton\b/i, "cotton construction"],
  [/\blinen\b/i, "linen construction"],
  [/\bwooden?\b/i, "wooden construction"],
  [/\bknitted\b/i, "knitted construction"],
  [/\bpolyester\b/i, "polyester construction"],
  [/\bnylon\b/i, "nylon construction"],
  [/\bmetal\b/i, "metal construction"],
  [/\bglass\b/i, "glass construction"],
];

const COMPATIBILITY_RULES = [
  [/\biphone\b/i, "iPhone"], [/\bipad\b/i, "iPad"], [/\bxbox\b/i, "Xbox"], [/\bnintendo[- ]?switch\b/i, "Nintendo Switch"], [/\bsteam[- ]?deck\b/i, "Steam Deck"], [/\bplaystation\b|\bps5\b/i, "PlayStation"], [/\bandroid\b/i, "Android"], [/\bwindows\b/i, "Windows"], [/\bmacbook\b/i, "MacBook"], [/\b(?:xiaomi|redmi|poco|oneplus|oppo|huawei|samsung)\b/i, "phone model"], [/\bdji\b/i, "DJI equipment"],
];

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalize(value) {
  return String(value || "").replace(/&nbsp;/gi, " ").replace(/\s+/g, " ").trim();
}

function stripHtml(value) {
  return normalize(String(value || "").replace(/<[^>]*>/g, " "));
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function tokens(value) {
  return normalize(value)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function meaningfulTokens(value) {
  return tokens(value).filter((token) => !NOISE.has(token) && !/^\d+$/.test(token));
}

function titleCaseWord(word) {
  const lower = String(word || "").toLowerCase();
  if (ACRONYMS.has(lower)) return ACRONYMS.get(lower);
  if (/^\d+(?:\.\d+)?(?:k|hz|gb|tb|mah|mm|cm|w|v)$/i.test(lower)) return lower.replace(/k$/i, "K").replace(/hz$/i, "Hz").replace(/gb$/i, "GB").replace(/tb$/i, "TB").replace(/mah$/i, "mAh").replace(/mm$/i, "mm").replace(/cm$/i, "cm").replace(/w$/i, "W").replace(/v$/i, "V");
  if (/^\d+(?:\.\d+)?$/.test(lower)) return lower;
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

function humanizePhrase(value) {
  const raw = normalize(value)
    .replace(/[_/]+/g, " ")
    .replace(/\bwomen s\b/gi, "women's")
    .replace(/\bmen s\b/gi, "men's")
    .replace(/\bkids s\b/gi, "kids'")
    .replace(/\bchildrens\b/gi, "children's")
    .replace(/\b3 5\b/g, "3.5")
    .replace(/\b2 1\b/g, "2.1")
    .replace(/\b0 96\b/g, "0.96")
    .replace(/\b(\d+)k\b/gi, "$1K")
    .replace(/\b(\d+)mah\b/gi, "$1mAh")
    .replace(/\btype c\b/gi, "Type-C")
    .replace(/\busb c\b/gi, "USB-C")
    .replace(/\bhall effect\b/gi, "Hall-Effect")
    .replace(/\bnoise cancelling\b/gi, "Noise-Cancelling");
  return raw.split(/\s+/).map((word) => {
    if (/^[A-Z0-9][A-Z0-9-]*$/.test(word) && !/[a-z]/.test(word)) return word;
    const punctuation = word.match(/[,.!?;:]$/)?.[0] || "";
    const bare = punctuation ? word.slice(0, -1) : word;
    return titleCaseWord(bare) + punctuation;
  }).join(" ").replace(/\s+([,.!?;:])/g, "$1").trim();
}

function familyFor(value) {
  const text = normalize(value);
  const find = (id) => FAMILY_RULES.find(([familyId]) => familyId === id);
  if (/\b(?:remote[- ]?control|page[- ]?turning|shutter[- ]?remote)\b/i.test(text)) return ["device-accessory", "device accessory", /$^/];
  if (/\b(?:controller|gamepad|joystick|gaming[- ]?pad)\b/i.test(text)) return find("game-controller");
  if (/\b(?:ipad|tablet|kindle|galaxy[ -]?tab|surface)\b[\s\S]*\b(?:case|cover|shell)\b|\b(?:case|cover|shell)\b[\s\S]*\b(?:ipad|tablet|kindle|galaxy[ -]?tab|surface)\b/i.test(text)) return find("tablet-case");
  if (/\b(?:phone[- ]?case|phone[- ]?cover|phone[- ]?shell|bumper[- ]?cover)\b/i.test(text)) return find("phone-case");
  if (/\b(?:gimbal|stabilizer)\b/i.test(text)) return find("gimbal");
  if (/\b(?:phone[- ]?holder|headphone[- ]?stand|headset[- ]?stand|tripod[- ]?stand|mount|bracket)\b/i.test(text)) return find("holder-stand");
  const audioMatch = text.match(/\b(?:earbuds?|earphones?|headphones?|headset|earphone)\b/i);
  const cableMatch = text.match(/\b(?:cable|adapter|splitter|charger|charging[- ]?dock|switcher)\b/i);
  if (cableMatch && (!audioMatch || cableMatch.index <= audioMatch.index || /\b(?:organizer|extension|hdmi|usb|type[- ]?c|aux)\b/i.test(text))) return find("cable");
  if (audioMatch) return find("earbuds");
  if (/\b(?:smart[- ]?watch|smartwatch|wristwatch|watch[- ]?strap|watch)\b/i.test(text)) return find("watch");
  if (/\b(?:camera|camcorder|webcam|lens)\b/i.test(text)) return find("camera");
  if (/\b(?:backpack|knapsack|daypack)\b/i.test(text)) return find("backpack");
  if (/\b(?:dress|jumpsuit|romper)\b/i.test(text)) return find("dress");
  if (/\b(?:jacket|coat|hoodie|sweater|cardigan|pullover|vest)\b/i.test(text)) return find("outerwear");
  if (/\b(?:pants|shorts|jeans|skirt|leggings|tights|pantyhose)\b/i.test(text)) return find("bottoms");
  if (/\b(?:t[- ]?shirt|shirt|blouse|top|tee)\b/i.test(text)) return find("shirt");
  if (/\b(?:pet|dog|cat|leash)\b/i.test(text)) return find("pet");
  if (/\b(?:skincare|skin[- ]?care|serum|toner|moisturizer|moisturiser|essence|facial[- ]?cream|face[- ]?cream|acne[- ]?treatment|red[- ]?light|led[- ]?mask)\b/i.test(text)) return find("skincare");
  if (/\b(?:makeup[- ]?brush|lip[- ]?mask[- ]?brush|lip[- ]?brush|applicator|cosmetic[- ]?puff|makeup[- ]?sponge|beauty[- ]?sponge|powder[- ]?puff|face[- ]?roller)\b/i.test(text)) return find("beauty-tool");
  if (/\b(?:makeup|blush|powder|mascara|eyebrow|lipstick|lip[- ]?liner|concealer|foundation|cosmetic)\b/i.test(text)) return find("makeup");
  if (/\b(?:jewelry|necklace|bracelet|earring|pendant|ring|beads?)\b/i.test(text)) return find("jewelry");
  if (/\b(?:toy|puzzle|doll|building[- ]?block|montessori|board[- ]?game)\b/i.test(text)) return find("toy");
  if (/\b(?:fitness|workout|resistance|exercise|yoga|gym)\b/i.test(text)) return find("fitness");
  if (/\b(?:light|lamp|lantern|led[- ]?strip|flashlight)\b/i.test(text)) return find("light");
  if (/\b(?:kitchen|cookware|utensil|spatula|towel|decor|decoration|home|storage)\b/i.test(text)) return find("home-kitchen");
  return FAMILY_RULES.find(([, , rule]) => rule.test(text)) || ["product", "product", /$^/];
}

function categoryConflict(sourceText, handleText) {
  const sourceFamily = familyFor(sourceText)[0];
  const handleFamily = familyFor(handleText)[0];
  if (sourceFamily === "product" || handleFamily === "product") return false;
  if (sourceFamily === handleFamily) return false;
  const compatiblePairs = new Set([
    "bag:backpack", "backpack:bag", "shirt:outerwear", "outerwear:shirt", "phone-case:bag", "bag:phone-case",
    "camera:gimbal", "gimbal:camera", "earbuds:camera", "camera:earbuds", "home-kitchen:bag", "bag:home-kitchen",
  ]);
  return !compatiblePairs.has(`${sourceFamily}:${handleFamily}`);
}

function handleTitle(handle) {
  const base = normalize(handle).replace(/-(?:\d+)$/, "");
  const raw = base.split("-").filter(Boolean);
  const words = [];
  for (const word of raw) {
    if (NOISE.has(word) && words.length > 0) continue;
    if (word === "ref" || word === "style") continue;
    if (words.at(-1) === word) continue;
    words.push(word);
  }
  const family = familyFor(base)[0];
  const familyIndex = words.findIndex((word) => FAMILY_RULES.find(([id]) => id === family)?.[2]?.test(word));
  const targetLength = Math.min(words.length, Math.max(9, familyIndex + 1, 12));
  const selected = words.slice(0, targetLength);
  const candidate = humanizePhrase(selected.join(" "));
  return candidate.length > 86 ? `${candidate.slice(0, 83).replace(/\s+\S*$/, "")}…` : candidate;
}

function sourceTitleIsUsable(sourceTitle, handle, imageAlt) {
  const clean = normalize(sourceTitle);
  if (clean.length < 20 || /\b(?:ref|style\s*\d+|everyday wear|generic accessory|jewelry accessory)\b/i.test(clean)) return false;
  if (/\bphone holder\b/i.test(clean) && /\bheadphone\b/i.test(handle) && !/\bphone[- ]?holder\b/i.test(handle)) return false;
  if (categoryConflict(clean, handle)) return false;
  const sourceSet = new Set(meaningfulTokens(clean));
  const evidenceSet = new Set(meaningfulTokens(handle));
  const overlap = [...sourceSet].filter((token) => evidenceSet.has(token)).length;
  return overlap >= Math.min(4, Math.max(2, Math.floor(sourceSet.size * 0.35)));
}

function titleCandidate(sourceTitle, handle, imageAlt) {
  const combined = `${handle} ${sourceTitle} ${imageAlt}`;
  let candidate = sourceTitleIsUsable(sourceTitle, handle, imageAlt) ? humanizePhrase(sourceTitle) : handleTitle(handle);
  if (/\b8bitdo\b.*\bultimate[- ]?c\b.*\bwired\b.*\bcontroller\b.*\bxbox\b/i.test(combined)) {
    candidate = "8BitDo Ultimate C Wired Xbox Controller";
  }
  if (/\b(?:controller|gamepad|joystick)\b/i.test(combined)) candidate = candidate.replace(/\b(?:fire|ring)\b/gi, "").replace(/\s{2,}/g, " ").trim();
  const additions = [];
  if (/\bhall[- ]?effect\b/i.test(combined) && !/hall[- ]?effect/i.test(candidate)) additions.push("Hall-Effect Sticks");
  if (/\brgb\b/i.test(combined) && !/\brgb\b/i.test(candidate)) additions.push("RGB Lighting");
  if (/\bbluetooth\b/i.test(combined) && !/bluetooth/i.test(candidate)) additions.push("Bluetooth");
  let result = normalize(`${candidate}${additions.length ? ` with ${additions.join(" & ")}` : ""}`);
  result = result.replace(/\s+-\s+Ref\s+\w+/i, "").replace(/\b(?:certified|official|genuine|guaranteed)\b/gi, "").replace(/\s{2,}/g, " ").replace(/\s+([,.])/g, "$1").trim();
  return result;
}

function fitProductTitle(value, maxLength = 70) {
  const text = normalize(value)
    .replace(/[.…]+$/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  const words = text.split(/\s+/);
  if (text.length <= maxLength) {
    while (words.length > 1 && /^(?:a|an|and|for|from|in|into|of|on|or|the|to|with|&)$/i.test(words.at(-1))) words.pop();
    return words.join(" ").trim();
  }

  while (words.length > 1 && words.join(" ").length > maxLength) words.pop();
  while (words.length > 1 && /^(?:a|an|and|for|from|in|into|of|on|or|the|to|with|&)$/i.test(words.at(-1))) words.pop();
  return words.join(" ").replace(/[,:;\-–—]+$/g, "").trim();
}

function lowerFirst(value) {
  const text = normalize(value);
  if (!text || /^[A-Z0-9][A-Z0-9-]*$/.test(text.split(/\s+/)[0])) return text;
  return `${text.charAt(0).toLowerCase()}${text.slice(1)}`;
}

function compactPhrase(value, maxWords = 12) {
  const words = humanizePhrase(normalize(value).replace(/[-_]+/g, " ")).split(/\s+/).filter(Boolean);
  return words.slice(0, maxWords).join(" ").replace(/[,:;\-–—]+$/g, "").trim();
}

function numberFacts(text) {
  const facts = [];
  const rawValues = text.match(/\b\d+(?:\.\d+)?\s?(?:mah|gb|tb|inch(?:es)?|in|hz|w|mm|cm|ml|oz|kg|v|pcs?|pieces?|colors?)\b/gi) || [];
  const seen = new Set();
  for (const rawValue of rawValues) {
    const value = normalize(rawValue).replace(/\s+(?=mah|gb|tb|inch|in|hz|w|mm|cm|ml|oz|kg|v|pcs|pieces|colors)/i, "");
    const key = value.toLowerCase().replace(/pieces?/g, "pcs").replace(/\s+/g, "");
    if (seen.has(key)) continue;
    seen.add(key);
    if (/mah$/i.test(value)) facts.push(`${value.replace(/mah/i, "mAh")} battery capacity`);
    else if (/(?:inch|in)$/i.test(value)) facts.push(`${value.replace(/inch(?:es)?/i, "-inch")} size or fit`);
    else if (/hz$/i.test(value)) facts.push(`${value.replace(/hz/i, "Hz")} refresh-rate specification`);
    else if (/(?:pcs?|pieces?)$/i.test(value)) facts.push(`${value.replace(/pieces?/i, "-piece").replace(/pcs?/i, "-piece")} option`);
    else facts.push(`${value} specification`);
  }
  return facts.slice(0, 4);
}

function optionFacts(options) {
  const values = asArray(options).map(normalize).filter(Boolean);
  if (!values.length) return [];
  const facts = [];
  const packs = [...new Set(values.map((value) => value.match(/\b\d+\s*(?:pcs?|pieces?)\b/i)?.[0]).filter(Boolean))];
  if (packs.length) facts.push(`Live options include ${packs.slice(0, 3).join(", ")} pack sizes`);
  const modelValues = values.filter((value) => !/^(?:black|white|red|blue|green|pink|gray|grey|purple|orange|yellow|brown|beige|gold|silver|default title)$/i.test(value));
  if (modelValues.length && !packs.length) facts.push(`Live options include ${modelValues.slice(0, 3).join(", ")}`);
  return facts;
}

function evidenceFacts(handle, sourceTitle, imageAlt, options = []) {
  const text = `${handle} ${sourceTitle} ${imageAlt}`.replace(/-/g, " ");
  const facts = [];
  for (const [rule, label] of FEATURE_RULES) {
    if (label === "waterproof construction" && /\bnon[- ]?waterproof\b/i.test(text)) continue;
    if (rule.test(text)) facts.push(label);
  }
  for (const [rule, label] of MATERIAL_RULES) if (rule.test(text)) facts.push(label);
  for (const [rule, label] of COMPATIBILITY_RULES) if (rule.test(text)) facts.push(`${label} compatibility`);
  facts.push(...numberFacts(text));
  facts.push(...optionFacts(options));

  const cleanImageAlt = compactPhrase(asArray(String(imageAlt || "").split(" | ").filter(Boolean))[0] || "");
  if (cleanImageAlt && !/^(?:image|product|photo|untitled)$/i.test(cleanImageAlt)) {
    facts.push(`Product imagery identifies ${cleanImageAlt}`);
  }
  const family = familyFor(text);
  if (facts.length < 2) {
    const identity = compactPhrase(sourceTitle || handle, 10);
    if (identity) facts.push(`The listing name specifies ${lowerFirst(identity)}`);
  }
  if (facts.length < 2) facts.push(`The URL handle identifies a ${family[1]} listing`);
  return [...new Set(facts)].slice(0, 6);
}

function optionValues(product) {
  const values = [];
  for (const variant of asArray(product?.variants?.nodes)) {
    for (const option of asArray(variant?.selectedOptions)) {
      const value = normalize(option?.value);
      if (value && value.toLowerCase() !== "default title" && !values.some((entry) => entry.toLowerCase() === value.toLowerCase())) values.push(value);
    }
  }
  return values.slice(0, 10);
}

function familyLead(title, familyId, familyLabel, facts) {
  const leads = {
    "game-controller": `${title} is a gaming controller for a focused console or PC setup.`,
    "tablet-case": `${title} is a protective tablet case for the model and fit options shown in this listing.`,
    "phone-case": `${title} is a phone case for the model and fit details shown in this listing.`,
    gimbal: `${title} is a handheld phone gimbal or stabilizer for smoother mobile filming.`,
    "holder-stand": `${title} is a stand or holder designed to keep the listed device or accessory in place.`,
    cable: `${title} is a cable or adapter for the connection, charging, or signal use named in this listing.`,
    watch: `${title} is a wearable watch listing with the finish, features, or fit options shown below.`,
    fitness: `${title} is a fitness accessory for the workout or training use described in the listing.`,
    pet: `${title} is a pet-care accessory for the grooming, feeding, travel, or play use shown in the listing.`,
    earbuds: `${title} is an audio accessory for personal listening, with the connection details shown below.`,
    camera: `${title} is a camera accessory for the equipment or shooting setup named in the listing.`,
    backpack: `${title} is a backpack for carrying the items and travel or everyday use described in the listing.`,
    bag: `${title} is a bag or organizer for the storage and carry use shown in the product listing.`,
    shirt: `${title} is a shirt or top with the listed material, fit, and size options.`,
    outerwear: `${title} is an outerwear piece with the listed style, material, and size details.`,
    bottoms: `${title} is a clothing piece with the listed fit, material, and size options.`,
    dress: `${title} is a dress or one-piece outfit with the listed style and size details.`,
    skincare: `${title} is a skin-care product for the routine and application format named in the listing.`,
    "beauty-tool": `${title} is a beauty tool for the application or grooming task named in the listing.`,
    makeup: `${title} is a beauty product with the finish, shade, or application details shown in the listing.`,
    jewelry: `${title} is a jewelry piece with the listed finish, style, and option details.`,
    toy: `${title} is a toy or game selected for the play format and age or use cues shown in the listing.`,
    light: `${title} is a lighting accessory for the room, desk, travel, or outdoor use described in the listing.`,
    "home-kitchen": `${title} is a home or kitchen accessory for the everyday use shown in the product listing.`,
    "device-accessory": `${title} is a device accessory for the remote, control, or page-turning use named in the listing.`,
  };
  const base = leads[familyId] || `The listing is for ${title}, with its live option values and media details recorded below.`;
  const detailText = facts.slice(0, 2).map(lowerFirst).join(" and ");
  return detailText ? `${base} Product-specific details include ${detailText}.` : base;
}

function orderGuidance(familyId, familyLabel) {
  const guidance = {
    "tablet-case": "Confirm the tablet model, color, and cover style selected before checkout.",
    "phone-case": "Confirm the phone model and color or finish selected before checkout.",
    "game-controller": "Confirm the console or connection format and included pieces shown for the selected option.",
    cable: "Confirm the connector type, device compatibility, and length or pack details shown for the selected option.",
    earbuds: "Confirm the color, connection format, and included charging or audio pieces shown for the selected option.",
    watch: "Confirm the case or strap finish and size details shown for the selected option.",
    apparel: "Confirm the color, size, and material details shown for the selected option.",
    shirt: "Confirm the color, size, and material details shown for the selected option.",
    outerwear: "Confirm the color, size, and material details shown for the selected option.",
    bottoms: "Confirm the color, size, and material details shown for the selected option.",
    dress: "Confirm the color, size, and material details shown for the selected option.",
    skincare: "Confirm the treatment format, power option, and included accessories shown for the selected option.",
    "beauty-tool": "Confirm the tool style, color, and pack size shown for the selected option.",
    makeup: "Confirm the shade, finish, and pack details shown for the selected option.",
    jewelry: "Confirm the finish, size, and included pieces shown for the selected option.",
    pet: "Confirm the size, material, and intended pet use shown for the selected option.",
    toy: "Confirm the play format, age guidance, and included pieces shown for the selected option.",
    light: "Confirm the power format, size, and lighting specification shown for the selected option.",
  };
  return guidance[familyId] || `Confirm the ${familyLabel} option, size, and included pieces shown above before checkout.`;
}

function htmlBody(title, familyId, familyLabel, facts, options) {
  const lead = familyLead(title, familyId, familyLabel, facts);
  const optionText = options.length ? `This listing offers ${options.map(escapeHtml).join(", ")}. Select the exact option so the displayed image and specifications match your choice.` : `Select the exact ${escapeHtml(familyLabel)} version shown on the product page so the displayed image and specifications match your choice.`;
  const factsHtml = facts.map((fact) => `<li>${escapeHtml(fact)}.</li>`).join("\n");
  return `<h2>${escapeHtml(title)}</h2>\n<p>${escapeHtml(lead)}</p>\n<h3>Product details</h3>\n<ul>\n${factsHtml}\n</ul>\n<h3>Choose your version</h3>\n<p>${optionText}</p>\n<h3>Before ordering</h3>\n<p>${escapeHtml(orderGuidance(familyId, familyLabel))}</p>`;
}

function seoDescription(title, facts) {
  const first = facts[0] || "the product format named in the listing";
  const second = facts[1] || "the option details shown on the product page";
  const text = `Shop ${title} at VS Store. Product details include ${lowerFirst(first)} and ${lowerFirst(second)}. Review the selected option before ordering.`;
  return text.length <= 170 ? text : `${text.slice(0, 167).replace(/\s+\S*$/, "")}...`;
}

function imageEvidence(product, source) {
  const isTrustedAlt = (value) => !/casual graphic t shirt|jewelry accessory for everyday wear|interactive cat toy for pets|wired headset for everyday audio|button-down shirt for everyday use|generic accessory/i.test(value);
  const sourceAlts = asArray(source?.images).map((image) => normalize(image?.alt)).filter(Boolean).filter(isTrustedAlt);
  const liveAlts = asArray(product?.media?.nodes).map((media) => normalize(media?.image?.altText || media?.alt)).filter(Boolean).filter(isTrustedAlt);
  return [...new Set([...sourceAlts, ...liveAlts])].slice(0, 8);
}

function legacyProducts() {
  try {
    const raw = execFileSync("git", ["show", `${sourceCommit}:public/data/products-0001.json`], { encoding: "utf8", maxBuffer: 160 * 1024 * 1024 });
    const parsed = JSON.parse(raw);
    return asArray(parsed?.products || parsed);
  } catch (error) {
    throw new Error(`Could not load clean pre-corruption product evidence from ${sourceCommit}: ${error.message}`);
  }
}

async function main() {
  const livePayload = JSON.parse(await readFile(liveMediaPath, "utf8"));
  const liveProducts = asArray(livePayload?.products).filter((product) => asArray(product?.resourcePublications?.nodes).some((entry) => entry?.isPublished && String(entry?.channel?.name || "").toLowerCase() === "online store"));
  const legacyByHandle = new Map(legacyProducts().map((product) => [normalize(product?.handle), product]));
  const usedTitles = new Map();
  const products = [];
  for (const live of liveProducts) {
    const handle = normalize(live?.handle);
    const legacy = legacyByHandle.get(handle) || {};
    const imageAlts = imageEvidence(live, legacy);
    const sourceTitle = normalize(legacy?.title);
    const handleEvidence = `${handle} ${sourceTitle} ${imageAlts.join(" ")}`;
    let title = fitProductTitle(titleCandidate(sourceTitle, handle, imageAlts[0] || ""));
    const originalTitle = title;
    const seen = usedTitles.get(title.toLowerCase()) || 0;
    if (seen > 0) {
      const suffix = ` — Listing ${seen + 1}`;
      title = `${fitProductTitle(title, 70 - suffix.length)}${suffix}`.trim();
    }
    usedTitles.set(originalTitle.toLowerCase(), seen + 1);
    const family = familyFor(handleEvidence);
    const options = optionValues(live);
    const facts = evidenceFacts(handle, sourceTitle, imageAlts.join(" | "), options);
    const descriptionHtml = htmlBody(title, family[0], family[1], facts, options);
    const seoTitle = title.length > 70 ? `${title.slice(0, 67).replace(/\s+\S*$/, "")}…` : title;
    const evidenceText = `${handle} ${sourceTitle} ${imageAlts.join(" ")} ${options.join(" ")} ${facts.join(" ")}`;
    const bodyText = stripHtml(descriptionHtml);
    const issues = [];
    if (!title || title.length < 20) issues.push("title-too-short");
    if (!meaningfulTokens(title).some((token) => tokens(handleEvidence).includes(token))) issues.push("title-lacks-handle-overlap");
    if (bodyText.length < 220) issues.push("description-too-short");
    if (facts.filter((fact) => meaningfulTokens(fact).some((token) => tokens(evidenceText).includes(token))).length < 1) issues.push("description-lacks-evidence");
    if (/jewelry accessory for everyday wear|interactive cat toy for pets|considered piece|finish a look|available choices|generic accessory|general merchandise|the listed material or finish|product images and url handle provide|format is identified by the product title and imagery|the listing calls out|compare the selected model|select the exact version shown/i.test(`${title} ${descriptionHtml}`)) issues.push("generic-or-wrong-copy");
    if (/guaranteed|cure|certified|official|genuine|clinically proven/i.test(`${title} ${descriptionHtml}`) && !/guaranteed|cure|certified|official|genuine|clinically proven/i.test(evidenceText)) issues.push("unsupported-claim");
    products.push({
      id: String(live?.legacyResourceId || live?.id || ""),
      productId: live?.id,
      handle,
      sourceTitle,
      liveTitle: normalize(live?.title),
      title,
      seoTitle,
      seoDescription: seoDescription(title, facts),
      descriptionHtml,
      productType: family[0],
      evidence: {
        source: "pre-corruption product title + URL handle + live Shopify media alt text + live variant options",
        sourceCommit,
        imageAlts,
        variantOptions: options,
        facts,
        confidence: sourceTitleIsUsable(sourceTitle, handle, imageAlts[0] || "") ? "high" : "medium",
        category: family[0],
      },
      audit: {
        issues,
        sourceTitleWasUsed: title === humanizePhrase(sourceTitle),
        titleWasRebuiltFromHandle: title !== humanizePhrase(sourceTitle),
      },
    });
  }

  const titleCounts = products.reduce((counts, product) => {
    const key = normalize(product.title).toLowerCase();
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
  const duplicateTitles = Object.entries(titleCounts).filter(([, count]) => count > 1).map(([title, count]) => ({ title, count }));
  const issueCounts = products.flatMap((product) => product.audit.issues).reduce((counts, issue) => { counts[issue] = (counts[issue] || 0) + 1; return counts; }, {});
  const output = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    source: "curated evidence artifact; not generated from current Shopify titles",
    scope: "Online Store published active products",
    evidence: {
      sourceCommit,
      liveMediaCatalog: liveMediaPath,
      liveProducts: livePayload.totalProducts,
      onlineStorePublishedProducts: liveProducts.length,
      currentLiveTitlesAreEvidenceExcluded: true,
    },
    audit: {
      total: products.length,
      issueCount: products.reduce((count, product) => count + product.audit.issues.length, 0),
      issueCounts,
      duplicateTitleGroups: duplicateTitles.length,
      duplicateTitles,
      titlesRebuiltFromHandle: products.filter((product) => product.audit.titleWasRebuiltFromHandle).length,
      sourceTitlesUsed: products.filter((product) => product.audit.sourceTitleWasUsed).length,
    },
    products,
  };
  await mkdir(resolve(rootDir, "output"), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify({ outputPath, audit: output.audit }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
