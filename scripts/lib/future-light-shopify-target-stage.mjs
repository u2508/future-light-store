import { createHash } from "node:crypto";

export const FUTURE_LIGHT_RELEASE_SHOP_DOMAIN = "vs-future-store-0jl2t-jxu6tnr3.myshopify.com";
export const FUTURE_LIGHT_RELEASE_SHOP_ID = "gid://shopify/Shop/106570088529";

const TARGET_QUERY = /* GraphQL */ `
  query FutureLightReleaseTargetIdentity {
    shop {
      id
      myshopifyDomain
      primaryDomain { host }
    }
  }
`;

function digest(value) {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}

function verifyStage(stage) {
  if (stage?.id !== "shopify.preflight.target" || stage.target !== "shopify" ||
      typeof stage.resumeFingerprint !== "string" || !/^[a-f0-9]{64}$/.test(stage.resumeFingerprint)) {
    throw new Error("Invalid Shopify target-verification stage descriptor");
  }
}

/** Create the first release handler. It can only read and verify store identity. */
export function createFutureLightShopifyTargetHandler({
  client,
  expectedShopDomain = FUTURE_LIGHT_RELEASE_SHOP_DOMAIN,
  expectedShopId = FUTURE_LIGHT_RELEASE_SHOP_ID,
  now = () => new Date().toISOString(),
} = {}) {
  if (!client || typeof client.run !== "function") throw new TypeError("A Shopify Admin GraphQL client is required");
  if (expectedShopDomain !== FUTURE_LIGHT_RELEASE_SHOP_DOMAIN || expectedShopId !== FUTURE_LIGHT_RELEASE_SHOP_ID) {
    throw new Error("Future Light release target constants cannot be overridden");
  }
  if (client.storeDomain !== expectedShopDomain) {
    throw new Error(`Refused Shopify target ${client.storeDomain}; expected ${expectedShopDomain}`);
  }

  const verify = async (stage) => {
    verifyStage(stage);
    const response = await client.run(TARGET_QUERY, {}, { operation: "verify exact Future Light Shopify shop identity" });
    const shop = response?.shop;
    if (shop?.id !== expectedShopId || shop?.myshopifyDomain !== expectedShopDomain) {
      throw new Error("Shopify Admin identity readback does not match the verified Future Light store; refusing all writes");
    }
    const verifiedAt = now();
    const identityFingerprint = digest({ id: shop.id, myshopifyDomain: shop.myshopifyDomain });
    return {
      status: "completed",
      receipt: {
        target: "shopify",
        stageId: stage.id,
        stageFingerprint: stage.resumeFingerprint,
        readbackVerified: true,
        readbackFingerprint: identityFingerprint,
        verifiedAt,
        shopId: shop.id,
        shopDomain: shop.myshopifyDomain,
      },
    };
  };

  return Object.freeze({
    async run({ stage }) {
      return verify(stage);
    },
    async reconcile({ stage }) {
      const result = await verify(stage);
      return {
        status: "completed",
        target: "shopify",
        stageId: stage.id,
        stageFingerprint: stage.resumeFingerprint,
        readbackVerified: true,
        receipt: result.receipt,
      };
    },
    async probe() {
      const response = await client.run(TARGET_QUERY, {}, { operation: "read-only Future Light Shopify connectivity probe" });
      if (response?.shop?.id !== expectedShopId || response?.shop?.myshopifyDomain !== expectedShopDomain) {
        throw new Error("Connectivity probe reached a Shopify store with the wrong identity");
      }
      return true;
    },
  });
}
