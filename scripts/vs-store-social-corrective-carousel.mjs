#!/usr/bin/env node

// One-off, journaled Meta API carousel used for the user's Friday correction.
// Public submit requests are never automatically retried after an ambiguous result.

import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import {
  acquireSocialLock,
  appendSocialEvent,
  appendSocialJournal,
  readSocialState,
  socialPaths,
  writeSocialState,
} from "./lib/vs-store-social-state.mjs";
import {
  configMissing,
  loadVsStoreSocialEnv,
  readVsStoreSocialConfig,
} from "./lib/vs-store-social-config.mjs";
import { createVsStoreMetaClient } from "./lib/vs-store-social-meta.mjs";

const rootDir = resolve(import.meta.dirname, "..");
const paths = [
  "output/ads/product-creatives/2026-09-26/friday-corrective-carousel-v2/slide-1-weekend-sale.png",
  "output/ads/product-creatives/2026-09-26/friday-corrective-carousel-v2/slide-2-demon-slayer.png",
  "output/ads/product-creatives/2026-09-26/friday-corrective-carousel-v2/slide-3-hatsune-miku.png",
].map((path) => resolve(rootDir, path));
const runKey = "2026-09-25-friday-corrective-carousel-v2";
const supersedesRunKey = "2026-09-25-friday-corrective-carousel";
const targetDateEt = "2026-09-25";
const caption =
  "Some stories stay with us—and some collectibles feel right at home on your shelf. 💙✨\n\n" +
  "Discover the Demon Slayer acrylic collectible and Hatsune Miku’s three-design set, featured for fans who love keeping their favorite worlds close.\n\n" +
  "Add this to your collection with VS Store’s Weekend Sale: take 15% off your order through Sunday with code VSSTORE15. 💛\n\n" +
  "Demon Slayer: https://vs-store-us.myshopify.com/products/demon-slayer-related-collectible-acrylic-plaques-for-the-entire-cast-as-well-as-commemorative-gifts-and-movie-related-items\n" +
  "Hatsune Miku: https://vs-store-us.myshopify.com/products/anime-hatsune-miku-collectible-set-3-unique-designs-durable-pvc-ideal-for-display-collection-ideal-gift-for-anime-lovers\n\n" +
  "#VSStore #DemonSlayer #HatsuneMiku #AnimeCollectibles #WeekendSale #VSSTORE15";

const artifactPath = resolve(socialPaths(rootDir).directory, "manual-campaigns", `${runKey}.json`);
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const tidy = (value) => String(value || "").replace(/\s+/g, " ").trim();

function pngMetadata(bytes, imagePath) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (bytes.length < 33 || !bytes.subarray(0, 8).equals(signature))
    throw new Error(`Carousel image is not a valid PNG: ${imagePath}`);
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  const colorType = bytes[25];
  let hasTransparencyChunk = false;
  let offset = 8;
  while (offset + 12 <= bytes.length) {
    const size = bytes.readUInt32BE(offset);
    const type = bytes.toString("ascii", offset + 4, offset + 8);
    if (type === "tRNS") hasTransparencyChunk = true;
    offset += 12 + size;
    if (type === "IEND") break;
  }
  if (width !== height) throw new Error(`Carousel image must be square: ${imagePath}`);
  if ([4, 6].includes(colorType) || hasTransparencyChunk)
    throw new Error(`Carousel image must be fully opaque: ${imagePath}`);
  return { width, height };
}

async function assetManifest() {
  return Promise.all(
    paths.map(async (path, index) => {
      const bytes = await readFile(path);
      return {
        index,
        path,
        sha256: sha256(bytes),
        ...pngMetadata(bytes, path),
      };
    }),
  );
}

async function writeArtifact(value) {
  await mkdir(dirname(artifactPath), { recursive: true });
  const temporary = `${artifactPath}.tmp-${process.pid}`;
  await writeFile(temporary, `${JSON.stringify({ ...value, updatedAt: new Date().toISOString() }, null, 2)}\n`);
  await rename(temporary, artifactPath);
}

