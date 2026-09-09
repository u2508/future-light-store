import { normalizeCatalogText } from "./catalog-taxonomy.js";

// Local vision returns useful retail labels that are often more natural than
// the checked-in taxonomy rule names. These hints only select an existing
// governed rule; confidence, image agreement, ambiguity, and source-text
// alignment are still enforced by the caller before a product can leave
// classification-review.
const VISUAL_TAXONOMY_HINTS = Object.freeze([
  { ruleId: "first-aid-tourniquet-kits", any: ["tourniquet", "first aid kit", "first aid equipment"] },
  { ruleId: "laboratory-instrument-mats", any: ["lab instrument mat", "laboratory instrument mat", "silicone lab mat"] },
  { ruleId: "anime-figures-standees", all: ["anime", "figurine"] },
  { ruleId: "anime-figures-standees", all: ["anime", "collectible"] },
  { ruleId: "anime-figures-standees", any: ["figurine"] },
  { ruleId: "soft-toys", any: ["plush toy", "stuffed toy"] },
  { ruleId: "key-ring", any: ["keychain", "keychains"] },
  { ruleId: "tank-tops", any: ["tank top"] },
  { ruleId: "decorative-stickers", any: ["sticker sheets", "stationery/craft supplies"] },
  { ruleId: "pet-general", any: ["pet costume", "pet travel box", "pet carrier"] },
  { ruleId: "home-lighting", any: ["decorative lights", "string lights"] },
  { ruleId: "home-decor", any: ["model village", "holiday decor", "wreath", "garland"] },
  { ruleId: "stationery-gift-sets", any: ["greeting card", "greeting cards"] },
  { ruleId: "gift-packaging", any: ["gift box", "gift bag", "packaging"] },
  { ruleId: "home-decor", any: ["gift plaque", "gift item", "keepsake gift"] },
  { ruleId: "merchant-electronics-fallback", any: ["portable projector", "smart projector", "mini portable projector", "projector screen", "projector", "streaming device", "blu-ray disc", "dvd/blu-ray", "audio recording device", "audio recorder", "voice recorder", "digital photo frame"] },
  { ruleId: "video-game-cartridges", any: ["video game cartridge", "game cartridge", "game card", "8-bit game card"] },
  { ruleId: "led-strip-lights", any: ["led strip", "tv led strip", "replacement led strip"] },
  { ruleId: "lidar-sensor-modules", any: ["lidar sensor", "lidar module", "rplidar"] },
  { ruleId: "console-controller-repair-parts", any: ["conductive rubber pads", "controller button contact", "controller silicone contact", "gamepad repair part"] },
  { ruleId: "power-strips-and-extension-cords", any: ["power strip", "extension cord", "multi-tap extension", "multiprise power strip"] },
  { ruleId: "remote-controls", any: ["voice remote", "tv remote control", "remote control tv", "remote control"] },
  { ruleId: "network-connectors", any: ["rj45", "cat6 connector", "cat5e connector", "modular plug 8p8c", "network connector"] },
  { ruleId: "drone-repair-parts", all: ["mavic", "motor arm"] },
  { ruleId: "drone-repair-parts", all: ["drone", "motor arm"] },
  { ruleId: "drone-repair-parts", any: ["drone motor arm", "mavic motor arm", "drone arm shell", "drone repair part", "propeller motor arm"] },
  { ruleId: "electronic-adapter", any: ["ethernet cable", "networking cable", "network cable", "cat 6 ethernet extension cable", "cable management", "cable management accessories", "hdmi matrix switch", "electronic components", "electrical components"] },
  { ruleId: "usb-data-and-charging-cables", any: ["usb-c cable", "usb 3.0 extension cable"] },
  { ruleId: "vr-and-console-accessories", any: ["gaming controller", "wireless gamepad", "wired gamepad", "game controller", "gaming accessories", "controller grips/thumbsticks", "handheld game console", "portable game console", "game cartridge"] },
  { ruleId: "vr-and-console-accessories", any: ["gaming accessory", "grip handle bracket", "wireless controller"] },
  { ruleId: "watch-band", any: ["watch strap", "watchband"] },
  { ruleId: "audio-adapters-and-receivers", any: ["audio receiver", "audio transmitter receiver"] },
  { ruleId: "electronic-adapter", any: ["smart home automation", "sd card adapter", "electronic components", "electrical components", "docking station", "remote case", "zigbee gateway"] },
  { ruleId: "bluetooth-item-trackers", any: ["bluetooth tracker", "find my tag"] },
  { ruleId: "camera-accessory", any: ["photography accessories", "camera cleaning kit"] },
  { ruleId: "womens-jumpsuits", all: ["womens", "jumpsuit"] },
  { ruleId: "womens-jumpsuits", all: ["women", "jumpsuit"] },
  { ruleId: "womens-jumpsuits", any: ["women jumpsuit", "womens jumpsuit", "ladies jumpsuit", "women romper"] },
  { ruleId: "fashion-general", any: ["jumpsuit", "rompers", "leggings", "cosplay costume"] },
  { ruleId: "shirts", any: ["long-sleeved shirt", "shirt"] },
]);

function matchesHint(text, hint) {
  const required = (hint.all || []).map(normalizeCatalogText).filter(Boolean);
  const alternatives = (hint.any || []).map(normalizeCatalogText).filter(Boolean);
  return required.every((term) => text.includes(term)) &&
    (!alternatives.length || alternatives.some((term) => text.includes(term)));
}

export function resolveVisualTaxonomyHint(content, product = null) {
  const text = normalizeCatalogText([
    content?.productName,
    content?.productCategory,
    ...(Array.isArray(content?.visibleAttributes) ? content.visibleAttributes : []),
    product?.title,
    product?.handle,
  ].filter(Boolean).join(" "));
  if (!text) return null;
  return VISUAL_TAXONOMY_HINTS.find((hint) => matchesHint(text, hint))?.ruleId || null;
}
