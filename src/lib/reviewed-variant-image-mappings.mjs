/*
 * Explicitly reviewed exceptions for Shopify variant-media links that are
 * known to be wrong or unverified in the source catalog. Entries are
 * deliberately bound to a product, variant, selected option and an exact
 * product-owned MediaImage ID or immutable Shopify CDN image path (or an
 * explicit no-match hold). Never infer or broaden these records from labels,
 * filenames or similar products.
 */

const duffelHandle =
  "women-men-nylon-travel-duffel-bag-carry-on-luggage-bag-men-tote-large-capacity-weekender-gym-sport-holdall-overnight-bag-pouches";

export const REVIEWED_VARIANT_IMAGE_MAPPINGS = Object.freeze([
  Object.freeze({
    productId: "gid://shopify/Product/16022608117841",
    handle:
      "2026-new-smart-bluetooth-sunglasses-glasses-wireless-call-outdoor-sports-headphones-waterproof-smart-glasses-for-men-and-women",
    reviewMethod: "manual-live-gallery-review",
    reviewedBy: "ChatGPT",
    reviewedAt: "2026-09-28",
    assignments: Object.freeze([
      Object.freeze({
        variantId: "gid://shopify/ProductVariant/60385364607057",
        selectedOptions: Object.freeze([
          { name: "Color", value: "Black frame · Clear lenses" },
        ]),
        mediaId: "gid://shopify/MediaImage/72062686560337",
        rationale:
          "Live gallery review: image 1 visibly includes the black-frame clear-lens pair; Shopify assigns this exact image to the clear-lens variant.",
      }),
      Object.freeze({
        variantId: "gid://shopify/ProductVariant/60385364639825",
        selectedOptions: Object.freeze([
          { name: "Color", value: "Black frame · Dark lenses" },
        ]),
        mediaId: "gid://shopify/MediaImage/72062686593105",
        rationale:
          "Live gallery review: image 2 shows the black-frame dark-lens pair; Shopify assigns this exact image to the dark-lens variant.",
      }),
    ]),
  }),
  Object.freeze({
    productId: "gid://shopify/Product/16022022750289",
    handle: duffelHandle,
    reviewMethod: "manual-live-gallery-review",
    reviewedBy: "ChatGPT",
    reviewedAt: "2026-09-27",
    assignments: Object.freeze([
      Object.freeze({
        variantId: "gid://shopify/ProductVariant/60383152996433",
        selectedOptions: Object.freeze([{ name: "Color", value: "Navy" }]),
        mediaId: "gid://shopify/MediaImage/72058621460561",
        rationale: "Gallery image 7 visibly shows this same duffel in navy blue.",
      }),
      Object.freeze({
        variantId: "gid://shopify/ProductVariant/60383153029201",
        selectedOptions: Object.freeze([{ name: "Color", value: "Gray" }]),
        mediaId: "gid://shopify/MediaImage/72058621296721",
        rationale: "Gallery image 2 is the matching gray duffel front view; retain it.",
      }),
      Object.freeze({
        variantId: "gid://shopify/ProductVariant/60383153061969",
        selectedOptions: Object.freeze([{ name: "Color", value: "Black" }]),
        mediaId: "gid://shopify/MediaImage/72058621526097",
        rationale:
          "Gallery image 9 shows the black duffel exterior in use; image 6 remains useful in the gallery for its dimensions.",
      }),
    ]),
  }),
  Object.freeze({
    productId: "gid://shopify/Product/16322589392977",
    handle:
      "mens-wallet-made-of-pu-wax-oil-skin-purse-for-men-coin-purse-short-male-card-holder-wallets-zipper-around-money-coin-purse-1",
    reviewMethod: "manual-live-gallery-review",
    reviewedBy: "ChatGPT",
    reviewedAt: "2026-09-28",
    assignments: Object.freeze([
      Object.freeze({
        variantId: "gid://shopify/ProductVariant/62684224127057",
        selectedOptions: Object.freeze([{ name: "Color", value: "Black" }]),
        mediaId: "gid://shopify/MediaImage/73719881433169",
        imageUrl:
          "https://cdn.shopify.com/s/files/1/1065/7008/8529/files/Se82160f299d54d15b562b95a0e7f76efY_af7562df-96b1-464b-9de1-828393c17912.webp?v=1789811443",
        rationale: "Gallery image 7 visibly shows the matching black wallet exterior.",
      }),
      Object.freeze({
        variantId: "gid://shopify/ProductVariant/62684224159825",
        selectedOptions: Object.freeze([{ name: "Color", value: "Dark Brown" }]),
        mediaId: "gid://shopify/MediaImage/73719881465937",
        imageUrl:
          "https://cdn.shopify.com/s/files/1/1065/7008/8529/files/S71087715f892474fa53c9b2297e20bdah_4d26b55a-f1b0-4430-94a6-2c977415749d.webp?v=1789811443",
        rationale: "Gallery image 8 visibly shows the matching dark-brown wallet exterior.",
      }),
      Object.freeze({
        variantId: "gid://shopify/ProductVariant/62684224192593",
        selectedOptions: Object.freeze([{ name: "Color", value: "Light Brown" }]),
        mediaId: "gid://shopify/MediaImage/73719881236561",
        imageUrl:
          "https://cdn.shopify.com/s/files/1/1065/7008/8529/files/Sd58dd4be74684d93b6469c4cea1963d8M_b6d3d8eb-5b8b-4287-b215-675c44ca2ada.webp?v=1789811443",
        rationale: "Gallery image 1 visibly shows the matching lighter-brown wallet exterior.",
      }),
    ]),
  }),
  Object.freeze({
    productId: "gid://shopify/Product/15995848327249",
    handle: "hollow-ball-puppy-toy-cat-toy-tpr-rubber-ball-christmas-bell-pet-toy-ball",
    reviewMethod: "manual-live-gallery-review",
    reviewedBy: "ChatGPT",
    reviewedAt: "2026-09-28",
    assignments: Object.freeze([
      Object.freeze({
        variantId: "gid://shopify/ProductVariant/60200094728273",
        selectedOptions: Object.freeze([{ name: "Color", value: "Purple" }]),
        mediaId: "gid://shopify/MediaImage/71944024588369",
        rationale:
          "Gallery image 10 is the dedicated isolated purple lattice ball; checked against the complete live gallery.",
      }),
      Object.freeze({
        variantId: "gid://shopify/ProductVariant/60200094761041",
        selectedOptions: Object.freeze([{ name: "Color", value: "Yellow" }]),
        mediaId: "gid://shopify/MediaImage/71944024490065",
        rationale:
          "Gallery image 7 is the dedicated isolated yellow lattice ball; checked against the complete live gallery.",
      }),
      Object.freeze({
        variantId: "gid://shopify/ProductVariant/60200094793809",
        selectedOptions: Object.freeze([{ name: "Color", value: "Orange" }]),
        mediaId: "gid://shopify/MediaImage/71944024522833",
        rationale:
          "Gallery image 8 is the dedicated isolated orange lattice ball; checked against the complete live gallery.",
      }),
      Object.freeze({
        variantId: "gid://shopify/ProductVariant/60200094826577",
        selectedOptions: Object.freeze([{ name: "Color", value: "Blue" }]),
        mediaId: "gid://shopify/MediaImage/71944024555601",
        rationale:
          "Gallery image 9 is the dedicated isolated blue lattice ball; checked against the complete live gallery.",
      }),
    ]),
  }),
  Object.freeze({
    productId: "gid://shopify/Product/15981540638801",
    handle:
      "synoke-military-digital-watches-men-sports-luminous-chronograph-waterproof-male-electronic-wrist-watches-relogio-masculino",
    reviewMethod: "manual-live-gallery-review",
    reviewedBy: "ChatGPT",
    reviewedAt: "2026-09-27",
    assignments: Object.freeze([
      Object.freeze({
        variantId: "gid://shopify/ProductVariant/60076336283729",
        selectedOptions: Object.freeze([{ name: "Color", value: "Military Green" }]),
        mediaId: "gid://shopify/MediaImage/71874336129105",
        rationale:
          "Compared all ten gallery images; image 7 visibly shows this exact SYNOKE model with a military-green strap and case.",
      }),
      Object.freeze({
        variantId: "gid://shopify/ProductVariant/60076336316497",
        selectedOptions: Object.freeze([{ name: "Color", value: "white" }]),
        mediaId: "gid://shopify/MediaImage/71874336161873",
        rationale:
          "Compared all ten gallery images; image 8 visibly shows this exact SYNOKE model with a white strap and case.",
      }),
      Object.freeze({
        variantId: "gid://shopify/ProductVariant/60076336349265",
        selectedOptions: Object.freeze([{ name: "Color", value: "black" }]),
        mediaId: "gid://shopify/MediaImage/71874336194641",
        rationale:
          "Compared all ten gallery images; image 9 is the clearest product-only photo of this exact SYNOKE model with a black strap and case.",
      }),
      Object.freeze({
        variantId: "gid://shopify/ProductVariant/60076336382033",
        selectedOptions: Object.freeze([{ name: "Color", value: "Grey" }]),
        mediaId: null,
        decision: "held-no-matching-gallery-image",
        holdReason:
          "All ten gallery images were inspected; none visibly shows a gray watch. The existing wrist and hero photos are black, so do not pass them off as gray.",
      }),
    ]),
  }),
  Object.freeze({
    productId: "gid://shopify/Product/15981540704337",
    handle:
      "boys-brand-cheap-watches-men-fashion-casual-nylon-band-sports-army-gifts-date-quartz-wrist-watch-fluorescent-relogio-masculino",
    reviewMethod: "manual-live-gallery-review",
    reviewedBy: "ChatGPT",
    reviewedAt: "2026-09-27",
    assignments: Object.freeze([
      Object.freeze({
        variantId: "gid://shopify/ProductVariant/60076336480337",
        selectedOptions: [
          { name: "Color", value: "black fluorescent" },
          { name: "Is Customized", value: "Yes" },
          { name: "Ships From", value: "China Mainland" },
        ],
        mediaId: "gid://shopify/MediaImage/71874336456785",
        rationale:
          "Gallery image 7 shows the black strap with a luminous fluorescent dial; preserve the other gallery views.",
      }),
      Object.freeze({
        variantId: "gid://shopify/ProductVariant/60076336513105",
        selectedOptions: [
          { name: "Color", value: "black green" },
          { name: "Is Customized", value: "Yes" },
          { name: "Ships From", value: "China Mainland" },
        ],
        mediaId: "gid://shopify/MediaImage/71874336489553",
        rationale: "Gallery image 8 shows the black strap with a green dial.",
      }),
      Object.freeze({
        variantId: "gid://shopify/ProductVariant/60076336545873",
        selectedOptions: [
          { name: "Color", value: "black black" },
          { name: "Is Customized", value: "Yes" },
          { name: "Ships From", value: "China Mainland" },
        ],
        mediaId: "gid://shopify/MediaImage/71874336424017",
        rationale: "Gallery image 6 shows the black strap with a black dial.",
      }),
      Object.freeze({
        variantId: "gid://shopify/ProductVariant/60076336578641",
        selectedOptions: [
          { name: "Color", value: "green fluorescent" },
          { name: "Is Customized", value: "Yes" },
          { name: "Ships From", value: "China Mainland" },
        ],
        mediaId: "gid://shopify/MediaImage/71874336587857",
        rationale:
          "Gallery image 11 shows the green strap with a luminous fluorescent dial; image 5 is retained as another product view.",
      }),
      Object.freeze({
        variantId: "gid://shopify/ProductVariant/60076336611409",
        selectedOptions: [
          { name: "Color", value: "green green" },
          { name: "Is Customized", value: "Yes" },
          { name: "Ships From", value: "China Mainland" },
        ],
        mediaId: "gid://shopify/MediaImage/71874336325713",
        rationale: "Gallery image 3 shows the green strap with a green dial.",
      }),
      Object.freeze({
        variantId: "gid://shopify/ProductVariant/60076336644177",
        selectedOptions: [
          { name: "Color", value: "black coffee" },
          { name: "Is Customized", value: "Yes" },
          { name: "Ships From", value: "China Mainland" },
        ],
        mediaId: "gid://shopify/MediaImage/71874336620625",
        rationale: "Gallery image 12 shows the black strap with a coffee-brown dial.",
      }),
      Object.freeze({
        variantId: "gid://shopify/ProductVariant/60076336676945",
        selectedOptions: [
          { name: "Color", value: "green black" },
          { name: "Is Customized", value: "Yes" },
          { name: "Ships From", value: "China Mainland" },
        ],
        mediaId: "gid://shopify/MediaImage/71874336653393",
        rationale: "Gallery image 13 shows the green strap with a black dial.",
      }),
      Object.freeze({
        variantId: "gid://shopify/ProductVariant/60076336709713",
        selectedOptions: [
          { name: "Color", value: "blue fluorescent" },
          { name: "Is Customized", value: "Yes" },
          { name: "Ships From", value: "China Mainland" },
        ],
        mediaId: null,
        decision: "held-no-matching-gallery-image",
        holdReason:
          "All 21 gallery images were inspected; none shows a blue strap with a luminous fluorescent dial. Do not substitute a different blue-dial combination.",
      }),
      Object.freeze({
        variantId: "gid://shopify/ProductVariant/60076336742481",
        selectedOptions: [
          { name: "Color", value: "blue green" },
          { name: "Is Customized", value: "Yes" },
          { name: "Ships From", value: "China Mainland" },
        ],
        mediaId: "gid://shopify/MediaImage/71874336522321",
        rationale: "Gallery image 9 shows the blue strap with a green dial.",
      }),
      Object.freeze({
        variantId: "gid://shopify/ProductVariant/60076336775249",
        selectedOptions: [
          { name: "Color", value: "green coffee" },
          { name: "Is Customized", value: "Yes" },
          { name: "Ships From", value: "China Mainland" },
        ],
        mediaId: "gid://shopify/MediaImage/71874336784465",
        rationale: "Gallery image 17 shows the green strap with a coffee-brown dial.",
      }),
      Object.freeze({
        variantId: "gid://shopify/ProductVariant/60076336808017",
        selectedOptions: [
          { name: "Color", value: "blue black" },
          { name: "Is Customized", value: "Yes" },
          { name: "Ships From", value: "China Mainland" },
        ],
        mediaId: "gid://shopify/MediaImage/71874336817233",
        rationale: "Gallery image 18 shows the blue strap with a black dial.",
      }),
      Object.freeze({
        variantId: "gid://shopify/ProductVariant/60076336840785",
        selectedOptions: [
          { name: "Color", value: "coffee fluorescent" },
          { name: "Is Customized", value: "Yes" },
          { name: "Ships From", value: "China Mainland" },
        ],
        mediaId: "gid://shopify/MediaImage/71874336555089",
        rationale: "Gallery image 10 shows the coffee-brown strap with a luminous dial.",
      }),
      Object.freeze({
        variantId: "gid://shopify/ProductVariant/60076336873553",
        selectedOptions: [
          { name: "Color", value: "coffee green" },
          { name: "Is Customized", value: "Yes" },
          { name: "Ships From", value: "China Mainland" },
        ],
        mediaId: "gid://shopify/MediaImage/71874336686161",
        rationale: "Gallery image 14 shows the coffee-brown strap with a green dial.",
      }),
      Object.freeze({
        variantId: "gid://shopify/ProductVariant/60076336906321",
        selectedOptions: [
          { name: "Color", value: "blue coffee" },
          { name: "Is Customized", value: "Yes" },
          { name: "Ships From", value: "China Mainland" },
        ],
        mediaId: "gid://shopify/MediaImage/71874336718929",
        rationale: "Gallery image 15 shows the blue strap with a coffee-brown dial.",
      }),
      Object.freeze({
        variantId: "gid://shopify/ProductVariant/60076336939089",
        selectedOptions: [
          { name: "Color", value: "coffee black" },
          { name: "Is Customized", value: "Yes" },
          { name: "Ships From", value: "China Mainland" },
        ],
        mediaId: "gid://shopify/MediaImage/71874336850001",
        rationale: "Gallery image 19 shows the coffee-brown strap with a black dial.",
      }),
      Object.freeze({
        variantId: "gid://shopify/ProductVariant/60076336971857",
        selectedOptions: [
          { name: "Color", value: "coffee coffee" },
          { name: "Is Customized", value: "Yes" },
          { name: "Ships From", value: "China Mainland" },
        ],
        mediaId: "gid://shopify/MediaImage/71874336915537",
        rationale: "Gallery image 21 shows the coffee-brown strap with a coffee-brown dial.",
      }),
    ]),
  }),
  Object.freeze({
    productId: "gid://shopify/Product/15981540769873",
    handle:
      "genuine-leather-strap-with-box-watch-band-butterfly-clasp-bracelet-12-14-16-18mm-20mm-21mm-22mm-24mm-wristband-watch-accessories",
    reviewMethod: "manual-live-gallery-review",
    reviewedBy: "ChatGPT",
    reviewedAt: "2026-09-27",
    assignments: Object.freeze([
      Object.freeze({
        variantIds: [
          "60076339986513",
          "60076340019281",
          "60076340052049",
          "60076340084817",
          "60076340117585",
          "60076340150353",
          "60076340183121",
          "60076340445265",
          "60076340478033",
          "60076342804561",
          "60076342837329",
          "60076343394385",
        ],
        selectedOptions: [
          { name: "Strap color, stitching & clasp", value: "Black strap · Black clasp" },
        ],
        allowedAdditionalOptions: [
          {
            name: "Band Width",
            values: [
              "12mm",
              "13mm",
              "14mm",
              "15mm",
              "16mm",
              "17mm",
              "18mm",
              "19mm",
              "20mm",
              "21mm",
              "22mm",
              "24mm",
            ],
          },
        ],
        mediaId: "gid://shopify/MediaImage/71874339700817",
        rationale:
          "Gallery image 23 shows the black strap, black butterfly clasp, and black stitching for this exact option.",
      }),
      Object.freeze({
        variantIds: [
          "60076339626065",
          "60076339658833",
          "60076339691601",
          "60076340248657",
          "60076340281425",
          "60076340314193",
          "60076340346961",
          "60076340379729",
          "60076340412497",
          "60076342706257",
          "60076342739025",
          "60076342771793",
        ],
        selectedOptions: [
          { name: "Strap color, stitching & clasp", value: "Black strap · Gold clasp" },
        ],
        allowedAdditionalOptions: [
          {
            name: "Band Width",
            values: [
              "12mm",
              "13mm",
              "14mm",
              "15mm",
              "16mm",
              "17mm",
              "18mm",
              "19mm",
              "20mm",
              "21mm",
              "22mm",
              "24mm",
            ],
          },
        ],
        mediaId: "gid://shopify/MediaImage/71874339668049",
        rationale:
          "Gallery image 22 shows the black strap, gold-tone butterfly clasp, and black stitching for this exact option.",
      }),
      Object.freeze({
        variantIds: [
          "60076339462225",
          "60076339494993",
          "60076339527761",
          "60076339560529",
          "60076339593297",
          "60076339855441",
          "60076339888209",
          "60076339920977",
          "60076339953745",
          "60076342607953",
          "60076342640721",
          "60076342673489",
        ],
        selectedOptions: [
          { name: "Strap color, stitching & clasp", value: "Black strap · Rose-gold clasp" },
        ],
        allowedAdditionalOptions: [
          {
            name: "Band Width",
            values: [
              "12mm",
              "13mm",
              "14mm",
              "15mm",
              "16mm",
              "17mm",
              "18mm",
              "19mm",
              "20mm",
              "21mm",
              "22mm",
              "24mm",
            ],
          },
        ],
        mediaId: "gid://shopify/MediaImage/71874339635281",
        rationale:
          "Gallery image 21 shows the black strap, rose-gold-tone butterfly clasp, and black stitching for this exact option.",
      }),
      Object.freeze({
        variantIds: [
          "60076338151505",
          "60076338184273",
          "60076338217041",
          "60076338249809",
          "60076338282577",
          "60076338315345",
          "60076338348113",
          "60076338380881",
          "60076340215889",
          "60076343427153",
          "60076343459921",
          "60076343492689",
        ],
        selectedOptions: [
          { name: "Strap color, stitching & clasp", value: "Black strap · Silver clasp" },
        ],
        allowedAdditionalOptions: [
          {
            name: "Band Width",
            values: [
              "12mm",
              "13mm",
              "14mm",
              "15mm",
              "16mm",
              "17mm",
              "18mm",
              "19mm",
              "20mm",
              "21mm",
              "22mm",
              "24mm",
            ],
          },
        ],
        mediaId: "gid://shopify/MediaImage/71874339405905",
        rationale:
          "Gallery image 14 shows the black strap, silver-tone butterfly clasp, and black stitching for this exact option.",
      }),
      Object.freeze({
        variantIds: [
          "60076343296081",
          "60076343328849",
          "60076343361617",
          "60076343918673",
          "60076343951441",
          "60076343984209",
          "60076344016977",
          "60076344049745",
          "60076344082513",
          "60076344803409",
          "60076344836177",
          "60076344868945",
        ],
        selectedOptions: [
          {
            name: "Strap color, stitching & clasp",
            value: "Black strap · White stitching · Black clasp",
          },
        ],
        allowedAdditionalOptions: [
          {
            name: "Band Width",
            values: [
              "12mm",
              "13mm",
              "14mm",
              "15mm",
              "16mm",
              "17mm",
              "18mm",
              "19mm",
              "20mm",
              "21mm",
              "22mm",
              "24mm",
            ],
          },
        ],
        mediaId: "gid://shopify/MediaImage/71874339504209",
        rationale:
          "Gallery image 17 shows the black strap with white contrast stitching and a black butterfly clasp.",
      }),
      Object.freeze({
        variantIds: [
          "60076343885905",
          "60076344442961",
          "60076344475729",
          "60076344508497",
          "60076344541265",
          "60076344574033",
          "60076344606801",
          "60076344639569",
          "60076344672337",
          "60076345262161",
          "60076345294929",
          "60076345327697",
        ],
        selectedOptions: [
          {
            name: "Strap color, stitching & clasp",
            value: "Black strap · White stitching · Gold clasp",
          },
        ],
        allowedAdditionalOptions: [
          {
            name: "Band Width",
            values: [
              "12mm",
              "13mm",
              "14mm",
              "15mm",
              "16mm",
              "17mm",
              "18mm",
              "19mm",
              "20mm",
              "21mm",
              "22mm",
              "24mm",
            ],
          },
        ],
        mediaId: "gid://shopify/MediaImage/71874339373137",
        rationale:
          "Gallery image 13 shows the black strap with white contrast stitching and a gold-tone butterfly clasp.",
      }),
      Object.freeze({
        variantIds: [
          "60076343132241",
          "60076343165009",
          "60076343197777",
          "60076343230545",
          "60076343263313",
          "60076343525457",
          "60076343558225",
          "60076343590993",
          "60076343623761",
          "60076344705105",
          "60076344737873",
          "60076344770641",
        ],
        selectedOptions: [
          {
            name: "Strap color, stitching & clasp",
            value: "Black strap · White stitching · Rose-gold clasp",
          },
        ],
        allowedAdditionalOptions: [
          {
            name: "Band Width",
            values: [
              "12mm",
              "13mm",
              "14mm",
              "15mm",
              "16mm",
              "17mm",
              "18mm",
              "19mm",
              "20mm",
              "21mm",
              "22mm",
              "24mm",
            ],
          },
        ],
        mediaId: "gid://shopify/MediaImage/71874339766353",
        rationale:
          "Gallery image 25 shows the black strap with white contrast stitching and a rose-gold-tone butterfly clasp.",
      }),
      Object.freeze({
        variantIds: [
          "60076343656529",
          "60076343689297",
          "60076343722065",
          "60076343754833",
          "60076343787601",
          "60076343820369",
          "60076343853137",
          "60076344115281",
          "60076344148049",
          "60076344901713",
          "60076344934481",
          "60076345229393",
        ],
        selectedOptions: [
          {
            name: "Strap color, stitching & clasp",
            value: "Black strap · White stitching · Silver clasp",
          },
        ],
        allowedAdditionalOptions: [
          {
            name: "Band Width",
            values: [
              "12mm",
              "13mm",
              "14mm",
              "15mm",
              "16mm",
              "17mm",
              "18mm",
              "19mm",
              "20mm",
              "21mm",
              "22mm",
              "24mm",
            ],
          },
        ],
        mediaId: "gid://shopify/MediaImage/71874339536977",
        rationale:
          "Gallery image 18 shows the black strap with white contrast stitching and a silver-tone butterfly clasp.",
      }),
      Object.freeze({
        variantIds: [
          "60076341755985",
          "60076341788753",
          "60076342345809",
          "60076342378577",
          "60076342411345",
          "60076342444113",
          "60076342476881",
          "60076342509649",
          "60076342542417",
          "60076345491537",
          "60076345950289",
          "60076345983057",
        ],
        selectedOptions: [
          { name: "Strap color, stitching & clasp", value: "Brown strap · Black clasp" },
        ],
        allowedAdditionalOptions: [
          {
            name: "Band Width",
            values: [
              "12mm",
              "13mm",
              "14mm",
              "15mm",
              "16mm",
              "17mm",
              "18mm",
              "19mm",
              "20mm",
              "21mm",
              "22mm",
              "24mm",
            ],
          },
        ],
        mediaId: null,
        decision: "held-no-matching-gallery-image",
        holdReason:
          "The complete gallery has a brown strap with a black clasp only in a mixed comparison image; no clean single-option photo confirms the plain brown-stitch combination. Do not substitute the white-stitched BrownWhite Black image.",
        rationale:
          "All 26 gallery images were visually compared. The Brown Black / brown-stitch combination has no clean exact-match photo.",
      }),
      Object.freeze({
        variantIds: [
          "60076341559377",
          "60076341592145",
          "60076341624913",
          "60076341657681",
          "60076341690449",
          "60076341723217",
          "60076341985361",
          "60076342018129",
          "60076342050897",
          "60076345851985",
          "60076345884753",
          "60076345917521",
        ],
        selectedOptions: [
          { name: "Strap color, stitching & clasp", value: "Brown strap · Gold clasp" },
        ],
        allowedAdditionalOptions: [
          {
            name: "Band Width",
            values: [
              "12mm",
              "13mm",
              "14mm",
              "15mm",
              "16mm",
              "17mm",
              "18mm",
              "19mm",
              "20mm",
              "21mm",
              "22mm",
              "24mm",
            ],
          },
        ],
        mediaId: "gid://shopify/MediaImage/71874339602513",
        rationale:
          "Gallery image 20 shows the brown strap, gold-tone butterfly clasp, and matching brown stitching.",
      }),
      Object.freeze({
        variantIds: [
          "60076341166161",
          "60076341198929",
          "60076341231697",
          "60076341264465",
          "60076341821521",
          "60076341854289",
          "60076341887057",
          "60076341919825",
          "60076341952593",
          "60076345753681",
          "60076345786449",
          "60076345819217",
        ],
        selectedOptions: [
          { name: "Strap color, stitching & clasp", value: "Brown strap · Rose-gold clasp" },
        ],
        allowedAdditionalOptions: [
          {
            name: "Band Width",
            values: [
              "12mm",
              "13mm",
              "14mm",
              "15mm",
              "16mm",
              "17mm",
              "18mm",
              "19mm",
              "20mm",
              "21mm",
              "22mm",
              "24mm",
            ],
          },
        ],
        mediaId: "gid://shopify/MediaImage/71874339471441",
        rationale:
          "Gallery image 16 shows the brown strap, rose-gold-tone butterfly clasp, and matching brown stitching.",
      }),
      Object.freeze({
        variantIds: [
          "60076342083665",
          "60076342116433",
          "60076342149201",
          "60076342181969",
          "60076342214737",
          "60076342247505",
          "60076342280273",
          "60076342313041",
          "60076342575185",
          "60076345524305",
          "60076345557073",
          "60076345589841",
        ],
        selectedOptions: [
          { name: "Strap color, stitching & clasp", value: "Brown strap · Silver clasp" },
        ],
        allowedAdditionalOptions: [
          {
            name: "Band Width",
            values: [
              "12mm",
              "13mm",
              "14mm",
              "15mm",
              "16mm",
              "17mm",
              "18mm",
              "19mm",
              "20mm",
              "21mm",
              "22mm",
              "24mm",
            ],
          },
        ],
        mediaId: "gid://shopify/MediaImage/71874339176529",
        rationale:
          "Gallery image 7 shows the brown strap, silver-tone butterfly clasp, and matching brown stitching; the duplicate image 12 is not needed.",
      }),
      Object.freeze({
        variantIds: [
          "60076340576337",
          "60076340609105",
          "60076340641873",
          "60076340674641",
          "60076340707409",
          "60076340740177",
          "60076341297233",
          "60076341330001",
          "60076341362769",
          "60076345032785",
          "60076345065553",
          "60076345098321",
        ],
        selectedOptions: [
          {
            name: "Strap color, stitching & clasp",
            value: "Brown strap · White stitching · Black clasp",
          },
        ],
        allowedAdditionalOptions: [
          {
            name: "Band Width",
            values: [
              "12mm",
              "13mm",
              "14mm",
              "15mm",
              "16mm",
              "17mm",
              "18mm",
              "19mm",
              "20mm",
              "21mm",
              "22mm",
              "24mm",
            ],
          },
        ],
        mediaId: "gid://shopify/MediaImage/71874339733585",
        rationale:
          "Gallery image 24 shows the brown strap with white contrast stitching and a black butterfly clasp.",
      }),
      Object.freeze({
        variantIds: [
          "60076340510801",
          "60076340543569",
          "60076340805713",
          "60076340838481",
          "60076340871249",
          "60076340904017",
          "60076340936785",
          "60076340969553",
          "60076341002321",
          "60076344967249",
          "60076345000017",
          "60076345458769",
        ],
        selectedOptions: [
          {
            name: "Strap color, stitching & clasp",
            value: "Brown strap · White stitching · Gold clasp",
          },
        ],
        allowedAdditionalOptions: [
          {
            name: "Band Width",
            values: [
              "12mm",
              "13mm",
              "14mm",
              "15mm",
              "16mm",
              "17mm",
              "18mm",
              "19mm",
              "20mm",
              "21mm",
              "22mm",
              "24mm",
            ],
          },
        ],
        mediaId: "gid://shopify/MediaImage/71874339307601",
        rationale:
          "Gallery image 11 shows the brown strap with white contrast stitching and a gold-tone butterfly clasp.",
      }),
      Object.freeze({
        variantIds: [
          "60076340772945",
          "60076344180817",
          "60076344213585",
          "60076344246353",
          "60076344279121",
          "60076344311889",
          "60076344344657",
          "60076344377425",
          "60076344410193",
          "60076345360465",
          "60076345393233",
          "60076345426001",
        ],
        selectedOptions: [
          {
            name: "Strap color, stitching & clasp",
            value: "Brown strap · White stitching · Rose-gold clasp",
          },
        ],
        allowedAdditionalOptions: [
          {
            name: "Band Width",
            values: [
              "12mm",
              "13mm",
              "14mm",
              "15mm",
              "16mm",
              "17mm",
              "18mm",
              "19mm",
              "20mm",
              "21mm",
              "22mm",
              "24mm",
            ],
          },
        ],
        mediaId: "gid://shopify/MediaImage/71874339438673",
        rationale:
          "Gallery image 15 shows the brown strap with white contrast stitching and a rose-gold-tone butterfly clasp.",
      }),
      Object.freeze({
        variantIds: [
          "60076341035089",
          "60076341067857",
          "60076341100625",
          "60076341133393",
          "60076341395537",
          "60076341428305",
          "60076341461073",
          "60076341493841",
          "60076341526609",
          "60076345131089",
          "60076345163857",
          "60076345196625",
        ],
        selectedOptions: [
          {
            name: "Strap color, stitching & clasp",
            value: "Brown strap · White stitching · Silver clasp",
          },
        ],
        allowedAdditionalOptions: [
          {
            name: "Band Width",
            values: [
              "12mm",
              "13mm",
              "14mm",
              "15mm",
              "16mm",
              "17mm",
              "18mm",
              "19mm",
              "20mm",
              "21mm",
              "22mm",
              "24mm",
            ],
          },
        ],
        mediaId: "gid://shopify/MediaImage/71874339569745",
        rationale:
          "Gallery image 19 shows the brown strap with white contrast stitching and a silver-tone butterfly clasp.",
      }),
      Object.freeze({
        variantIds: [
          "60076338937937",
          "60076338970705",
          "60076339003473",
          "60076339265617",
          "60076339298385",
          "60076339331153",
          "60076339363921",
          "60076339396689",
          "60076339429457",
          "60076342935633",
          "60076342968401",
          "60076343001169",
        ],
        selectedOptions: [
          { name: "Strap color, stitching & clasp", value: "Light brown strap · Black clasp" },
        ],
        allowedAdditionalOptions: [
          {
            name: "Band Width",
            values: [
              "12mm",
              "13mm",
              "14mm",
              "15mm",
              "16mm",
              "17mm",
              "18mm",
              "19mm",
              "20mm",
              "21mm",
              "22mm",
              "24mm",
            ],
          },
        ],
        mediaId: "gid://shopify/MediaImage/71874339274833",
        rationale:
          "Gallery image 10 shows the light-brown strap, black butterfly clasp, and matching brown stitching.",
      }),
      Object.freeze({
        variantIds: [
          "60076338446417",
          "60076338479185",
          "60076338511953",
          "60076338544721",
          "60076338577489",
          "60076338610257",
          "60076338643025",
          "60076339200081",
          "60076339232849",
          "60076342870097",
          "60076342902865",
          "60076345720913",
        ],
        selectedOptions: [
          { name: "Strap color, stitching & clasp", value: "Light brown strap · Gold clasp" },
        ],
        allowedAdditionalOptions: [
          {
            name: "Band Width",
            values: [
              "12mm",
              "13mm",
              "14mm",
              "15mm",
              "16mm",
              "17mm",
              "18mm",
              "19mm",
              "20mm",
              "21mm",
              "22mm",
              "24mm",
            ],
          },
        ],
        mediaId: "gid://shopify/MediaImage/71874339242065",
        rationale:
          "Gallery image 9 shows the light-brown strap, gold-tone butterfly clasp, and matching brown stitching.",
      }),
      Object.freeze({
        variantIds: [
          "60076339036241",
          "60076339069009",
          "60076339101777",
          "60076339134545",
          "60076339167313",
          "60076339724369",
          "60076339757137",
          "60076339789905",
          "60076339822673",
          "60076343033937",
          "60076343066705",
          "60076343099473",
        ],
        selectedOptions: [
          { name: "Strap color, stitching & clasp", value: "Light brown strap · Silver clasp" },
        ],
        allowedAdditionalOptions: [
          {
            name: "Band Width",
            values: [
              "12mm",
              "13mm",
              "14mm",
              "15mm",
              "16mm",
              "17mm",
              "18mm",
              "19mm",
              "20mm",
              "21mm",
              "22mm",
              "24mm",
            ],
          },
        ],
        mediaId: "gid://shopify/MediaImage/71874339799121",
        rationale:
          "Gallery image 26 shows the light-brown strap, silver-tone butterfly clasp, and matching brown stitching.",
      }),
      Object.freeze({
        variantIds: [
          "60076338413649",
          "60076338675793",
          "60076338708561",
          "60076338741329",
          "60076338774097",
          "60076338806865",
          "60076338839633",
          "60076338872401",
          "60076338905169",
          "60076345622609",
          "60076345655377",
          "60076345688145",
        ],
        selectedOptions: [
          { name: "Strap color, stitching & clasp", value: "Light brown strap · Rose-gold clasp" },
        ],
        allowedAdditionalOptions: [
          {
            name: "Band Width",
            values: [
              "12mm",
              "13mm",
              "14mm",
              "15mm",
              "16mm",
              "17mm",
              "18mm",
              "19mm",
              "20mm",
              "21mm",
              "22mm",
              "24mm",
            ],
          },
        ],
        mediaId: "gid://shopify/MediaImage/71874339209297",
        rationale:
          "Gallery image 8 shows the light-brown strap, rose-gold-tone butterfly clasp, and matching brown stitching.",
      }),
    ]),
  }),
  Object.freeze({
    productId: "gid://shopify/Product/16323816259665",
    handle:
      "stainless-steel-windproof-clip-towel-rack-drying-rack-hook-windproof-socks-underwear-drying-rack-family-storage-laundry-rack",
    reviewMethod: "manual-live-gallery-review",
    reviewedBy: "user",
    reviewedAt: "2026-09-28",
    assignments: Object.freeze([
      Object.freeze({
        variantTitle: "Square 40 clips",
        mediaId: "gid://shopify/MediaImage/73728923205713",
        rationale:
          "User visually reviewed the Shopify gallery diagram and confirmed this exact live GraphQL variant-media association.",
      }),
      Object.freeze({
        variantTitle: "Square 30 clips",
        mediaId: "gid://shopify/MediaImage/73728923238481",
        rationale:
          "User visually reviewed the Shopify gallery diagram and confirmed this exact live GraphQL variant-media association.",
      }),
      Object.freeze({
        variantTitle: "Square 20 clips",
        mediaId: "gid://shopify/MediaImage/73728923271249",
        rationale:
          "User visually reviewed the Shopify gallery diagram and confirmed this exact live GraphQL variant-media association.",
      }),
      Object.freeze({
        variantTitle: "Round 20 clips",
        mediaId: "gid://shopify/MediaImage/73728923304017",
        rationale:
          "User visually reviewed the Shopify gallery diagram and confirmed this exact live GraphQL variant-media association.",
      }),
      Object.freeze({
        variantTitle: "Arc type 6 clips",
        mediaId: "gid://shopify/MediaImage/73728923336785",
        rationale:
          "User visually reviewed the Shopify gallery diagram and confirmed this exact live GraphQL variant-media association.",
      }),
    ]),
  }),
  Object.freeze({
    productId: "gid://shopify/Product/16022003613777",
    handle:
      "2026-new-650nm-laser-therapy-health-smartwatch-men-ecg-blood-pressure-lipid-uric-acid-bluetooth-call-smart-watch-for-android-ios",
    reviewMethod: "manual-live-gallery-review",
    reviewedBy: "ChatGPT",
    reviewedAt: "2026-09-28",
    assignments: Object.freeze([
      Object.freeze({
        variantId: "gid://shopify/ProductVariant/60383035195473",
        selectedOptions: Object.freeze([{ name: "Band style", value: "Blue" }]),
        mediaId: "gid://shopify/MediaImage/73810414501969",
        imageUrl:
          "https://cdn.shopify.com/s/files/1/1065/7008/8529/files/vs-store-square-smartwatch-blue-band.png?v=1790570464",
        rationale:
          "Reviewed against the live blue-band gallery option. This clean product-only visual keeps the observed square case, side controls, and blue perforated band while removing unsupported medical infographic claims; Shopify live readback confirms this exact MediaImage is attached to this Blue variant.",
      }),
    ]),
  }),
  Object.freeze({
    productId: "gid://shopify/Product/16322574057553",
    handle:
      "women-vintage-large-size-hair-claw-clip-polka-dots-print-acrylic-shark-clip-simple-hairpin-elegant-hair-clips-hair-accessories",
    reviewMethod: "manual-live-gallery-review",
    reviewedBy: "ChatGPT",
    reviewedAt: "2026-09-28",
    assignments: Object.freeze([
      Object.freeze({
        variantId: "gid://shopify/ProductVariant/62684196470865",
        selectedOptions: Object.freeze([
          { name: "Color", value: "Black with white polka dots" },
        ]),
        mediaId: "gid://shopify/MediaImage/73719787126865",
        rationale:
          "Opened the exact Shopify variant image: a black acetate claw clip with white polka dots; the Admin media association resolves to this same product image.",
      }),
      Object.freeze({
        variantId: "gid://shopify/ProductVariant/62684196503633",
        selectedOptions: Object.freeze([
          { name: "Color", value: "Ivory with brown polka dots" },
        ]),
        mediaId: "gid://shopify/MediaImage/73719787159633",
        rationale:
          "Opened the exact Shopify variant image: an ivory claw clip with brown polka dots; the Admin media association resolves to this same product image.",
      }),
      Object.freeze({
        variantId: "gid://shopify/ProductVariant/62684196536401",
        selectedOptions: Object.freeze([
          { name: "Color", value: "Ivory with black polka dots" },
        ]),
        mediaId: "gid://shopify/MediaImage/73719787192401",
        rationale:
          "Opened the exact Shopify variant image: an ivory claw clip with black polka dots; the Admin media association resolves to this same product image.",
      }),
      Object.freeze({
        variantId: "gid://shopify/ProductVariant/62684196569169",
        selectedOptions: Object.freeze([
          { name: "Color", value: "Burgundy with white polka dots" },
        ]),
        mediaId: "gid://shopify/MediaImage/73719787225169",
        rationale:
          "Opened the exact Shopify variant image: a burgundy claw clip with white polka dots; the Admin media association resolves to this same product image.",
      }),
      Object.freeze({
        variantId: "gid://shopify/ProductVariant/62684196601937",
        selectedOptions: Object.freeze([
          { name: "Color", value: "Deep brown with pale pink polka dots" },
        ]),
        mediaId: "gid://shopify/MediaImage/73719787257937",
        rationale:
          "Opened the exact Shopify variant image: a deep brown claw clip with pale pink polka dots; the Admin media association resolves to this same product image.",
      }),
    ]),
  }),
]);

