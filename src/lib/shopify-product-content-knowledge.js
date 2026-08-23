export const PRODUCT_CONTENT_KNOWLEDGE_VERSION = "2026-08-22.2";

export const MARKETPLACE_CONTENT_POLICY = Object.freeze({
  market: "US",
  title: {
    preferredLength: [50, 70],
    order: ["product identity", "supported key attribute", "size or count", "compatibility", "use case"],
    maxRepeatedContentWord: 2,
    forbiddenCharacters: /[!$?_{}^\u00ac\u00a6]/g,
  },
  seo: {
    titleLength: [35, 60],
    descriptionLength: [140, 160],
    frontLoadIdentity: true,
  },
  evidence: {
    canonicalIdentitySource: "handle",
    corroboratingSources: ["variant options", "catalog title", "product type", "trusted reviews"],
    prohibitedInferences: [
      "unverified material",
      "unverified dimensions",
      "medical or performance results",
      "unverified compatibility",
      "unverified pack count",
      "fabricated ratings or popularity",
    ],
  },
  sources: [
    {
      publisher: "Amazon Seller Central",
      topic: "Clear, concise titles; restricted characters; avoid repeated words",
      url: "https://sellercentral.amazon.com/seller-forums/discussions/t/b2b15728-0d43-453e-974f-59eb63f73059",
    },
    {
      publisher: "Walmart Marketplace Learn",
      topic: "Place important product information first and avoid keyword stuffing",
      url: "https://marketplacelearn.walmart.com/ca/guides/Item%20setup/Item%20content%2C%20imagery%2C%20and%20media/avoid-keyword-stuffing",
    },
    {
      publisher: "Google Merchant Center",
      topic: "Accurate, comprehensive product data with key attributes front-loaded",
      url: "https://support.google.com/merchants/answer/7380908?hl=en",
    },
    {
      publisher: "Google Merchant Center",
      topic: "Structured descriptions, product highlights, and product details",
      url: "https://support.google.com/merchants/answer/9479464?hl=en",
    },
  ],
});

const UNSAFE_CLAIM_PATTERNS = Object.freeze([
  /\b(?:best[ -]?selling|best seller|high quality|premium|luxury|maximum|guaranteed|miracle)\b/gi,
  /\b(?:must[ -]?have|perfect gift|great gift|hot brand)\b/gi,
  /\b(?:visible|instant|proven) results?\b/gi,
  /\b(?:pain relief|pain support|fast recovery|hair growth|hair regrowth|regrowth|growth inhibitor|stop hair growth|permanent hair removal|painless|prevent hair loss|hair loss prevention)\b/gi,
  /\b(?:anti[ -]?aging|anti[ -]?wrinkle|wrinkle[ -]?free|acne treatment|spot treatment)\b/gi,
  /\b(?:medical benefits?|therapeutic|orthopedic|hypoallergenic|organic|eco[ -]?friendly)\b/gi,
  /\b(?:wholesale|dropship|free custom)\b/gi,
]);

const HANDLE_FAMILY_OVERRIDES = new Map([
  ["young beautiful and wrinkle free", "makeup"],
  ["candy candy anime", "apparel"],
  ["nana anime", "apparel"],
  ["nana anime 1", "apparel"],
]);

const family = ({
  id,
  terms,
  nouns,
  facts,
  purpose,
  use,
  benefit,
  audience,
  care = "general",
}) => Object.freeze({
  id,
  matchTerms: terms,
  productNouns: nouns,
  priorityFacts: facts,
  copy: { purpose, use, benefit, audience },
  care,
});