async function readArtifact() {
  try {
    return JSON.parse(await readFile(artifactPath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function graphError(payload, status) {
  const error = new Error(
    tidy(payload?.error?.message || payload?.error?.error_user_msg || `Meta Graph API HTTP ${status}`),
  );
  error.httpStatus = status;
  error.metaCode = payload?.error?.code || null;
  error.ambiguous = status === 408 || status === 429 || status >= 500;
  return error;
}

function networkError(cause) {
  const error = new Error(tidy(cause?.message || cause));
  error.ambiguous = true;
  return error;
}

async function graphRequest(config, path, { method = "GET", query = {}, body = null, accessToken } = {}) {
  const url = new URL(`https://graph.facebook.com/${config.metaGraphVersion}${path.startsWith("/") ? path : `/${path}`}`);
  const token = accessToken || config.metaPageAccessToken;
  if (token) url.searchParams.set("access_token", token);
  for (const [key, value] of Object.entries(query))
    if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
  let response;
  try {
    response = await fetch(url, { method, body, signal: AbortSignal.timeout(config.requestTimeoutMs) });
  } catch (cause) {
    throw networkError(cause);
  }
  let payload = {};
  try {
    payload = await response.json();
  } catch {
    if (!response.ok) throw graphError(null, response.status);
  }
  if (!response.ok || payload?.error) throw graphError(payload, response.status);
  return payload;
}

function statusForError(error) {
  return error?.ambiguous ? "unknown" : "failed";
}

async function saveAndJournal(artifact, event, platform = null) {
  await writeArtifact(artifact);
  const entry = {
    type: "corrective_carousel_" + event,
    runKey,
    platform,
    status: artifact.status,
  };
  await appendSocialEvent(rootDir, entry);
  await appendSocialJournal(rootDir, entry);
}

function allAttachmentIds(post) {
  const top = post?.attachments?.data || [];
  return top.flatMap((attachment) => attachment?.subattachments?.data || [attachment])
    .map((item) => tidy(item?.target?.id || item?.media?.id || item?.id))
    .filter(Boolean);
}

function attachmentCount(post) {
  const top = post?.attachments?.data || [];
  if (top.length === 1 && Array.isArray(top[0]?.subattachments?.data))
    return top[0].subattachments.data.length;
  return top.length;
}

async function verifyFacebookPost(config, postId, expectedPhotoIds, expectedCaption) {
  const post = await graphRequest(config, `/${encodeURIComponent(postId)}`, {
    query: {
      fields: "id,message,created_time,permalink_url,attachments{type,media,target,subattachments{type,media,target}}",
    },
  });
  if (tidy(post.id) !== postId || !post.permalink_url || post.message !== expectedCaption)
    throw new Error("Facebook readback did not match the exact corrective post and caption.");
  const count = attachmentCount(post);
  if (count !== expectedPhotoIds.length)
    throw new Error(`Facebook readback returned ${count} carousel photos; expected ${expectedPhotoIds.length}.`);
  const actualIds = allAttachmentIds(post);
  if (actualIds.length && expectedPhotoIds.some((id) => !actualIds.includes(id)))
    throw new Error("Facebook readback photo IDs did not match the three uploaded carousel images.");
  return post;
}

async function verifyInstagramPost(config, accountId, postId, expectedCaption) {
  const post = await graphRequest(config, `/${encodeURIComponent(postId)}`, {
    query: { fields: "id,caption,media_type,permalink,timestamp,children{id,media_type,media_url}" },
    accessToken: config.metaInstagramAccessToken || config.metaPageAccessToken,
  });
  const childCount = post.children?.data?.length || 0;
  if (
    tidy(post.id) !== postId ||
    !post.permalink ||
    post.caption !== expectedCaption ||
    !["CAROUSEL_ALBUM", "CAROUSEL"].includes(tidy(post.media_type).toUpperCase()) ||
    childCount !== 3
  )
    throw new Error(`Instagram readback failed carousel, caption, or three-image verification for ${accountId}.`);
  return post;
}

async function imageUrlForPhoto(config, photoId) {
  const photo = await graphRequest(config, `/${encodeURIComponent(photoId)}`, {
    query: { fields: "id,images,width,height" },
  });
  const imageUrl = tidy(photo.images?.[0]?.source);
  if (tidy(photo.id) !== photoId || !imageUrl || new URL(imageUrl).protocol !== "https:")
    throw new Error(`Facebook did not return a usable HTTPS image URL for uploaded photo ${photoId}.`);
  const probe = await fetch(imageUrl, { method: "HEAD", signal: AbortSignal.timeout(15000) });
  if (!probe.ok) throw new Error(`Meta-hosted carousel image is not publicly readable (HTTP ${probe.status}).`);
  return imageUrl;
}

async function createAndWaitForInstagramContainer(config, accountId, form, imageAccessToken) {
  const created = await graphRequest(config, `/${encodeURIComponent(accountId)}/media`, {
    method: "POST",
    body: form,
    accessToken: imageAccessToken,
  });
  const id = tidy(created.id);
  if (!id) throw new Error("Instagram did not return a media-container ID.");
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    const status = await graphRequest(config, `/${encodeURIComponent(id)}`, {
      query: { fields: "id,status_code,status" },
      accessToken: imageAccessToken,
    });
    const code = tidy(status.status_code || status.status).toUpperCase();
    if (!code || ["FINISHED", "PUBLISHED"].includes(code)) return id;
    if (["ERROR", "EXPIRED"].includes(code)) throw new Error(`Instagram media container is ${code.toLowerCase()}.`);
    await new Promise((resolveWait) => setTimeout(resolveWait, 2500));
  }
  throw new Error("Instagram carousel media container processing timed out.");
}

async function findFacebookPost(config, artifact) {
  const since = Math.max(0, Math.floor(Date.parse(artifact.platforms.facebook.intentAt) / 1000) - 120);
  const payload = await graphRequest(config, `/${encodeURIComponent(config.metaPageId)}/feed`, {
    query: {
      fields: "id,message,created_time,permalink_url,attachments{type,media,target,subattachments{type,media,target}}",
      since,
      limit: 50,
    },
  });
  const candidates = (payload.data || []).filter(
    (post) => post.message === caption && Date.parse(post.created_time) >= since * 1000,
  );
  if (candidates.length !== 1) return null;
  return candidates[0];
}

async function findInstagramPost(config, accountId, artifact) {
  const since = Date.parse(artifact.platforms.instagram.intentAt) - 120_000;
  const payload = await graphRequest(config, `/${encodeURIComponent(accountId)}/media`, {
    query: { fields: "id,caption,media_type,permalink,timestamp,children{id}", limit: 50 },
    accessToken: config.metaInstagramAccessToken || config.metaPageAccessToken,
  });
  const candidates = (payload.data || []).filter(
    (post) =>
      post.caption === caption &&
      ["CAROUSEL", "CAROUSEL_ALBUM"].includes(tidy(post.media_type).toUpperCase()) &&
      Date.parse(post.timestamp) >= since,
  );
  if (candidates.length !== 1) return null;
  return candidates[0];
}

async function getReadyContext() {
  await loadVsStoreSocialEnv(rootDir);
  const config = readVsStoreSocialConfig(rootDir);
  const missing = configMissing(config, { includeShopify: false });
  if (missing.length) throw new Error(`Social configuration is incomplete: ${missing.join(", ")}.`);
  if (config.socialPublisher !== "meta-api-primary")
    throw new Error("Corrective publishing is blocked: configured transport is not meta-api-primary.");
  if (config.metaImageSource !== "facebook-post")
    throw new Error("Corrective publishing requires the preconfigured Facebook-hosted image source.");
  if (!config.socialLiveEnabled) throw new Error("Meta live publishing is disabled in local configuration.");
  const currentState = await readSocialState(rootDir);
  if (currentState.pending)
    throw new Error(`Another daily run is pending (${currentState.pending.runKey}); reconcile it first.`);
  const assets = await assetManifest();
  const preflight = await createVsStoreMetaClient(config).preflight();
  if (preflight.status !== "ready")
    throw new Error(`Dual-platform Meta preflight is not ready: ${preflight.reason}`);
  if (preflight.page.id !== config.metaPageId || preflight.instagram.username !== "vs.store2608")
    throw new Error("Meta preflight did not confirm the exact VS Store Page and @vs.store2608 account.");
  return { config, currentState, assets, preflight };
}

function newArtifact(assets, preflight) {
  return {
    schemaVersion: 1,
    runKey,
    supersedesRunKey,
    correctionForRunKey: targetDateEt,
    requestedDateEt: targetDateEt,
    publisher: "meta-api-primary",
    status: "preparing",
    page: preflight.page,
    instagram: preflight.instagram,
    caption,
    captionSha256: sha256(caption),
    products: [
      {
        title: "Demon Slayer Related Collectible Acrylic Plaques For The Entire Cast",
        handle: "demon-slayer-related-collectible-acrylic-plaques-for-the-entire-cast-as-well-as-commemorative-gifts-and-movie-related-items",
        url: "https://vs-store-us.myshopify.com/products/demon-slayer-related-collectible-acrylic-plaques-for-the-entire-cast-as-well-as-commemorative-gifts-and-movie-related-items",
        sourceImage: "https://cdn.shopify.com/s/files/1/1065/7008/8529/files/S67c16be17218469b850bb1c6b1637ad5L.webp?v=1788675326",
      },
      {
        title: "Anime Hatsune Miku Collectible Set 3 Unique Designs Durable PVC",
        handle: "anime-hatsune-miku-collectible-set-3-unique-designs-durable-pvc-ideal-for-display-collection-ideal-gift-for-anime-lovers",
        url: "https://vs-store-us.myshopify.com/products/anime-hatsune-miku-collectible-set-3-unique-designs-durable-pvc-ideal-for-display-collection-ideal-gift-for-anime-lovers",
        sourceImage: "https://cdn.shopify.com/s/files/1/1065/7008/8529/files/A2a7e602a7b524fb18876ec033e45a71ae.webp?v=1788675327",
      },
    ],
    assets,
    platforms: {
      facebook: { status: "not_started", photoIds: [], imageUrls: [] },
      instagram: { status: "not_started", childContainerIds: [] },
    },
    createdAt: new Date().toISOString(),
  };
}

async function prepareMedia(config, artifact) {
  const facebook = artifact.platforms.facebook;
  if (["unknown", "uploading"].includes(facebook.uploadStatus))
    throw new Error("A Page image upload is ambiguous; reconcile it before retrying.");
  for (let i = facebook.photoIds.length; i < artifact.assets.length; i += 1) {
    const image = artifact.assets[i];
    const bytes = await readFile(image.path);
    const form = new FormData();
    form.set("published", "false");
    form.set("source", new Blob([bytes], { type: "image/png" }), image.path.split("/").at(-1));
    facebook.uploadStatus = "uploading";
    artifact.status = "preparing_media";
    await saveAndJournal(artifact, `facebook_upload_${i + 1}_intent`, "facebook");
    let result;
    try {
      result = await graphRequest(config, `/${encodeURIComponent(config.metaPageId)}/photos`, {
        method: "POST",
        body: form,
      });
    } catch (error) {
      facebook.uploadStatus = statusForError(error);
      facebook.error = tidy(error.message);
      await saveAndJournal(artifact, `facebook_upload_${i + 1}_${facebook.uploadStatus}`, "facebook");
      throw error;
    }
    const photoId = tidy(result.id);
    if (!photoId) throw new Error("Meta Page photo upload returned no photo ID.");
    facebook.photoIds.push(photoId);
    facebook.uploadStatus = "uploaded";
    await saveAndJournal(artifact, `facebook_upload_${i + 1}_complete`, "facebook");
  }
  if (facebook.uploadStatus === "unknown")
    throw new Error("An unpublished Facebook photo upload is ambiguous; reconcile it before retrying.");
  for (let i = facebook.imageUrls.length; i < facebook.photoIds.length; i += 1) {
    const imageUrl = await imageUrlForPhoto(config, facebook.photoIds[i]);
    facebook.imageUrls.push(imageUrl);
    await writeArtifact(artifact);
  }

  const accessToken = config.metaInstagramAccessToken || config.metaPageAccessToken;
  const instagram = artifact.platforms.instagram;
  instagram.childStatuses ||= [];
  for (let i = 0; i < facebook.imageUrls.length; i += 1) {
    if (instagram.childContainerIds[i]) continue;
    if (["submit_intent", "unknown"].includes(instagram.childStatuses[i]))
      throw new Error(`Instagram child container ${i + 1} is ambiguous; reconcile it before retrying.`);
    const form = new URLSearchParams({ image_url: facebook.imageUrls[i], is_carousel_item: "true" });
    instagram.childStatuses[i] = "submit_intent";
    instagram.containerStatus = `creating_child_${i + 1}`;
    await saveAndJournal(artifact, `instagram_child_${i + 1}_intent`, "instagram");
    let id;
    try {
      id = await createAndWaitForInstagramContainer(config, artifact.instagram.id, form, accessToken);
    } catch (error) {
      instagram.childStatuses[i] = statusForError(error);
      await saveAndJournal(artifact, `instagram_child_${i + 1}_${instagram.childStatuses[i]}`, "instagram");
      throw error;
    }
    instagram.childContainerIds[i] = id;
    instagram.childStatuses[i] = "ready";
    await saveAndJournal(artifact, `instagram_child_${i + 1}_ready`, "instagram");
  }
  if (instagram.childContainerIds.filter(Boolean).length !== 3) throw new Error("Instagram carousel needs exactly three ready item containers.");
  if (!instagram.parentContainerId) {
    if (["submit_intent", "unknown"].includes(instagram.parentContainerStatus))
      throw new Error("Instagram parent container creation is ambiguous; reconcile before retrying.");
    instagram.parentContainerStatus = "submit_intent";
    await saveAndJournal(artifact, "instagram_parent_intent", "instagram");
    const form = new URLSearchParams({
      media_type: "CAROUSEL",
      children: instagram.childContainerIds.join(","),
      caption,
    });
    try {
      instagram.parentContainerId = await createAndWaitForInstagramContainer(
        config,
        artifact.instagram.id,
        form,
        accessToken,
      );
      instagram.parentContainerStatus = "ready";
    } catch (error) {
      instagram.parentContainerStatus = statusForError(error);
      await saveAndJournal(artifact, `instagram_parent_${instagram.parentContainerStatus}`, "instagram");
      throw error;
    }
    await saveAndJournal(artifact, "instagram_parent_ready", "instagram");
  }
}

async function publishFacebook(config, artifact) {
  const facebook = artifact.platforms.facebook;
  if (facebook.status === "published") return;
  if (["submit_intent", "unknown"].includes(facebook.status)) {
    let responseId = facebook.responseId;
    if (!responseId) {
      const candidate = await findFacebookPost(config, artifact);
      responseId = tidy(candidate?.id);
    }
    if (!responseId) throw new Error("Facebook outcome is still ambiguous; no retry was made.");
    const post = await verifyFacebookPost(config, responseId, facebook.photoIds, caption);
    facebook.status = "published";
    facebook.postId = tidy(post.id);
    facebook.url = post.permalink_url;
    facebook.observedAt = post.created_time || new Date().toISOString();
    facebook.photoCount = attachmentCount(post);
    artifact.status = "facebook_verified";
    await saveAndJournal(artifact, "facebook_reconciled_readback_verified", "facebook");
    return;
  }
  facebook.intentAt = new Date().toISOString();
  facebook.status = "submit_intent";
  artifact.status = "publishing_facebook";
  await saveAndJournal(artifact, "facebook_submit_intent", "facebook");
  let response;
  try {
    const form = new URLSearchParams({ message: caption, published: "true" });
    facebook.photoIds.forEach((id, index) =>
      form.set(`attached_media[${index}]`, JSON.stringify({ media_fbid: id })),
    );
    response = await graphRequest(config, `/${encodeURIComponent(config.metaPageId)}/feed`, {
      method: "POST",
      body: form,
    });
    facebook.responseId = tidy(response.id);
    await saveAndJournal(artifact, "facebook_submit_response_received", "facebook");
  } catch (error) {
    if (error?.ambiguous) {
      facebook.status = "unknown";
      facebook.error = tidy(error.message);
      await saveAndJournal(artifact, "facebook_outcome_unknown", "facebook");
      try {
        const candidate = await findFacebookPost(config, artifact);
        if (candidate?.id) {
          response = { id: candidate.id, reconciled: true };
          facebook.responseId = tidy(candidate.id);
          await saveAndJournal(artifact, "facebook_reconciled_from_feed", "facebook");
        }
      } catch {
        // Keep the unknown state; no automatic resubmission is allowed.
      }
    } else {
      facebook.status = "failed";
      facebook.error = tidy(error.message);
      await saveAndJournal(artifact, "facebook_submit_failed", "facebook");
      throw error;
    }
  }
  if (!response?.id) throw new Error("Facebook submit was ambiguous and no unique matching post was found; no retry was made.");
  const post = await verifyFacebookPost(config, tidy(response.id), facebook.photoIds, caption);
  facebook.status = "published";
  facebook.postId = tidy(post.id);
  facebook.url = post.permalink_url;
  facebook.observedAt = post.created_time || new Date().toISOString();
  facebook.photoCount = attachmentCount(post);
  artifact.status = "facebook_verified";
  await saveAndJournal(artifact, "facebook_readback_verified", "facebook");
}

async function publishInstagram(config, artifact) {
  const instagram = artifact.platforms.instagram;
  if (instagram.status === "published") return;
  if (["submit_intent", "unknown"].includes(instagram.status)) {
    let responseId = instagram.responseId;
    if (!responseId) {
      const candidate = await findInstagramPost(config, artifact.instagram.id, artifact);
      responseId = tidy(candidate?.id);
    }
    if (!responseId) throw new Error("Instagram outcome is still ambiguous; no retry was made.");
    const post = await verifyInstagramPost(config, artifact.instagram.id, responseId, caption);
    instagram.status = "published";
    instagram.postId = tidy(post.id);
    instagram.url = post.permalink;
    instagram.observedAt = post.timestamp || new Date().toISOString();
    instagram.mediaType = post.media_type;
    instagram.childCount = post.children.data.length;
    artifact.status = "completed";
    artifact.completedAt = new Date().toISOString();
    await saveAndJournal(artifact, "instagram_reconciled_readback_verified", "instagram");
    return;
  }
  instagram.intentAt = new Date().toISOString();
  instagram.status = "submit_intent";
  artifact.status = "publishing_instagram";
  await saveAndJournal(artifact, "instagram_submit_intent", "instagram");
  let response;
  try {
    response = await graphRequest(
      config,
      `/${encodeURIComponent(artifact.instagram.id)}/media_publish`,
      {
        method: "POST",
        body: new URLSearchParams({ creation_id: instagram.parentContainerId }),
        accessToken: config.metaInstagramAccessToken || config.metaPageAccessToken,
      },
    );
    instagram.responseId = tidy(response.id);
    await saveAndJournal(artifact, "instagram_submit_response_received", "instagram");
  } catch (error) {
    if (error?.ambiguous) {
      instagram.status = "unknown";
      instagram.error = tidy(error.message);
      await saveAndJournal(artifact, "instagram_outcome_unknown", "instagram");
      try {
        const candidate = await findInstagramPost(config, artifact.instagram.id, artifact);
        if (candidate?.id) {
          response = { id: candidate.id, reconciled: true };
          instagram.responseId = tidy(candidate.id);
          await saveAndJournal(artifact, "instagram_reconciled_from_media", "instagram");
        }
      } catch {
        // Leave durable unknown state for reconciliation; do not retry publishing.
      }
    } else {
      instagram.status = "failed";
      instagram.error = tidy(error.message);
      await saveAndJournal(artifact, "instagram_submit_failed", "instagram");
      throw error;
    }
  }
  if (!response?.id) throw new Error("Instagram submit was ambiguous and no unique matching post was found; no retry was made.");
  const post = await verifyInstagramPost(
    config,
    artifact.instagram.id,
    tidy(response.id),
    caption,
  );
  instagram.status = "published";
  instagram.postId = tidy(post.id);
  instagram.url = post.permalink;
  instagram.observedAt = post.timestamp || new Date().toISOString();
  instagram.mediaType = post.media_type;
  instagram.childCount = post.children.data.length;
  artifact.status = "completed";
  artifact.completedAt = new Date().toISOString();
  await saveAndJournal(artifact, "instagram_readback_verified", "instagram");
}

async function recordCorrectionInHistory(state, artifact) {
  if ((state.history || []).some((item) => item.runKey === runKey)) return;
  const updated = {
    ...state,
    history: [
      ...(state.history || []),
      {
        runKey,
        correctionForRunKey: targetDateEt,
        supersedesRunKey,
        kind: "friday-corrective-carousel-v2",
        title: "Friday Weekend Sale correction — product images fixed",
        publishedAt: artifact.completedAt,
        postId: artifact.platforms.facebook.postId,
        postUrl: artifact.platforms.facebook.url,
        instagramPostId: artifact.platforms.instagram.postId,
        instagramPostUrl: artifact.platforms.instagram.url,
        images: artifact.assets.map(({ path, sha256: imageSha256 }) => ({ path, sha256: imageSha256 })),
        captionSha256: artifact.captionSha256,
        executionPath: "meta-api",
        deliveryStatus: "success",
        platformStates: artifact.platforms,
      },
    ],
  };
  await writeSocialState(rootDir, updated);
}

async function main() {
  const mode = process.argv.includes("--preflight")
    ? "preflight"
    : process.argv.includes("--publish")
      ? "publish"
      : process.argv.includes("--resume")
        ? "resume"
        : null;
  if (!mode) throw new Error("Use --preflight, --publish, or --resume.");
  const { config, currentState, assets, preflight } = await getReadyContext();
  const artifactExisting = await readArtifact();
  if (
    artifactExisting &&
    (artifactExisting.runKey !== runKey || artifactExisting.captionSha256 !== sha256(caption))
  )
    throw new Error("The durable corrective-carousel record does not match this exact creative and caption.");
  if (mode === "preflight") {
    process.stdout.write(`${JSON.stringify({
      status: "ready",
      requestedDateEt: targetDateEt,
      actualEtNow: new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", dateStyle: "full", timeStyle: "long" }).format(new Date()),
      publisher: config.socialPublisher,
      liveEnabled: config.socialLiveEnabled,
      dailyRunPending: Boolean(currentState.pending),
      page: preflight.page,
      instagram: preflight.instagram,
      assets,
      captionSha256: sha256(caption),
      artifactStatus: artifactExisting?.status || "not_created",
    }, null, 2)}\n`);
    return;
  }
  if (artifactExisting?.status === "completed") {
    await recordCorrectionInHistory(currentState, artifactExisting);
    process.stdout.write(`${JSON.stringify({ status: "already_completed", facebook: artifactExisting.platforms.facebook.url, instagram: artifactExisting.platforms.instagram.url })}\n`);
    return;
  }
  if (artifactExisting && mode === "publish")
    throw new Error(`A durable ${artifactExisting.status} correction already exists; use --resume only after inspecting it.`);
  const existingFacebook = artifactExisting?.platforms?.facebook;
  const existingInstagram = artifactExisting?.platforms?.instagram;
  if (["unknown", "uploading"].includes(existingFacebook?.uploadStatus))
    throw new Error("An unpublished Page photo upload is ambiguous; do not repeat it without reconciliation.");
  if (
    existingInstagram?.childStatuses?.some((status) => ["submit_intent", "unknown"].includes(status)) ||
    ["submit_intent", "unknown"].includes(existingInstagram?.parentContainerStatus)
  )
    throw new Error("Instagram container creation is ambiguous; do not repeat it without reconciliation.");

  const releaseLock = await acquireSocialLock(rootDir, { publisher: "meta-api-primary" });
  try {
    // Re-read under the shared lock so the daily runner cannot race this correction.
    const lockedState = await readSocialState(rootDir);
    if (lockedState.pending) throw new Error(`Another daily run became pending (${lockedState.pending.runKey}).`);
    let artifact = artifactExisting || newArtifact(assets, preflight);
    if (!artifactExisting) await saveAndJournal(artifact, "started");
    await prepareMedia(config, artifact);
    // Re-check exact account identity immediately before public submit actions.
    const finalPreflight = await createVsStoreMetaClient(config).preflight();
    if (finalPreflight.status !== "ready" || finalPreflight.page.id !== config.metaPageId || finalPreflight.instagram.username !== "vs.store2608")
      throw new Error("Meta identity preflight changed before publish; no public post was submitted.");
    await publishFacebook(config, artifact);
    await publishInstagram(config, artifact);
    if (artifact.status === "completed") await recordCorrectionInHistory(lockedState, artifact);
    process.stdout.write(`${JSON.stringify({
      status: artifact.status,
      requestedDateEt: targetDateEt,
      publishedAtEt: new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", dateStyle: "full", timeStyle: "long" }).format(new Date(artifact.completedAt || Date.now())),
      facebook: { status: artifact.platforms.facebook.status, url: artifact.platforms.facebook.url || null, photoCount: artifact.platforms.facebook.photoCount || null },
      instagram: { status: artifact.platforms.instagram.status, url: artifact.platforms.instagram.url || null, mediaType: artifact.platforms.instagram.mediaType || null, childCount: artifact.platforms.instagram.childCount || null },
      artifacts: artifact.assets.map(({ path, sha256: digest }) => ({ path, sha256: digest })),
    }, null, 2)}\n`);
    if (artifact.status !== "completed") process.exitCode = 2;
  } finally {
    await releaseLock();
  }
}

main().catch((error) => {
  process.stderr.write(`VS Store corrective carousel stopped safely: ${tidy(error.message)}\n`);
  process.exitCode = 1;
});
