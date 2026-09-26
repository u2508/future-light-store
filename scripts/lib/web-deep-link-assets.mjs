import { access, readFile } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";

const LOCAL_ASSET_BASE = "/assets/";

function readAttribute(attributes, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return attributes.match(new RegExp(`\\b${escaped}\\s*=\\s*(["'])(.*?)\\1`, "i"))?.[2] ?? null;
}

export function collectWebEntryAssetReferences(html) {
  const references = [];
  for (const match of String(html).matchAll(/<(script|link)\b([^>]*)>/gi)) {
    const [, tagName, attributes] = match;
    if (tagName.toLowerCase() === "script") {
      if (readAttribute(attributes, "type")?.toLowerCase() !== "module") continue;
      const src = readAttribute(attributes, "src");
      if (src) references.push({ kind: "module script", url: src });
      continue;
    }

    const rel = (readAttribute(attributes, "rel") ?? "").toLowerCase().split(/\s+/);
    if (!rel.includes("stylesheet") && !rel.includes("modulepreload")) continue;
    const href = readAttribute(attributes, "href");
    if (href) references.push({ kind: rel.includes("stylesheet") ? "stylesheet" : "module preload", url: href });
  }
  return references;
}

export function findInvalidWebDeepLinkAssetReferences(html) {
  return collectWebEntryAssetReferences(html).filter(({ url }) => {
    const pathname = String(url).split(/[?#]/, 1)[0];
    return !pathname.startsWith(LOCAL_ASSET_BASE) || pathname.includes("/../");
  });
}

export async function verifyBuiltWebEntrypoint(distDirectory) {
  const indexPath = resolve(distDirectory, "index.html");
  const html = await readFile(indexPath, "utf8");
  const references = collectWebEntryAssetReferences(html);
  if (references.length === 0) {
    throw new Error("Web build has no module, stylesheet, or preload assets to verify");
  }

  const invalid = findInvalidWebDeepLinkAssetReferences(html);
  if (invalid.length > 0) {
    throw new Error(
      `Web deep-link assets must use root-absolute ${LOCAL_ASSET_BASE} URLs: ${invalid
        .map(({ kind, url }) => `${kind}=${url}`)
        .join(", ")}`,
    );
  }

  for (const { url } of references) {
    const pathname = String(url).split(/[?#]/, 1)[0];
    const assetPath = resolve(distDirectory, pathname.slice(1));
    const relativePath = relative(resolve(distDirectory), assetPath);
    if (relativePath === ".." || relativePath.startsWith(`..${sep}`)) {
      throw new Error(`Web asset escapes the build directory: ${url}`);
    }
    await access(assetPath);
  }

  return references.length;
}
