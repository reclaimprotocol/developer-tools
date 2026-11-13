import PostalMime, { decodeWords } from "postal-mime";
import { convert } from "html-to-text";
import { fileTypeFromBuffer } from "file-type";
import { checkAttachmentBytes, checkImageSize, checkArchiveSize, readStdinChunk, writeStdout } from "./attachment-limits.mjs";

// This worker has no network, writable filesystem, inherited environment, or approval API.
async function preview() {
let raw;
let email;
try {
  const chunks = []; let size = 0;
  for (;;) {
    const chunk = Buffer.alloc(65536), count = readStdinChunk(chunk);
    if (!count) break;
    size += count; if (size > 12 * 1024 * 1024) throw new Error("MESSAGE_SIZE");
    chunks.push(chunk.subarray(0, count));
  }
  const input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (typeof input.attachment === "string") {
    raw = Buffer.from(input.attachment, "base64");
    if (raw.length > 6 * 1024 * 1024) throw new Error("PREVIEW_ATTACHMENT_LIMIT");
    await checkArchiveSize(raw);
    const type = await fileTypeFromBuffer(raw).catch(() => undefined);
    checkAttachmentBytes(raw, type?.ext ?? "txt");
    if (type && ["png", "jpg", "gif", "webp"].includes(type.ext)) checkImageSize(raw, type.ext);
    const binary = type && ["pdf", "png", "jpg", "gif", "webp"].includes(type.ext);
    writeStdout(JSON.stringify({ view: binary ? (type.ext === "pdf" ? "pdf" : "image") : "text",
      viewMimeType: binary ? type.mime : "text/plain; charset=utf-8" }));
    return;
  }
  raw = Buffer.from(input.raw, "base64");
  if (!raw.length || raw.length > 8 * 1024 * 1024) throw new Error("MESSAGE_SIZE");
  email = await PostalMime.parse(raw, { maxNestingDepth: 20, maxHeadersSize: 128 * 1024,
    forceRfc822Attachments: true, attachmentEncoding: "arraybuffer" });
  const plain = email.text?.trim() ? email.text : undefined;
  const converted = plain ?? (email.html ? convert(email.html, { wordwrap: false, selectors: [
    { selector: "img", format: "skip" }, { selector: "script", format: "skip" },
    { selector: "style", format: "skip" }, { selector: "a", options: { ignoreHref: true } },
    ...["h1", "h2", "h3", "h4", "h5", "h6"].map(selector => ({ selector, options: { uppercase: false } })),
  ] }) : "");
  // Display only: remove layout spacers while retaining paragraphs, lists and
  // plain-text indentation. The authenticated source and its hashes are untouched.
  const body = converted.replace(/\r\n?/g, "\n").replace(/\u00a0/g, " ").replace(/[\u200b\ufeff]/g, "")
    .split("\n").map(line => (plain ? line : line.replace(/[ \t]+/g, " ")).trimEnd()).join("\n")
    .replace(/\n{3,}/g, "\n\n").replace(/^\n+|\n+$/g, "");
  const bodyBytes = Buffer.from(body), truncated = bodyBytes.length > 256 * 1024;
  const text = truncated ? new TextDecoder().decode(bodyBytes.subarray(0, 256 * 1024), { stream: true }) : body;
  // Transport untrusted markup only to the sandboxed, sanitized HTML renderer.
  // Never cut HTML mid-tag; oversized markup uses the bounded text alternative.
  const html = email.html && Buffer.byteLength(email.html) <= 1024 * 1024 ? email.html : undefined;
  if (email.attachments.length > 20) throw new Error("PREVIEW_ATTACHMENT_LIMIT");
  let total = 0;
  const attachments = [];
  for (const [index, part] of email.attachments.entries()) {
    const bytes = Buffer.from(new Uint8Array(part.content)); total += bytes.length;
    if (total > 8 * 1024 * 1024) throw new Error("PREVIEW_ATTACHMENT_LIMIT");
    let type, previewError;
    try {
      checkAttachmentBytes(bytes);
      await checkArchiveSize(bytes);
      type = await fileTypeFromBuffer(bytes).catch(() => undefined);
      checkAttachmentBytes(bytes, type?.ext ?? "txt");
      if (type && ["png", "jpg", "gif", "webp"].includes(type.ext)) checkImageSize(bytes, type.ext);
    } catch (error) {
      if (error?.message !== "ATTACHMENT_TEXT_TOO_LARGE") throw error;
      previewError = "ATTACHMENT_TEXT_TOO_LARGE";
    }
    const binary = type && ["pdf", "png", "jpg", "gif", "webp"].includes(type.ext);
    attachments.push({ index, filename: (part.filename || `attachment-${index + 1}`).slice(0, 512),
      mimeType: (part.mimeType || "application/octet-stream").slice(0, 128),
      view: binary ? (type.ext === "pdf" ? "pdf" : "image") : "text",
      viewMimeType: binary ? type.mime : "text/plain; charset=utf-8",
      ...(previewError ? { previewError } : {}), base64: bytes.toString("base64"), inline: !!(part.related || part.disposition === "inline") });
    if (part.contentId) attachments.at(-1).contentId = part.contentId.replace(/^<|>$/g, "").slice(0, 512);
    bytes.fill(0);
  }
  const header = name => decodeWords(email.headers.find(h => h.key === name)?.value ?? "")
    .replace(/\s+/g, " ").trim().slice(0, 2048);
  writeStdout(JSON.stringify({ body: text, html, truncated: truncated || !!(email.html && !html), subject: header("subject"), from: header("from"),
    to: header("to"), date: header("date"), attachments }));
} catch (error) {
  const code = ["MESSAGE_SIZE", "PREVIEW_ATTACHMENT_LIMIT", "ATTACHMENT_TEXT_TOO_LARGE", "ATTACHMENT_FORMAT_INVALID"].includes(error?.message) ? error.message : "EMAIL_PREVIEW_UNAVAILABLE";
  writeStdout(JSON.stringify({ error: code }));
} finally {
  raw?.fill(0);
  for (const part of email?.attachments ?? []) new Uint8Array(part.content).fill(0);
}
}
await preview();