export function findReviewedVariantImage(product, variant, publishedImages = []) {
  const productId = normalizeShopifyId(product?.id);
  const variantId = normalizeShopifyId(variant?.id);
  if (!productId || !variantId) return { found: false, image: null };

  for (const review of REVIEWED_VARIANT_IMAGE_MAPPINGS) {
    if (normalizeShopifyId(review.productId) !== productId || review.handle !== product?.handle)
      continue;

    const assignment = review.assignments.find((entry) => {
      if (Array.isArray(entry.variantIds)) {
        return entry.variantIds.some((id) => normalizeShopifyId(id) === variantId);
      }
      if (entry.variantId) return normalizeShopifyId(entry.variantId) === variantId;
      return typeof entry.variantTitle === "string" && entry.variantTitle === variant?.title;
    });
    if (!assignment) continue;

    const optionsMatch =
      typeof assignment.variantTitle === "string"
        ? variant?.title === assignment.variantTitle
        : Array.isArray(assignment.variantIds)
          ? reviewedOptionGroupMatch(
              variant?.selectedOptions,
              assignment.selectedOptions,
              assignment.allowedAdditionalOptions,
            )
          : exactOptionsMatch(variant?.selectedOptions, assignment.selectedOptions);
    if (assignment.decision === "held-no-matching-gallery-image") {
      return { found: true, image: null };
    }
    const targetId = normalizeShopifyId(assignment.mediaId);
    const targetImageUrl = normalizeReviewImageUrl(assignment.imageUrl);
    const image = publishedImages.find((candidate) => {
      if (targetImageUrl) return normalizeReviewImageUrl(candidate?.url) === targetImageUrl;
      return normalizeShopifyId(candidate?.id) === targetId;
    });
    const isProductImage = Boolean(image?.url);
    return {
      found: true,
      image: optionsMatch && isProductImage ? image : null,
    };
  }

  return { found: false, image: null };
}

