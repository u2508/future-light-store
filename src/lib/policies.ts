import { STORE_CONTACT } from "@/lib/store-contact";

export type PolicySection = {
  heading: string;
  paragraphs: string[];
};

export type StorePolicy = {
  title: string;
  description: string;
  updated?: string;
  sections: PolicySection[];
};

export const POLICIES: Record<string, StorePolicy> = {
  shipping: {
    title: "Shipping policy",
    description: "How VS Store prepares, dispatches and tracks your order.",
    sections: [
      {
        heading: "Order processing",
        paragraphs: [
          "Orders are usually prepared within 1–2 business days. Processing begins after payment and order details have been confirmed.",
        ],
      },
      {
        heading: "Delivery estimates and charges",
        paragraphs: [
          "Available delivery options, estimated delivery times and shipping charges are calculated at checkout based on your delivery address and the items in your order.",
          "Delivery estimates are not guaranteed. Carrier, customs or other events outside our control can affect the final delivery date.",
        ],
      },
      {
        heading: "Tracking and address changes",
        paragraphs: [
          "Once your order is dispatched, we will send the tracking link available for your shipment to the email address used at checkout.",
          "Please check your delivery address carefully before placing an order. Contact us as soon as possible if you notice an error; an address cannot always be changed after dispatch.",
        ],
      },
      {
        heading: "Customs and delivery issues",
        paragraphs: [
          "If your destination applies customs duties, import taxes or similar charges, those charges may be handled separately from the product price and shipping charge. Carrier or customs delays are outside our control.",
          `If tracking shows a problem or your order has not arrived within the estimate, contact us at ${STORE_CONTACT.email} with your order number.`,
        ],
      },
    ],
  },
  returns: {
    title: "Return and refund policy",
    description: "Our 30-day return process for eligible VS Store orders.",
    sections: [
      {
        heading: "Return window and eligibility",
        paragraphs: [
          "You can request a return within 30 days after receiving your item. The item must be in the same condition in which you received it: unworn or unused, with tags attached and in its original packaging. Please keep your receipt or other proof of purchase.",
          "Some products may not be returnable, including perishable goods, custom or personalised products, personal-care goods, hazardous materials, flammable liquids or gases, sale items and gift cards.",
        ],
      },
      {
        heading: "How to request a return",
        paragraphs: [
          `Email ${STORE_CONTACT.email} before sending anything back. We will review the request and provide the applicable return instructions and destination. Items sent without first requesting a return may not be accepted.`,
        ],
      },
      {
        heading: "Damaged, defective or incorrect items",
        paragraphs: [
          "Please inspect your order when it arrives and contact us promptly if it is defective, damaged or incorrect. Include your order number and a description of the issue so we can review it and work toward a resolution.",
        ],
      },
      {
        heading: "Refunds and exchanges",
        paragraphs: [
          "After an approved return is received and inspected, we will notify you whether the refund is approved. Approved refunds are sent to the original payment method, normally within 10 business days; your bank or card provider may take additional time to post it.",
          "The fastest way to exchange an item is usually to return the original item after approval and place a separate order for the replacement.",
        ],
      },
      {
        heading: "Your legal rights",
        paragraphs: [
          "This policy does not limit any mandatory consumer rights that apply to your order under the laws of your place of residence.",
        ],
      },
    ],
  },
  privacy: {
    title: "Privacy policy",
    description: "How VS Store uses information needed to run the store and support your orders.",
    updated: "August 24, 2026",
    sections: [
      {
        heading: "Information we collect",
        paragraphs: [
          "Depending on how you use the Services, we may collect your name, billing and delivery address, email address, phone number, account details, order and return history, messages to support, and information about how you use the website.",
          "We may also receive device, browser and network information used to keep the website secure and understand how it performs.",
        ],
      },
      {
        heading: "How we use information",
        paragraphs: [
          "We use this information to process payments and orders, arrange delivery, provide tracking, manage accounts, handle returns, answer support requests, prevent fraud, improve the store and send marketing communications where permitted.",
        ],
      },
      {
        heading: "Service providers",
        paragraphs: [
          "Checkout and payment processing are provided through Shopify. We may share the information needed for checkout, fulfilment, delivery, account services, analytics or customer support with Shopify and other service providers acting on our behalf.",
          "VS Store does not store full payment card details in the storefront application.",
        ],
      },
      {
        heading: "Your choices",
        paragraphs: [
          "You can contact us to ask about accessing, correcting or deleting personal information, subject to applicable legal requirements. You can unsubscribe from promotional email using its unsubscribe link; order and account messages may still be sent when necessary.",
        ],
      },
      {
        heading: "Contact",
        paragraphs: [
          `For privacy questions or requests, email ${STORE_CONTACT.email} or write to ${STORE_CONTACT.address}.`,
        ],
      },
    ],
  },
  terms: {
    title: "Terms of service",
    description: "The terms that apply when you browse or shop with VS Store.",
    sections: [
      {
        heading: "Using the Services",
        paragraphs: [
          "By visiting or using the VS Store website, you agree to these Terms of Service and our Privacy Policy. You must be legally able to enter into this agreement in your place of residence.",
          "You agree to provide accurate, current information when you create an account or place an order and to keep your account credentials secure.",
        ],
      },
      {
        heading: "Products, prices and orders",
        paragraphs: [
          "Product information, prices, promotions and availability may change without notice. We may correct errors or cancel an order when information is materially inaccurate, including after an order is submitted; if we cancel, we will refund any payment received for that order.",
          "An order is subject to payment approval, inventory availability and confirmation by VS Store.",
        ],
      },
      {
        heading: "Shipping, returns and payments",
        paragraphs: [
          "Shipping, returns and refunds are governed by the policies linked on this website. Checkout and payment processing are provided through Shopify and may be subject to Shopify's own terms and privacy practices.",
        ],
      },
      {
        heading: "Acceptable use",
        paragraphs: [
          "You may use the Services only for lawful, personal shopping purposes. You must not interfere with the website, attempt unauthorised access, upload malicious code, scrape the Services, infringe another person's rights or misuse another person's personal information.",
        ],
      },
      {
        heading: "Disclaimers and changes",
        paragraphs: [
          "Delivery dates, carrier performance and third-party services are not guaranteed. To the extent permitted by law, VS Store is not responsible for indirect losses or disruptions outside our reasonable control.",
          "We may update these Terms by posting a revised version on this page. Your continued use of the Services after an update means you accept the revised Terms.",
        ],
      },
      {
        heading: "Contact",
        paragraphs: [`Questions about these Terms should be sent to ${STORE_CONTACT.email}.`],
      },
    ],
  },
  contact: {
    title: "Contact information",
    description: "Reach VS Store for order, delivery, return and privacy support.",
    sections: [
      {
        heading: "Customer support",
        paragraphs: [
          "For order help, include your order number and the email address used at checkout. Please do not send passwords, one-time codes or full payment card details by email.",
        ],
      },
      {
        heading: "Business information",
        paragraphs: [
          `Trading name: ${STORE_CONTACT.tradingName}`,
          `Legal seller: ${STORE_CONTACT.legalSeller}`,
          `Email: ${STORE_CONTACT.email}`,
          `Phone: ${STORE_CONTACT.phoneDisplay}`,
          `Address: ${STORE_CONTACT.address}`,
        ],
      },
    ],
  },
  "legal-notice": {
    title: "Legal notice",
    description: "Legal and business information for the VS Store website.",
    sections: [
      {
        heading: "Store operator",
        paragraphs: [
          `VS Store is the customer-facing trading name of ${STORE_CONTACT.legalSeller}.`,
          "The website, product listings, brand presentation and customer support are provided under the VS Store name.",
        ],
      },
      {
        heading: "Website platform",
        paragraphs: [
          "The store uses Shopify for ecommerce infrastructure, checkout and payment processing. Product availability, prices, delivery estimates and policies may be updated as the store changes.",
        ],
      },
      {
        heading: "Business contact",
        paragraphs: [
          `Email: ${STORE_CONTACT.email}`,
          `Phone: ${STORE_CONTACT.phoneDisplay}`,
          `Address: ${STORE_CONTACT.address}`,
        ],
      },
    ],
  },
};
