import { readFile } from "node:fs/promises";

export async function readApprovalManifest(path) {
  const manifest = JSON.parse(await readFile(path, "utf8"));
  const handles = Array.isArray(manifest?.handles)
    ? manifest.handles.map((entry) => (typeof entry === "string" ? entry : entry?.handle))
    : [];
  const uniqueHandles = [
    ...new Set(handles.map((handle) => String(handle || "").trim()).filter(Boolean)),
  ];
  const entries = Array.isArray(manifest?.handles)
    ? manifest.handles.map((entry) => (typeof entry === "string" ? { handle: entry } : entry))
    : [];
  const entryByHandle = new Map(
    entries
      .filter((entry) => entry && typeof entry.handle === "string")
      .map((entry) => [entry.handle.trim(), entry]),
  );
  const errors = [];

  if (manifest?.approved !== true) errors.push("approved must be true");
  if (!String(manifest?.approvalId || "").trim()) errors.push("approvalId is required");
  if (uniqueHandles.length < 12 || uniqueHandles.length > 18) {
    errors.push("12-18 unique handles are required");
  }
  if (uniqueHandles.length !== entries.length) errors.push("handles must be unique and non-empty");

  for (const handle of uniqueHandles) {
    const entry = entryByHandle.get(handle);
    if (!entry) {
      errors.push(`${handle}: missing approval entry`);
      continue;
    }
    if (entry.supplierDeliveryVerified !== true)
      errors.push(`${handle}: supplier delivery not verified`);
    if (entry.returnsVerified !== true) errors.push(`${handle}: returns process not verified`);
    if (entry.marginApproved !== true) errors.push(`${handle}: margin not approved`);
    if (entry.operatorApproved !== true) errors.push(`${handle}: operator approval missing`);
    if (!Number.isFinite(Number(entry.allowableCpaUsd)) || Number(entry.allowableCpaUsd) <= 0) {
      errors.push(`${handle}: allowableCpaUsd must be a positive number`);
    }
  }

  return { manifest, handles: uniqueHandles, errors };
}

export function approvalSummary(approval) {
  return {
    approved: approval.manifest?.approved === true && approval.errors.length === 0,
    approvalId: String(approval.manifest?.approvalId || ""),
    handles: approval.handles,
    errors: approval.errors,
  };
}
