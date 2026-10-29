// ============================================================
// คิดครัว — where photos live (ADR 0037 Q5–Q6, Kong 2026-10-29)
// ============================================================
// Bill photos and slips are bytes, and bytes do not belong in Postgres. Three
// cases, decided by whether credentials exist — the same switch ADR 0031 uses
// for email, and for the same reason:
//
//   * Tigris (production): `fly storage create` sets AWS_ACCESS_KEY_ID,
//     AWS_SECRET_ACCESS_KEY, AWS_ENDPOINT_URL_S3 and BUCKET_NAME as secrets on
//     the app. S3-compatible, so moving to R2 or S3 is an environment change.
//   * A local folder (dev, no credentials): `.storage/` in the repo, ignored
//     by git — a dev machine with no bucket has not FAILED to store a photo.
//   * Production with no credentials: REFUSED. Writing to the container's
//     disk would look fine and lose every photo on the next deploy.
//
// The bucket is private. Nothing here hands out a URL; every read goes
// through /api/files, which checks who is asking first.
// ============================================================

import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

export class StorageNotConfiguredError extends Error {
  constructor() {
    super("Object storage is not configured (BUCKET_NAME / AWS_* missing) — refusing to write to the container disk in production");
    this.name = "StorageNotConfiguredError";
  }
}

type Backend = { kind: "s3"; client: S3Client; bucket: string } | { kind: "local"; root: string } | { kind: "none" };

let cached: Backend | null = null;

function backend(): Backend {
  if (cached) return cached;
  const { BUCKET_NAME, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_ENDPOINT_URL_S3, AWS_REGION } = process.env;
  if (BUCKET_NAME && AWS_ACCESS_KEY_ID && AWS_SECRET_ACCESS_KEY) {
    cached = {
      kind: "s3",
      bucket: BUCKET_NAME,
      client: new S3Client({
        region: AWS_REGION || "auto",
        endpoint: AWS_ENDPOINT_URL_S3 || undefined,
        credentials: { accessKeyId: AWS_ACCESS_KEY_ID, secretAccessKey: AWS_SECRET_ACCESS_KEY },
      }),
    };
  } else if (process.env.NODE_ENV !== "production") {
    cached = { kind: "local", root: path.join(process.cwd(), ".storage") };
  } else {
    cached = { kind: "none" };
  }
  return cached;
}

/** Whether a photo can be stored at all — the screens say so instead of failing at the end. */
export function storageReady(): boolean {
  return backend().kind !== "none";
}

/** Inside the local root only: a key is ours, but never trust a path join blindly. */
function localPath(root: string, key: string): string {
  const full = path.resolve(root, key);
  if (!full.startsWith(root + path.sep)) throw new Error(`storage key escapes the root: ${key}`);
  return full;
}

const EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heif",
  "application/pdf": "pdf",
};
export const ALLOWED_CONTENT_TYPES = new Set(Object.keys(EXT));
/** A phone photo is 2–6 MB; a scanned multi-page PDF can be more. */
export const MAX_FILE_BYTES = 15 * 1024 * 1024;

/** "<tenant>/<yyyy-mm>/<id>.<ext>" — grouped by month so a bucket listing reads like the zip. */
export function newStorageKey(tenantId: string, contentType: string, now = new Date()): { id: string; key: string } {
  const id = randomUUID();
  const month = now.toISOString().slice(0, 7);
  return { id, key: `${tenantId}/${month}/${id}.${EXT[contentType] ?? "bin"}` };
}

/** Where an image's small copy lives — next to the original, by convention. */
export const thumbKeyOf = (key: string) => `${key}.thumb.jpg`;

export const sha256Hex = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

export async function putObject(key: string, bytes: Uint8Array, contentType: string): Promise<void> {
  const b = backend();
  if (b.kind === "none") throw new StorageNotConfiguredError();
  if (b.kind === "s3") {
    await b.client.send(new PutObjectCommand({ Bucket: b.bucket, Key: key, Body: bytes, ContentType: contentType }));
    return;
  }
  const full = localPath(b.root, key);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, bytes);
}

/** The bytes, or null when the object is not there (a thumbnail that was never made). */
export async function getObject(key: string): Promise<Uint8Array | null> {
  const b = backend();
  if (b.kind === "none") throw new StorageNotConfiguredError();
  if (b.kind === "s3") {
    try {
      const res = await b.client.send(new GetObjectCommand({ Bucket: b.bucket, Key: key }));
      return res.Body ? await res.Body.transformToByteArray() : null;
    } catch (e) {
      if (e instanceof Error && (e.name === "NoSuchKey" || e.name === "NotFound")) return null;
      throw e;
    }
  }
  try {
    return await fs.readFile(localPath(b.root, key));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
}

export async function deleteObject(key: string): Promise<void> {
  const b = backend();
  if (b.kind === "none") throw new StorageNotConfiguredError();
  if (b.kind === "s3") {
    await b.client.send(new DeleteObjectCommand({ Bucket: b.bucket, Key: key }));
    return;
  }
  await fs.rm(localPath(b.root, key), { force: true });
}