export const PRODUCT_CONTENT_FAMILIES = Object.freeze([
  family({
    id: "order-adjustment",
    terms: ["link for price difference", "price difference"],
    nouns: ["order adjustment"],
    facts: ["Product focus", "Available options"],
    purpose: "provides an order-specific price adjustment when directed by customer support",
    use: "Purchase only the exact option and quantity supplied by customer support for an existing order.",
    benefit: "It keeps an approved order adjustment separate from ordinary merchandise.",
    audience: ["Customers completing a support-approved order adjustment"],
  }),
  family({
    id: "vehicle-battery-charger",
    terms: ["car battery charger", "motorcycle battery charger", "lead acid battery charger", "lifepo4 battery charger", "trickle battery charger"],
    nouns: ["vehicle battery charger", "smart battery charger", "trickle charger"],
    facts: ["Size or capacity", "Supported features", "Placement or setting", "Available options"],
    purpose: "charges the compatible vehicle battery types and voltage formats explicitly identified by the product",
    use: "Confirm battery chemistry, voltage, plug, polarity, and charging instructions before connecting the charger to a car or motorcycle battery.",
    benefit: "Its stated voltage, battery chemistry, and plug options help shoppers choose a charger that matches their vehicle battery.",
    audience: ["Car owners comparing compatible battery chargers", "Motorcycle owners checking voltage and battery chemistry", "Drivers selecting a maintenance or trickle charger"],
  }),
  family({
    id: "rechargeable-battery-charger",
    terms: ["battery charger", "rechargeable battery charger", "18650 battery charger", "aa lithium battery charger", "derailleur charger"],
    nouns: ["rechargeable battery charger", "battery charging accessory"],
    facts: ["Size or capacity", "Supported features", "Device compatibility", "Available options"],
    purpose: "charges the rechargeable battery size or device battery explicitly identified by the product",
    use: "Confirm battery size, chemistry, voltage, polarity, and device compatibility before connecting the charger and follow the supplied charging directions.",
    benefit: "Its stated battery format and compatibility details help shoppers select the correct replacement or charging accessory.",
    audience: ["Shoppers matching a charger to a rechargeable battery size", "Device owners replacing a compatible battery charger", "Buyers comparing battery and plug options"],
  }),
  family({
    id: "musical-keyboard",
    terms: ["digital piano", "electronic piano", "musical keyboard", "piano keyboard", "piano kit", "musical instrument"],
    nouns: ["digital keyboard", "electronic piano", "musical instrument"],
    facts: ["Product focus", "Size or capacity", "Supported features", "Intended user", "Available options"],
    purpose: "provides the key layout and electronic music format identified by the product",
    use: "Choose the stated plug or power option, position the keyboard securely, and follow the supplied setup and playing instructions.",
    benefit: "Its key count, controls, and available power options help shoppers compare it for practice, learning, or music activities.",
    audience: ["Beginners comparing electronic keyboards", "Parents choosing a musical keyboard for a child", "Shoppers checking key count and plug options"],
  }),
  family({
    id: "earbuds-audio",
    terms: ["wireless earbuds", "bluetooth earbuds", "tws earbuds", "wireless earphones", "bluetooth earphones", "wireless headphones", "bluetooth headset", "wired earphones", "earbuds", "earbud", "earphones", "earphone", "headphones", "headphone", "headset", "airpods", "realme buds", "redmi buds", "galaxy buds", "oneplus buds", "xiaomi buds", "earbud cleaning", "earbuds cleaning", "ear tips", "eartips", "ear hooks", "earbud case", "earphone case", "buds case"],
    nouns: ["wireless earbuds", "earphones", "headphones", "earbud accessory"],
    facts: ["Product focus", "Device compatibility", "Supported features", "Pack format", "Available options"],
    purpose: "supports personal audio listening or the earbud accessory task explicitly identified by the product",
    use: "Confirm the stated device or earbud-model compatibility, then pair, fit, clean, or install it according to the supplied instructions.",
    benefit: "Its audio format, compatibility, and included option details help shoppers choose the correct earbuds or accessory.",
    audience: ["Shoppers comparing personal audio formats", "Device owners checking earbud compatibility", "Buyers replacing or maintaining an earbud accessory"],
  }),
  family({
    id: "camera-mounting-arm",
    terms: ["articulated arm", "double articulated arm", "camera mounting arm", "studio mounting arm", "5/8 hex pin", "1/4-20 female thread", "3/8-16 female thread"],
    nouns: ["articulated camera mounting arm", "studio mounting arm", "camera support arm"],
    facts: ["Product focus", "Device compatibility", "Supported features", "Available options"],
    purpose: "positions a compatible camera, light, or studio accessory using the articulated arm and threaded fittings identified by the product",
    use: "Confirm the 5/8 hex pin, 1/4-20 female thread, and 3/8-16 female thread against the equipment before ordering. Tighten each fitting securely, support the mounted load, and adjust the arm gradually.",
    benefit: "Its multi-section arm and clearly listed thread formats help photography and studio users check fit before adding a mounting accessory to their setup.",
    audience: ["Photography and video users building a camera or lighting rig", "Studio users checking pin and thread compatibility", "DIY creators comparing articulated mounting options"],
  }),
  family({
    id: "audio-cable",
    terms: ["aux audio cable", "3.5mm aux", "audio extension cable", "audio extension cord", "xh2.54", "xh2 54", "terminal male to male"],
    nouns: ["AUX audio cable", "audio extension cable", "terminal audio cable"],
    facts: ["Product focus", "Device compatibility", "Supported features", "Available options"],
    purpose: "connects the audio source and terminal wiring formats explicitly identified by the product",
    use: "Confirm the 3.5mm audio plug, XH2.54 3-pin terminal layout, and male-to-male connection before ordering, then connect it only to compatible equipment.",
    benefit: "Its connector sizes and terminal layout help shoppers check fit before adding it to an audio or electronics setup.",
    audience: ["Shoppers replacing an AUX or terminal audio lead", "DIY electronics users checking connector compatibility", "Buyers comparing audio extension cable formats"],
  }),
  family({
    id: "keyboard-accessory",
    terms: ["keyboard stand", "keyboards stand", "keyboard platform", "keyboard stabilizer", "keyboard stabilizers", "plate mounted stabilizer", "keycaps storage", "keycap organizer", "keycaps for mechanical keyboard", "keyboard protective cover", "keyboards protective cover", "keyboard stickers", "keyboard holder", "keyboard storage stand", "keyboards display stand", "keyboard circuit board", "keyboard pcb board", "pcb board for mechanical keyboard", "keyboard wrist rest", "sound dampening positioning board", "key power board", "side key board", "pcb key board"],
    nouns: ["keyboard accessory", "keyboard stand", "keyboard protective cover"],
    facts: ["Product focus", "Supported features", "Material", "Device compatibility", "Available options"],
    purpose: "supports keyboard storage, positioning, protection, labeling, or component replacement as identified by the product",
    use: "Confirm keyboard dimensions or model compatibility, then install or position the accessory according to the supplied directions.",
    benefit: "Its specific keyboard task and compatibility details help shoppers avoid selecting the wrong accessory.",
    audience: ["Keyboard owners checking accessory compatibility", "Gaming and office users organizing a keyboard setup", "DIY keyboard builders selecting a component"],
  }),
  family({
    id: "stationery-storage",
    terms: ["pencil case", "pencil cases", "pencilcase", "pencil box", "pencil boxes", "pen box", "pen holder", "pen package box", "stationery box", "pencil storage", "pen storage", "office supplies pencils", "whiteboard magnetic storage"],
    nouns: ["pencil case", "pencil box", "stationery organizer"],
    facts: ["Product focus", "Material", "Supported features", "Use or occasion", "Available options"],
    purpose: "stores pencils, pens, crayons, or other small stationery for the setting identified by the product",
    use: "Choose the listed size or format, load suitable stationery without overfilling it, and keep the box clean and dry between uses.",
    benefit: "Its storage format and available options help shoppers compare it for school, office, art, or desktop organization.",
    audience: ["Students organizing school supplies", "Office users storing pens and small stationery", "Art and craft shoppers comparing pencil storage"],
  }),
  family({
    id: "air-care-appliance",
    terms: ["humidifier", "air humidifier", "aroma humidifier", "aroma diffuser", "essential oil diffuser", "fragrance diffuser", "scent air machine", "air dehumidifier", "air purifier", "air freshener"],
    nouns: ["air humidifier", "aroma diffuser", "air-care appliance"],
    facts: ["Product focus", "Size or capacity", "Supported features", "Placement or setting", "Available options"],
    purpose: "provides the humidifying, diffusing, scenting, or moisture-control format identified by the product",
    use: "Use only the liquids, power source, placement, and operating method approved in the supplied instructions, then clean the reservoir or outlet as directed.",
    benefit: "Its capacity, power format, and intended room or vehicle setting help shoppers compare the correct air-care appliance.",
    audience: ["Home and office shoppers comparing air-care formats", "Travel or car users checking compact options", "Buyers comparing capacity and power requirements"],
  }),
  family({
    id: "essential-oil-refill",
    terms: ["essential oil set", "fragrance oil set", "diffuser oil refill"],
    nouns: ["fragrance oil set", "diffuser oil refill"],
    facts: ["Size or capacity", "Pack format", "Available options"],
    purpose: "provides the fragrance-oil refill format identified for a compatible diffuser or air-freshening routine",
    use: "Confirm compatibility with the intended diffuser and follow the supplied dilution, handling, and usage directions.",
    benefit: "Its bottle size, pack count, and fragrance options help shoppers compare refills for a compatible diffuser.",
    audience: ["Diffuser owners comparing fragrance refills", "Home fragrance shoppers checking bottle and pack sizes"],
    care: "beauty",
  }),
  family({
    id: "plant-care-accessory",
    terms: ["carbon dioxide air diffuser", "co2 air diffuser", "plant growth diffuser"],
    nouns: ["CO2 diffuser", "plant-care accessory"],
    facts: ["Product focus", "Size or capacity", "Available options"],
    purpose: "provides the gas-diffusion accessory identified for a compatible planted growing or aquarium system",
    use: "Confirm system, tubing, gas, and pressure compatibility before installation and follow the supplied setup instructions.",
    benefit: "Its stated diffuser format helps shoppers compare a compatible component for an existing system.",
    audience: ["Planted-system owners checking diffuser compatibility", "Aquarium or growing-system users replacing a diffusion component"],
  }),
  family({
    id: "portable-fan-cooling",
    terms: ["air cooler fan", "usb air cooler", "portable fan", "desk fan", "office fan"],
    nouns: ["portable fan", "USB air cooler", "desk fan"],
    facts: ["Product focus", "Supported features", "Size or capacity", "Placement or setting", "Available options"],
    purpose: "provides the portable airflow or compact cooling format identified by the product",
    use: "Place it on a stable surface, connect the stated power source, keep openings clear, and follow the supplied filling and cleaning directions where applicable.",
    benefit: "Its power, size, and control details help shoppers compare it for a desk, dorm, travel, or office setup.",
    audience: ["Desk and office users comparing compact fans", "Travelers checking portable cooling formats", "Dorm and home users comparing power options"],
  }),
  family({
    id: "portable-air-pump",
    terms: ["wireless air pump", "portable air compressor", "car air pump", "bicycle inflator"],
    nouns: ["portable air pump", "air compressor", "tire inflator"],
    facts: ["Product focus", "Supported features", "Use or occasion", "Available options"],
    purpose: "provides the portable inflation format identified for vehicle, motorcycle, or bicycle tires",
    use: "Confirm the supported valve, pressure range, and power instructions before connecting and inflating a tire.",
    benefit: "Its power and intended vehicle details help shoppers compare it for roadside or routine tire inflation.",
    audience: ["Drivers comparing portable tire inflators", "Motorcycle and bicycle owners checking valve compatibility"],
  }),
  family({
    id: "display-board-sign",
    terms: ["desktop magnetic whiteboard", "standing blackboard", "coffee shop blackboard", "handwritten billboard"],
    nouns: ["desktop whiteboard", "standing blackboard", "display sign"],
    facts: ["Product focus", "Material", "Placement or setting", "Available options"],
    purpose: "provides a freestanding writing or display surface for messages, menus, notices, or desk notes",
    use: "Place it on a stable surface and write, erase, or display information using materials suitable for the stated board finish.",
    benefit: "Its board format and placement details help shoppers compare it for a desk, counter, cafe, or event display.",
    audience: ["Cafe and retail users displaying messages", "Office and home users organizing visible notes"],
  }),
  family({
    id: "vehicle-key-component",
    terms: ["smart car key pcb board", "car key pcb board", "remote generation"],
    nouns: ["car key circuit board", "remote key component"],
    facts: ["Product focus", "Device compatibility", "Available options"],
    purpose: "provides the replacement circuit-board component identified for a compatible vehicle remote key",
    use: "Confirm the exact vehicle, board, frequency, and shell compatibility before installation by a qualified key technician.",
    benefit: "Its board and vehicle details help shoppers avoid ordering an incompatible remote-key component.",
    audience: ["Automotive key technicians checking replacement components", "Vehicle owners confirming remote-key compatibility"],
  }),
  family({
    id: "craft-material",
    terms: ["dried flower buds", "soap making", "candle making", "incense crafts"],
    nouns: ["dried craft flowers", "craft material"],
    facts: ["Product focus", "Material", "Pack format", "Available options"],
    purpose: "supplies the dried decorative material identified for soap, candle, incense, or craft projects",
    use: "Select the preferred variety and use it only for the stated decorative craft application, following the project instructions.",
    benefit: "Its material format and available varieties help crafters compare it for a specific project.",
    audience: ["Soap and candle makers choosing decorative materials", "Craft shoppers comparing dried flower varieties"],
  }),
  family({
    id: "fidget-key-toy",
    terms: ["keyboard keychain fidget toy", "keyboard key toy", "keyboard games", "stress relief fingertip gadget"],
    nouns: ["keyboard fidget toy", "clicker keychain"],
    facts: ["Product focus", "Supported features", "Use or occasion", "Available options"],
    purpose: "provides the clickable key or keychain fidget format identified by the product",
    use: "Use it as a handheld or keychain clicker and follow the supplied age and small-parts guidance.",
    benefit: "Its key layout and portable format help shoppers compare it as a desk accessory, gift, or fidget item.",
    audience: ["Shoppers comparing compact fidget toys", "Gift buyers choosing a keyboard-themed desk accessory"],
  }),
  family({
    id: "adult-bib-apron",
    terms: ["adult bib", "adult apron", "clothing protector", "mealtime bib"],
    nouns: ["adult bib", "protective apron", "clothing protector"],
    facts: ["Product focus", "Supported features", "Material", "Intended user", "Available options"],
    purpose: "helps cover clothing during the meal, grooming, or household use identified by the product",
    use: "Position and fasten it as directed before the intended task, then remove and clean it according to the supplied care instructions.",
    benefit: "Its coverage and fastening format help shoppers compare it for a specific daily routine.",
    audience: ["Adults choosing clothing protection for meals or daily routines", "Caregivers comparing bib and apron formats", "Shoppers checking coverage and fastening options"],
  }),
  family({
    id: "phone-device-accessory",
    terms: ["iphone", "iphone case", "case for iphone", "cover for iphone", "phone case", "tablet case", "screen protector", "phone cover", "charger", "charging cable"],
    nouns: ["phone case", "screen protector", "charger", "device accessory"],
    facts: ["Device compatibility", "Supported features", "Material", "Style or design", "Available options"],
    purpose: "protects, powers, or supports the device models explicitly identified for the product",
    use: "Confirm the exact device model and variant before ordering, then install or connect the accessory according to the supplied instructions.",
    benefit: "Model compatibility and functional details make it easier to select the right accessory without guesswork.",
    audience: ["Device owners matching an accessory to a specific model", "Shoppers comparing compatibility and functional details", "Buyers replacing or adding a device accessory"],
  }),
  family({
    id: "computer-peripheral",
    terms: ["mouse", "computer mouse", "wireless mouse", "bluetooth mouse", "mouse jiggler", "keyboard", "keyboards", "keybaord", "keypad", "macro keypad", "membrane switch keypad", "laptop stand", "laptop cooler", "cooling pad", "webcam"],
    nouns: ["computer mouse", "keyboard", "keypad", "computer accessory"],
    facts: ["Supported features", "Device compatibility", "Use or occasion", "Available options"],
    purpose: "supports the computer task, control method, or workstation setup identified by the product",
    use: "Connect or position it as directed, confirm device compatibility, and use the available controls for the stated computer task.",
    benefit: "Its connection and control format helps shoppers compare it for office, home, travel, or workstation use.",
    audience: ["Laptop and desktop users comparing peripherals", "Office and home-workstation shoppers", "Buyers choosing a computer accessory by connection and task"],
  }),
  family({
    id: "makeup",
    terms: ["makeup", "make up", "cosmetic", "lipstick", "lip gloss", "lip balm", "lip care", "eyeliner", "eyeshadow", "mascara", "foundation", "blush", "eyelash", "eyelashes", "false lashes", "nail polish", "nail art", "fake nails", "press on nail", "setting powder", "concealer powder", "makeup brush"],
    nouns: ["makeup product", "lip product", "eye makeup", "makeup tool"],
    facts: ["Product focus", "Supported features", "Size or capacity", "Style or design", "Available options"],
    purpose: "serves the specific makeup, application, nail, lip, eye, or grooming step named by the product",
    use: "Apply or use it only for the stated beauty step, follow the supplied directions, and clean or remove it appropriately after use.",
    benefit: "The stated format and available options help shoppers compare it for a specific beauty routine or look.",
    audience: ["Beauty shoppers choosing a product for a defined step", "People comparing formats, shades, or applicators", "Buyers building an everyday or occasion makeup routine"],
    care: "beauty",
  }),
  family({
    id: "skin-care",
    terms: ["skin care", "skincare", "face cream", "facial mist", "face mist", "neck cream", "body cream", "body lotion", "body oil", "lotion", "moisturizing cream", "hydration cream", "skin patches", "pimple", "serum", "moisturizer", "cleanser", "body scrub", "body wash", "soap"],
    nouns: ["skin care product", "facial care product", "body care product"],
    facts: ["Product focus", "Size or capacity", "Supported features", "Use or occasion", "Available options"],
    purpose: "fits the cleansing, moisturizing, misting, exfoliating, or body-care step explicitly named by the product",
    use: "Use it only for the stated skin-care step and body area, following all supplied application, rinse-off, and frequency directions.",
    benefit: "Its format and stated routine step help shoppers understand where it belongs without relying on unsupported treatment claims.",
    audience: ["Shoppers building a focused skin-care routine", "People comparing products by format and routine step", "Buyers looking for the specific facial or body-care item named"],
    care: "beauty",
  }),
  family({
    id: "hair-care",
    terms: ["shampoo", "conditioner", "hair dye", "hair oil", "rosemary hair", "hair strengthening oil", "hair mask", "hair mousse", "hair gel", "hair spray", "hair root", "hair loss", "baldness", "hair styling", "pomade", "hair treatment", "hair moisturizing", "scalp", "wig", "hair replacement"],
    nouns: ["hair care product", "hair treatment format", "wig"],
    facts: ["Product focus", "Size or capacity", "Supported features", "Intended user", "Available options"],
    purpose: "supports the cleansing, conditioning, coloring, styling, scalp, or hair-replacement step named by the product",
    use: "Follow the supplied directions for application, timing, rinsing, fitting, or styling according to the exact hair-care format.",
    benefit: "The specific format, size, and available options help shoppers place it within an existing hair routine.",
    audience: ["Shoppers building a focused hair-care routine", "People comparing a specific hair product format", "Buyers choosing hair care by purpose, size, or option"],
    care: "beauty",
  }),
  family({
    id: "fragrance",
    terms: ["perfume", "fragrance", "cologne", "eau de parfum", "eau de toilette"],
    nouns: ["fragrance", "perfume", "cologne"],
    facts: ["Size or capacity", "Intended user", "Product focus", "Available options"],
    purpose: "provides the fragrance format and scent option identified by the product",
    use: "Apply only as directed to the appropriate pulse points, skin, or clothing areas stated in the product instructions.",
    benefit: "The fragrance format and size help shoppers compare it for daily wear, evenings, travel, or gifting.",
    audience: ["Fragrance shoppers exploring a specific scent format", "People choosing a personal or occasion fragrance", "Gift buyers comparing fragrance sizes and options"],
    care: "beauty",
  }),
  family({
    id: "apparel",
    terms: ["dress", "shirt", "shirts", "blouse", "top", "tops", "jacket", "coat", "blazer", "pants", "trouser", "trousers", "jeans", "shorts", "skirt", "leggings", "raincoat", "swimwear", "sweatshirt", "hoodie", "outfit", "jumpsuit", "romper", "corset", "thobe", "robe"],
    nouns: ["dress", "shirt", "jacket", "pants", "apparel"],
    facts: ["Product focus", "Intended user", "Style or design", "Material", "Use or occasion", "Available options"],
    purpose: "builds an outfit around the garment type, silhouette, and occasion supported by the product",
    use: "Choose from the listed options and style it with layers, footwear, or accessories appropriate to the garment and intended setting.",
    benefit: "Its garment type, design details, and available options help shoppers compare it for a specific wardrobe need.",
    audience: ["Apparel shoppers choosing a specific garment type", "People building casual, work, travel, or occasion outfits", "Buyers comparing listed designs and options"],
    care: "apparel",
  }),
  family({
    id: "footwear",
    terms: ["shoe", "shoes", "sandal", "sandals", "boot", "boots", "sneaker", "sneakers", "slipper", "slippers"],
    nouns: ["shoes", "sandals", "boots", "footwear"],
    facts: ["Product focus", "Intended user", "Style or design", "Material", "Use or occasion", "Available options"],
    purpose: "completes outfits for the footwear style and setting supported by the product",
    use: "Select the appropriate listed option and pair it with outfits suited to the footwear type and intended setting.",
    benefit: "Its silhouette and available options make it easier to compare for casual, work, travel, or occasion styling.",
    audience: ["Footwear shoppers comparing style and available options", "People completing a casual or occasion outfit", "Buyers choosing footwear by silhouette and use case"],
    care: "footwear",
  }),
  family({
    id: "bag-storage",
    terms: ["bag", "bags", "handbag", "handbags", "messenger bag", "shoulder bag", "crossbody bag", "school bag", "laptop", "laptop sleeve", "laptop case", "laptop bag", "notebook bag", "backpack", "backpacks", "tote", "wallet", "purse", "organizer", "storage bag", "card holder"],
    nouns: ["bag", "backpack", "wallet", "organizer"],
    facts: ["Product focus", "Supported features", "Material", "Style or design", "Use or occasion", "Available options"],
    purpose: "organizes or carries items according to its stated bag, holder, compartment, or strap format",
    use: "Load it within the supported format, use the provided handles or straps as intended, and organize contents around the available sections.",
    benefit: "Its carry and storage details help shoppers compare it for everyday, work, travel, school, or occasion use.",
    audience: ["Shoppers choosing a bag or organizer for a specific routine", "People comparing carry, closure, and storage formats", "Gift buyers looking for a practical storage option"],
    care: "accessory",
  }),
  family({
    id: "jewelry-accessory",
    terms: ["ring", "necklace", "earring", "earrings", "bracelet", "jewelry", "brooch", "hair accessory", "hair accessories", "hair clip", "hair clips", "headband", "headbands", "scrunchie", "hair tie", "scarf", "belt", "hat", "cap", "beanie", "tie"],
    nouns: ["jewelry", "fashion accessory", "hair accessory"],
    facts: ["Product focus", "Material", "Style or design", "Intended user", "Use or occasion", "Available options"],
    purpose: "adds the specific decorative, wearable, or styling detail identified by the product",
    use: "Wear or position it according to the accessory type, then store it carefully between uses.",
    benefit: "Its design and available options help shoppers compare it for daily styling, occasions, or gifting.",
    audience: ["Accessory shoppers choosing a specific finishing detail", "People coordinating everyday or occasion looks", "Gift buyers comparing wearable options"],
    care: "accessory",
  }),
  family({
    id: "watch",
    terms: ["watch", "watches", "wristwatch", "wristwatches", "smartwatch", "smart watch", "watch movement"],
    nouns: ["watch", "wristwatch", "smart watch", "watch movement"],
    facts: ["Product focus", "Supported features", "Material", "Intended user", "Style or design", "Size or capacity", "Available options"],
    purpose: "provides the timekeeping, wearable display, movement, or watch-component format explicitly identified by the product",
    use: "Choose the correct watch or component option, follow the supplied setup or fitting directions, and use only the stated functions.",
    benefit: "Its movement, display, case, strap, or supported feature details help shoppers compare the exact watch format.",
    audience: ["Watch shoppers comparing movement and design formats", "People choosing a watch for daily, business, sport, or occasion wear", "Buyers selecting a watch or compatible component by stated features"],
    care: "accessory",
  }),
  family({
    id: "eyewear",
    terms: ["sunglasses", "sun glasses", "eyewear", "reading glasses", "goggles"],
    nouns: ["sunglasses", "eyewear", "glasses"],
    facts: ["Product focus", "Supported features", "Intended user", "Style or design", "Material", "Available options"],
    purpose: "provides the eyewear shape, lens format, and styling use identified by the product",
    use: "Select the listed frame or lens option, wear it only for the stated use, and store it in a protective case when not in use.",
    benefit: "Frame, lens, and design details help shoppers compare the eyewear for the intended setting without unsupported protection claims.",
    audience: ["Eyewear shoppers comparing frame and lens formats", "People choosing glasses for a stated activity or look", "Gift buyers comparing wearable accessories"],
    care: "accessory",
  }),
  family({
    id: "personal-grooming",
    terms: ["trimmer", "shaver", "razor", "clipper", "hair remover", "epilator", "beard", "comb", "tail comb", "hair comb", "styling comb", "toothbrush"],
    nouns: ["grooming tool", "trimmer", "shaver", "comb"],
    facts: ["Product focus", "Supported features", "Intended user", "Size or capacity", "Pack format", "Available options"],
    purpose: "supports the shaving, trimming, hair-removal, combing, or grooming task explicitly identified by the product",
    use: "Use it only on the stated area, follow all supplied setup and cleaning directions, and avoid uses not identified by the manufacturer.",
    benefit: "Its grooming task, power format, attachments, or pack details help shoppers compare the exact tool.",
    audience: ["Grooming shoppers choosing a tool for a specific task", "People comparing powered and manual grooming formats", "Buyers selecting a grooming tool by stated attachments or options"],
    care: "beauty",
  }),
  family({
    id: "drinkware",
    terms: ["water bottle", "shaker bottle", "flask", "thermos", "tumbler", "travel mug", "drinking cup"],
    nouns: ["water bottle", "tumbler", "drinkware"],
    facts: ["Size or capacity", "Supported features", "Material", "Use or occasion", "Available options"],
    purpose: "carries or serves drinks in the capacity and lid format identified by the product",
    use: "Fill, close, carry, and clean it according to the supplied capacity, temperature, lid, and care instructions.",
    benefit: "Capacity and carry details help shoppers compare it for work, school, gym, travel, or outdoor routines.",
    audience: ["Shoppers choosing drinkware by capacity and lid format", "People preparing for work, travel, gym, or outdoor use", "Buyers comparing reusable drink containers"],
  }),
  family({
    id: "kitchen-cookware",
    terms: ["cookware", "cook kit", "pot set", "pots", "measuring cup", "measuring jug", "kitchen utensil", "kitchen tools", "vegetable slicer", "pepper grinder", "kitchen knife", "knife sharpener", "salt and pepper grinder", "frying pan", "cooking pot", "spatula", "peeler", "kitchen cutter"],
    nouns: ["cookware", "measuring cup", "kitchen tool"],
    facts: ["Product focus", "Size or capacity", "Material", "Pack format", "Supported features", "Available options"],
    purpose: "supports the specific preparation, measuring, cooking, serving, or storage task named by the product",
    use: "Use it only for the stated kitchen task and follow supplied guidance for capacity, heat exposure, handling, and cleaning.",
    benefit: "Its task, material, size, or pack details help shoppers compare it for a specific kitchen routine.",
    audience: ["Home cooks choosing a tool for a defined task", "Shoppers comparing kitchen items by size or material", "Buyers equipping a kitchen, camp setup, or gift list"],
  }),
  family({
    id: "home-lighting",
    terms: ["wall lamp", "wall lamps", "wall light", "floor lamp", "desk lamp", "ceiling light", "led light", "fairy lights", "string lights", "lighting", "lantern", "night light", "jellyfish lamp"],
    nouns: ["lamp", "light", "lighting"],
    facts: ["Product focus", "Placement or setting", "Style or design", "Supported features", "Size or capacity", "Available options"],
    purpose: "adds the lighting format and placement option identified by the product",
    use: "Install, position, power, and operate it only as directed for the stated room or placement.",
    benefit: "Its fixture type, placement, and design details help shoppers compare it for a specific space.",
    audience: ["Home shoppers choosing lighting for a specific placement", "People comparing fixture styles and controls", "Buyers planning a room, desk, wall, or outdoor lighting setup"],
  }),
  family({
    id: "home-decor",
    terms: ["home decor", "home decoration", "tabletop fountain", "water fountain", "wall decor", "wedding decorations", "artificial flower", "artificial flowers", "candle mold", "humidifier", "diffuser", "pillow", "blanket", "towel", "towels", "rug"],
    nouns: ["home decor", "decorative accessory", "home textile"],
    facts: ["Product focus", "Placement or setting", "Material", "Size or capacity", "Style or design", "Available options"],
    purpose: "adds the decorative, display, textile, or room-use format identified by the product",
    use: "Place or use it only in the stated setting and follow supplied setup, cleaning, power, or handling directions.",
    benefit: "Its placement, design, size, and material details help shoppers compare it for a specific room or display.",
    audience: ["Home shoppers planning a specific room or display", "People comparing decor by size, material, or placement", "Gift buyers choosing a decorative home item"],
  }),
  family({
    id: "pet",
    terms: ["dog", "cat", "pet", "aquarium", "leash", "pet bed", "dog nail"],
    nouns: ["pet product", "dog accessory", "cat accessory"],
    facts: ["Product focus", "Intended user", "Size or capacity", "Supported features", "Material", "Available options"],
    purpose: "supports the pet care, handling, feeding, grooming, rest, or play task identified by the product",
    use: "Choose the appropriate listed size or format and supervise use according to the supplied pet-care and safety directions.",
    benefit: "Its pet type, task, and available options help owners compare it for a specific routine.",
    audience: ["Pet owners shopping for a specific care task", "Dog or cat owners comparing listed options", "Gift buyers choosing a practical pet accessory"],
  }),
  family({
    id: "baby-kids",
    terms: ["baby", "toddler", "diaper", "stroller", "kids", "children", "child", "bib"],
    nouns: ["baby product", "kids product", "diaper accessory"],
    facts: ["Product focus", "Intended user", "Size or capacity", "Material", "Supported features", "Available options"],
    purpose: "supports the child or caregiver routine explicitly identified by the product",
    use: "Select the appropriate listed age, size, or option and follow all supplied adult-supervision, fitting, and care directions.",
    benefit: "Its intended user, format, and options help caregivers compare it for a specific routine.",
    audience: ["Parents and caregivers comparing products for a defined task", "Shoppers matching a product to listed age or size options", "Gift buyers choosing a practical baby or kids item"],
  }),
  family({
    id: "fitness-outdoor",
    terms: ["fitness", "gym", "running", "cycling", "hiking", "camping", "outdoor", "yoga", "exercise", "sports"],
    nouns: ["fitness accessory", "outdoor product", "sports accessory"],
    facts: ["Product focus", "Use or occasion", "Supported features", "Material", "Size or capacity", "Available options"],
    purpose: "supports the fitness, sport, travel, or outdoor task named by the product",
    use: "Set up, wear, carry, or use it according to the stated activity and all supplied fitting and safety directions.",
    benefit: "Its activity, format, and functional details help shoppers compare it for a specific routine or trip.",
    audience: ["Fitness or outdoor shoppers planning a specific activity", "Travel and recreation buyers comparing formats", "People choosing equipment by task and available option"],
  }),
  family({
    id: "tool-protective-gear",
    terms: ["tool", "wrench", "screwdriver", "drill", "scraper", "knee brace", "knee pad", "knee pads", "kneepad", "kneepads", "protective gear", "work gloves", "pruning shears", "safety"],
    nouns: ["tool", "protective gear", "work accessory"],
    facts: ["Product focus", "Use or occasion", "Supported features", "Material", "Pack format", "Available options"],
    purpose: "supports the work, maintenance, repair, or protection task explicitly named by the product",
    use: "Use it only for the stated task, inspect it before use, and follow all supplied operating, fitting, and safety directions.",
    benefit: "Its task and functional details help shoppers compare it without implying unsupported performance or safety results.",
    audience: ["DIY and trade shoppers choosing a task-specific item", "People comparing work accessories by function", "Buyers selecting protective equipment for a stated activity"],
  }),
  family({
    id: "general",
    terms: [],
    nouns: ["product"],
    facts: ["Product focus", "Size or capacity", "Material", "Supported features", "Use or occasion", "Available options"],
    purpose: "serves the specific function identified by its handle and confirmed product details",
    use: "Use it only for the stated task and follow all supplied setup, handling, and care instructions.",
    benefit: "Confirmed product facts and available options help shoppers compare it for the intended task.",
    audience: ["Shoppers looking for the specific product type named", "Buyers comparing confirmed features and options", "Gift buyers when the item suits the recipient's intended use"],
  }),
]);

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[-_]+/g, " ")
    .replace(/[^a-z0-9\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hasWholeTerm(text, term) {
  const normalizedTerm = normalize(term);
  return normalizedTerm && (` ${text} `).includes(` ${normalizedTerm} `);
}

export function resolveProductKnowledge(handle) {
  const normalized = normalize(handle);
  const override = HANDLE_FAMILY_OVERRIDES.get(normalized);
  if (override) return PRODUCT_CONTENT_FAMILIES.find((entry) => entry.id === override);
  if (/(?:piano|keyboard) (?:\w+ )*(?:stickers?|note labels?)/.test(normalized)) {
    return PRODUCT_CONTENT_FAMILIES.find((entry) => entry.id === "keyboard-accessory");
  }
  if (/\b\d+ keys?\b/.test(normalized) && /(?:digital|electronic|electric) (?:\w+ )*(?:piano|keyboard)/.test(normalized)) {
    return PRODUCT_CONTENT_FAMILIES.find((entry) => entry.id === "musical-keyboard");
  }
  if (/\b(?:pencil|pencilcase|pen box|stationery box|pen holder)\b/.test(normalized) && !/jewelry box/.test(normalized)) {
    return PRODUCT_CONTENT_FAMILIES.find((entry) => entry.id === "stationery-storage");
  }
  if (/\b\d+\s*pcs?\s+\d+ml\b/.test(normalized) && /essential oil/.test(normalized)) {
    return PRODUCT_CONTENT_FAMILIES.find((entry) => entry.id === "essential-oil-refill");
  }
  if (/(?:carbon dioxide|co2) air diffuser/.test(normalized)) {
    return PRODUCT_CONTENT_FAMILIES.find((entry) => entry.id === "plant-care-accessory");
  }
  if (/keydiy .* pcb key board|pcb key board .* (?:vw|audi|porsche)/.test(normalized)) {
    return PRODUCT_CONTENT_FAMILIES.find((entry) => entry.id === "vehicle-key-component");
  }
  if (/key power board .* partybox/.test(normalized)) {
    return PRODUCT_CONTENT_FAMILIES.find((entry) => entry.id === "keyboard-accessory");
  }
  if (/(?:car|motorcycle|lead acid|lifepo4|trickle) (?:\w+ )*battery charger|battery charger (?:\w+ )*(?:car|motorcycle|lead acid|lifepo4|trickle)/.test(normalized)) {
    return PRODUCT_CONTENT_FAMILIES.find((entry) => entry.id === "vehicle-battery-charger");
  }

  let best = PRODUCT_CONTENT_FAMILIES.at(-1);
  let bestScore = 0;
  for (const entry of PRODUCT_CONTENT_FAMILIES) {
    if (entry.id === "general") continue;
    let score = 0;
    for (const term of entry.matchTerms) {
      const normalizedTerm = normalize(term);
      if (!hasWholeTerm(normalized, normalizedTerm)) continue;
      const position = normalized.indexOf(normalizedTerm);
      score += normalizedTerm.split(" ").length * 20 + normalizedTerm.length + Math.max(0, 30 - position);
    }
    if (score > bestScore) {
      best = entry;
      bestScore = score;
    }
  }
  return best;
}

export function prioritizeProductFacts(facts, knowledge) {
  const order = new Map((knowledge?.priorityFacts || []).map((label, index) => [label, index]));
  return [...(facts || [])].sort((left, right) =>
    (order.get(left.label) ?? 100) - (order.get(right.label) ?? 100));
}

export function enforceMarketplaceTitle(value, maxLength = 68) {
  const words = sanitizeMarketplaceClaims(value)
    .replace(MARKETPLACE_CONTENT_POLICY.title.forbiddenCharacters, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ");
  const counts = new Map();
  const kept = words.filter((word) => {
    const key = normalize(word);
    if (!key || key.length <= 2) return true;
    const count = counts.get(key) || 0;
    counts.set(key, count + 1);
    return count < MARKETPLACE_CONTENT_POLICY.title.maxRepeatedContentWord;
  });
  const text = kept.join(" ");
  if (text.length <= maxLength) return text;
  const cut = text.slice(0, maxLength + 1);
  return cut
    .slice(0, Math.max(1, cut.lastIndexOf(" ")))
    .replace(/[,:;-]+$/g, "")
    .replace(/\b(?:and|for|with|of|to)$/i, "")
    .trim();
}

export function containsUnsafeMarketplaceClaim(value) {
  return UNSAFE_CLAIM_PATTERNS.some((pattern) => {
    pattern.lastIndex = 0;
    return pattern.test(String(value || ""));
  });
}

export function sanitizeMarketplaceClaims(value) {
  let output = String(value || "");
  for (const pattern of UNSAFE_CLAIM_PATTERNS) {
    pattern.lastIndex = 0;
    output = output.replace(pattern, " ");
  }
  return output.replace(/\s+/g, " ").replace(/\s+([,.;:])/g, "$1").trim();
}

export function isTitleAlignedWithKnowledge(value, knowledge) {
  const text = normalize(value);
  if (!text || !knowledge || knowledge.id === "general") return true;
  const evidence = [...(knowledge.matchTerms || []), ...(knowledge.productNouns || [])];
  if (evidence.some((term) => hasWholeTerm(text, term))) return true;

  const singularize = (token) => token.length > 4 && token.endsWith("s") ? token.slice(0, -1) : token;
  const ignored = new Set(["accessory", "item", "product", "replacement"]);
  const titleTokens = new Set(text.split(" ").map(singularize).filter((token) => token.length >= 4 && !ignored.has(token)));
  const evidenceTokens = new Set(
    evidence
      .flatMap((term) => normalize(term).split(" "))
      .map(singularize)
      .filter((token) => token.length >= 4 && !ignored.has(token)),
  );
  return [...titleTokens].some((token) => evidenceTokens.has(token));
}