function reviewedOptionGroupMatch(actualOptions, expectedOptions, allowedAdditionalOptions) {
  const normalize = (options) =>
    (Array.isArray(options) ? options : []).map((option) => [
      String(option?.name ?? "")
        .trim()
        .toLowerCase(),
      String(option?.value ?? "").trim(),
    ]);
  const actual = normalize(actualOptions);
  const expected = normalize(expectedOptions);
  const additional = Array.isArray(allowedAdditionalOptions) ? allowedAdditionalOptions : [];
  const allowed = new Map(
    additional.map((option) => [
      String(option?.name ?? "")
        .trim()
        .toLowerCase(),
      new Set((option?.values ?? []).map((value) => String(value).trim())),
    ]),
  );
  const names = actual.map(([name]) => name);
  if (actual.length !== expected.length + allowed.size || new Set(names).size !== names.length) {
    return false;
  }
  const actualByName = new Map(actual);
  if (expected.some(([name, value]) => actualByName.get(name) !== value)) return false;
  for (const [name, values] of allowed) {
    const value = actualByName.get(name);
    if (!value || !values.has(value)) return false;
  }
  return actual.every(
    ([name]) => expected.some(([expectedName]) => expectedName === name) || allowed.has(name),
  );
}

function exactOptionsMatch(actualOptions, expectedOptions) {
  const normalize = (options) =>
    (Array.isArray(options) ? options : [])
      .map((option) => [String(option?.name ?? "").trim(), String(option?.value ?? "").trim()])
      .sort(
        ([leftName, leftValue], [rightName, rightValue]) =>
          leftName.localeCompare(rightName) || leftValue.localeCompare(rightValue),
      );
  return JSON.stringify(normalize(actualOptions)) === JSON.stringify(normalize(expectedOptions));
}

function normalizeShopifyId(value) {
  const id =
    String(value ?? "")
      .split("/")
      .pop() ?? "";
  return /^\d+$/.test(id) ? id : "";
}

function normalizeReviewImageUrl(value) {
  if (typeof value !== "string" || !value.trim()) return "";
  try {
    const url = new URL(value.startsWith("//") ? `https:${value}` : value);
    if (url.protocol !== "https:" || url.hostname.toLowerCase() !== "cdn.shopify.com") return "";
    return `${url.hostname.toLowerCase()}${url.pathname}`;
  } catch {
    return "";
  }
}
