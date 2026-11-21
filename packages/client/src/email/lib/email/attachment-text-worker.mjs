import { parentPort, workerData as threadData } from "node:worker_threads";
import { fileURLToPath } from "node:url";
import { fileTypeFromBuffer } from "file-type";
import { createXmlGuard, validateXmlBytes } from "./xml-guard.mjs";

import { checkAttachmentBytes, checkArchiveSize, readStdinChunk, writeStdout } from "./attachment-limits.mjs";

const FORMATS = ["pdf", "docx", "xlsx", "txt", "csv", "html", "json", "xml"];
const TEXT_FORMATS = ["txt", "csv", "html", "json", "xml"];
const MAX_TEXT = 2_000_000;
const fail = (code) => { throw new Error(code); };
function readInput() {
  const chunks = [];
  let size = 0;
  // Read the inherited descriptor directly: Node treats a socket from the
  // parent's network namespace as an unknown stdin stream after unshare.
  for (;;) {
    const chunk = Buffer.alloc(64 * 1024);
    const count = readStdinChunk(chunk);
    if (!count) break;
    size += count;
    if (size > 24 * 1024 * 1024) fail("MESSAGE_SIZE");
    chunks.push(chunk.subarray(0, count));
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
const workerData = threadData ?? readInput();

function checkedText(text, stripBom = true) {
  if (text.length > MAX_TEXT) fail("ATTACHMENT_TEXT_TOO_LARGE");
  if (/[\x00-\x08\x0b\x0e-\x1f\x7f]/.test(text)) fail("ATTACHMENT_TEXT_UNREADABLE");
  const normalized = text.replace(/\r\n?/g, "\n");
  return stripBom ? normalized.replace(/^\uFEFF/, "") : normalized;
}

async function decodeText(bytes, declaredCharset) {
  if (workerData.integrated) {
    const { default: iconv } = await import("iconv-lite");
    const bom = bytes.subarray(0, 4).equals(Buffer.from([0xff, 0xfe, 0, 0])) ? "utf-32le"
      : bytes.subarray(0, 4).equals(Buffer.from([0, 0, 0xfe, 0xff])) ? "utf-32be"
      : bytes.subarray(0, 2).equals(Buffer.from([0xff, 0xfe])) ? "utf-16le"
      : bytes.subarray(0, 2).equals(Buffer.from([0xfe, 0xff])) ? "utf-16be"
      : bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])) ? "utf-8" : undefined;
    let charset = (declaredCharset ?? bom ?? "utf-8").toLowerCase();
    const genericUnicode = charset.replace(/[-_]/g, "");
    if (bom && ["utf16", "utf32"].includes(genericUnicode) && bom.replace(/-/g, "").startsWith(genericUnicode)) charset = bom;
    if (!iconv.encodingExists(charset)) fail("ATTACHMENT_TEXT_UNREADABLE");
    if (bom && declaredCharset && iconv.getCodec(charset) !== iconv.getCodec(bom))
      fail("ATTACHMENT_TEXT_UNREADABLE");
    if (/^(us-ascii|ascii)$/.test(charset) && bytes.some((b) => b > 127)) fail("ATTACHMENT_TEXT_UNREADABLE");
    const text = iconv.decode(bytes, charset, { stripBOM: false });
    if (text.includes("\ufffd") || !iconv.encode(text, charset).equals(bytes)) fail("ATTACHMENT_TEXT_UNREADABLE");
    return { text: checkedText(text, false), encoding: charset };
  }
  let encoding;
  if (bytes.subarray(0, 4).equals(Buffer.from([0xff, 0xfe, 0, 0]))) encoding = "utf-32le";
  else if (bytes.subarray(0, 4).equals(Buffer.from([0, 0, 0xfe, 0xff]))) encoding = "utf-32be";
  else if (bytes.subarray(0, 2).equals(Buffer.from([0xff, 0xfe]))) encoding = "utf-16le";
  else if (bytes.subarray(0, 2).equals(Buffer.from([0xfe, 0xff]))) encoding = "utf-16be";
  else if (bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))) encoding = "utf-8";
  if (encoding && !encoding.startsWith("utf-32"))
    return { text: checkedText(new TextDecoder(encoding, { fatal: true }).decode(bytes)), encoding };
  const prefix = bytes.subarray(0, 2048).toString("ascii");
  const embedded = /(?:charset\s*=\s*["']?([\w.-]+)|<\?xml[^>]*encoding\s*=\s*["']([\w.-]+))/i.exec(prefix);
  const charset = declaredCharset || embedded?.[1] || embedded?.[2];
  if (!encoding && (!charset || /^(utf-?8|us-ascii)$/i.test(charset))) {
    try { return { text: checkedText(new TextDecoder("utf-8", { fatal: true }).decode(bytes)), encoding: "utf-8" }; }
    catch { /* Try charset detection below. */ }
  }
  const { default: iconv } = await import("iconv-lite");
  if (encoding) return { text: checkedText(iconv.decode(bytes, encoding)), encoding };
  if (charset && iconv.encodingExists(charset)) {
    const text = iconv.decode(bytes, charset);
    if (!iconv.encode(text, charset).equals(bytes)) fail("ATTACHMENT_TEXT_UNREADABLE");
    return { text: checkedText(text), encoding: charset.toLowerCase() };
  }
  try { return { text: checkedText(new TextDecoder("utf-8", { fatal: true }).decode(bytes)), encoding: "utf-8" }; }
  catch { /* Fall through to automatic legacy/UTF-16 charset detection. */ }
  const { default: chardet } = await import("chardet");
  for (const match of chardet.analyse(bytes)) {
    if (!iconv.encodingExists(match.name)) continue;
    const text = iconv.decode(bytes, match.name);
    if (!iconv.encode(text, match.name).equals(bytes)) continue;
    try { return { text: checkedText(text), encoding: match.name.toLowerCase() }; }
    catch { /* Another detected encoding may produce readable text. */ }
  }
  fail("ATTACHMENT_TEXT_UNREADABLE");
}

async function validateZip(bytes) {
  if (workerData.integrated) {
    const { Unzip, UnzipInflate, zipSync } = await import("fflate");
    let total = 0, entries = 0, completed = 0, cells = 0, sheets = 0, changed = false;
    const files = Object.create(null);
    const names = new Set();
    const unzip = new Unzip((file) => {
      if (++entries > 10_000 || names.has(file.name)) fail("ATTACHMENT_TEXT_TOO_LARGE");
      names.add(file.name);
      if (file.name.split("/").some((part) => part === "..") || file.name.includes("\\")) fail("ATTACHMENT_FORMAT_INVALID");
      const worksheet = /^xl\/worksheets\/[^/]+\.xml$/.test(file.name);
      if (worksheet && ++sheets > 100) fail("ATTACHMENT_TEXT_TOO_LARGE");
      const xml = /\.(xml|rels)$/i.test(file.name) ? createXmlGuard({ onOpenTag(node) {
        if (worksheet && node.local === "c") {
          if (!["http://schemas.openxmlformats.org/spreadsheetml/2006/main", "http://purl.oclc.org/ooxml/spreadsheetml/main"].includes(node.uri))
            fail("ATTACHMENT_FORMAT_INVALID");
          if (++cells > 100_000) fail("ATTACHMENT_TEXT_TOO_LARGE");
        }
      } }) : undefined;
      const chunks = [];
      file.ondata = (error, chunk, final) => {
        if (error) throw error;
        total += chunk.length;
        if (total > 64 * 1024 * 1024) { file.terminate(); fail("ATTACHMENT_TEXT_TOO_LARGE"); }
        chunks.push(Buffer.from(chunk));
        const decoded = xml?.push(chunk, final);
        if (final) {
          completed++;
          files[file.name] = Buffer.concat(chunks);
          // The pinned document readers expect UTF-8 XML. Validate originals
          // first, then transcode only their internal parser input. Evidence
          // attachment hashes still identify the original decoded file bytes.
          if (decoded && !/^utf-?8$/i.test(decoded.encoding)) {
            changed = true;
            files[file.name] = Buffer.from(decoded.text.replace(/^\uFEFF/, "")
              .replace(/^(<\?xml[^?]*encoding\s*=\s*)(['"])[^'"]*\2/, '$1"UTF-8"'));
          }
        }
      };
      file.start();
    });
    unzip.register(UnzipInflate);
    // Bound actual output as it is inflated, including lying ZIP size fields.
    for (let offset = 0; offset < bytes.length; offset += 1024)
      unzip.push(bytes.subarray(offset, offset + 1024), offset + 1024 >= bytes.length);
    if (!entries || entries !== completed) fail("ATTACHMENT_FORMAT_INVALID");
    return changed ? Buffer.from(zipSync(files, { level: 0 })) : bytes;
  }
  const { unzipSync } = await import("fflate");
  let total = 0, entries = 0;
  // Inspect sizes without inflating entries; document parsers never receive an
  // archive whose declared expanded size is unbounded.
  unzipSync(bytes, { filter(entry) {
    total += entry.originalSize;
    if (++entries > 10_000 || total > 64 * 1024 * 1024) fail("ATTACHMENT_TEXT_TOO_LARGE");
    return false;
  } });
}

async function identify(attachment, bytes) {
  if (workerData.integrated && attachment.body)
    return { format: attachment.mimeType === "text/html" ? "html" : "txt", ...await decodeText(bytes, attachment.charset ?? "us-ascii") };
  if (workerData.integrated && !attachment.body) checkAttachmentBytes(bytes);
  // Bound ZIP expansion before the format detector examines OOXML entries.
  if (workerData.integrated) await checkArchiveSize(bytes);
  else if (bytes[0] === 0x50 && bytes[1] === 0x4b) await validateZip(bytes);
  const declaredMedia = /^(?:image|audio|video)\//i.test(attachment.mimeType);
  const detected = await fileTypeFromBuffer(bytes).catch(error => { if (declaredMedia) return undefined; throw error; });
  if (workerData.integrated && !attachment.body)
    checkAttachmentBytes(bytes, detected?.ext ?? (declaredMedia ? (attachment.mimeType.startsWith("image/") ? "png" : undefined) : "txt"));
  // Actual supported document bytes take precedence over misleading metadata.
  if (detected && FORMATS.includes(detected.ext)) return { format: detected.ext,
    documentBytes: workerData.integrated && ["docx", "xlsx"].includes(detected.ext) ? await validateZip(bytes) : undefined };
  if (detected || (workerData.integrated && (declaredMedia || /\.svg$/i.test(attachment.filename)))) fail("ATTACHMENT_FORMAT_UNSUPPORTED");
  const extension = attachment.filename.split(".").pop().toLowerCase();
  const mime = attachment.mimeType.toLowerCase();
  if (["pdf", "docx", "xlsx"].includes(extension) || ["application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"].includes(mime))
    fail("ATTACHMENT_FORMAT_INVALID");
  const isXml = mime === "application/xml" || mime === "text/xml" || extension === "xml" || bytes.subarray(0, 5).toString() === "<?xml";
  const decoded = workerData.integrated && isXml ? validateXmlBytes(bytes, attachment.charset) : await decodeText(bytes, attachment.charset);
  const prefix = decoded.text.trimStart();
  const format = /^\s*(?:<!doctype\s+html|<html\b)/i.test(prefix) || mime === "text/html" || ["htm", "html"].includes(extension) ? "html"
    : /^<\?xml\b/i.test(prefix) || mime === "application/xml" || mime === "text/xml" || extension === "xml" ? "xml"
    : ["{", "["].includes(prefix[0]) || mime === "application/json" || extension === "json" ? "json"
    : mime === "text/csv" || extension === "csv" ? "csv" : "txt";
  return { format, ...decoded };
}

async function extractDocument(format, bytes) {
  if (format === "pdf") {
    const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const base = new URL("./", import.meta.resolve("pdfjs-dist/package.json"));
    const task = getDocument({
      data: Uint8Array.from(bytes), verbosity: 0,
      useSystemFonts: false, disableFontFace: true, useWorkerFetch: false,
      cMapUrl: fileURLToPath(new URL("cmaps/", base)),
      standardFontDataUrl: fileURLToPath(new URL("standard_fonts/", base)),
    });
    try {
      const pdf = await task.promise;
      if (workerData.integrated && pdf.numPages > 100) fail("ATTACHMENT_TEXT_TOO_LARGE");
      let text = "";
      const pageRanges = [];
      for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
        const page = await pdf.getPage(pageNumber);
        const viewport = page.getViewport({ scale: 1 });
        if (workerData.integrated && (viewport.width > 14400 || viewport.height > 14400 || viewport.width * viewport.height > 16_000_000)) fail("ATTACHMENT_TEXT_TOO_LARGE");
        const content = await page.getTextContent();
        let pageText = "";
        for (const item of content.items) if ("str" in item) pageText += item.str + (item.hasEOL ? "\n" : " ");
        const start = text.length;
        text += (workerData.integrated ? checkedText(pageText, false) : pageText) + "\n\n";
        pageRanges.push({ page: pageNumber, start, end: text.length });
        if (text.length > MAX_TEXT) fail("ATTACHMENT_TEXT_TOO_LARGE");
        page.cleanup();
      }
      return { text, pageRanges };
    } finally { await task.destroy(); }
  }
  if (format === "docx") {
    const { default: mammoth } = await import("mammoth");
    return { text: (await mammoth.extractRawText({ buffer: bytes })).value };
  }
  const { default: readExcelFile } = await import("read-excel-file/node");
  const sheets = await readExcelFile(bytes, { trim: false });
  if (workerData.integrated && (sheets.length > 100 || sheets.reduce((sum, s) => sum + s.data.reduce((n, row) => n + row.length, 0), 0) > 100_000))
    fail("ATTACHMENT_TEXT_TOO_LARGE");
  return { text: sheets.map(({ sheet, data }) => sheet + "\n" + data.map((row) => row.map((cell) => cell instanceof Date ? cell.toISOString() : String(cell ?? "")).join("\t")).join("\n")).join("\n\n") };
}

async function readableMarkup(text) {
  const { convert } = await import("html-to-text");
  return convert(text, {
    wordwrap: false,
    selectors: [
      { selector: "img", format: "skip" }, { selector: "script", format: "skip" },
      { selector: "style", format: "skip" }, { selector: "a", options: { ignoreHref: true } },
    ],
  });
}

const results = [];
let totalText = 0;
// Reserve the bounded text budget for in-scope bodies first. An omitted file
// must not consume the budget or prevent a later, smaller file from fitting.
const attachments = workerData.integrated
  ? [...workerData.attachments].sort((a, b) => Number(!!b.body) - Number(!!a.body))
  : workerData.attachments;
for (const attachment of attachments) {
  const result = { id: attachment.id, filename: attachment.filename };
  const bytes = attachment.base64 !== undefined ? Buffer.from(attachment.base64, "base64") : Buffer.from(attachment.bytes);
  try {
    const identified = await identify(attachment, bytes);
    result.format = identified.format;
    if (workerData.integrated && attachment.inspectOnly) { results.push({ status: "inspected", ...result }); continue; }
    if (!(workerData.allowedFormats ?? FORMATS).includes(result.format)) fail("ATTACHMENT_FORMAT_NOT_ALLOWED");
    const needText = workerData.extractAll || workerData.rules.some((r) => r.target === "attachment" && (!r.filename || r.filename === attachment.filename));
    if (needText) {
      try {
        if (TEXT_FORMATS.includes(result.format)) {
          const decoded = identified.text !== undefined ? identified : await decodeText(bytes, attachment.charset);
          result.encoding = decoded.encoding;
          result.text = decoded.text;
          if (workerData.integrated && result.format === "xml") validateXmlBytes(bytes, attachment.charset);
          if (["html", "xml"].includes(result.format)) result.text = await readableMarkup(result.text);
          if (result.format === "json") {
            const parsed = JSON.parse(workerData.integrated ? result.text.replace(/^\uFEFF/, "") : result.text);
            if (!workerData.integrated) result.text = JSON.stringify(parsed, null, 2);
          }
        } else Object.assign(result, await extractDocument(result.format, identified.documentBytes ?? bytes));
        if (workerData.integrated && result.pageRanges && result.text.startsWith("\uFEFF"))
          result.pageRanges = result.pageRanges.map(({ page, start, end }) => ({ page, start: Math.max(0, start - 1), end: end - 1 }));
        result.text = checkedText(result.text);
        if (!result.text.trim() && !(workerData.integrated && (attachment.body || attachment.allowEmpty))) fail("ATTACHMENT_NO_TEXT");
        if (workerData.integrated && result.text.length > 100_000) fail("ATTACHMENT_TEXT_TOO_LARGE");
        if (workerData.integrated && totalText + result.text.length > 100_000) fail("ATTACHMENT_TEXT_TOO_LARGE");
        totalText += result.text.length;
      } catch (error) {
        result.error = error?.name === "PasswordException" ? "ATTACHMENT_ENCRYPTED"
          : /^ATTACHMENT_[A-Z_]+$/.test(error?.message) ? error.message : "ATTACHMENT_TEXT_EXTRACTION_FAILED";
        delete result.text;
      }
    }
  } catch (error) {
    result.formatError = /^ATTACHMENT_[A-Z_]+$/.test(error?.message) ? error.message : "ATTACHMENT_FORMAT_INVALID";
  } finally { bytes.fill(0); }
  results.push(workerData.integrated ? (result.error || result.formatError ? {
    status: "error", id: result.id, filename: result.filename,
    ...(result.format ? { format: result.format } : {}),
    code: result.error ?? result.formatError, stage: result.error ? "text" : "format",
  } : { status: "ok", ...result }) : result);
}
if (workerData.integrated) {
  const order = new Map(workerData.attachments.map((attachment, index) => [attachment.id, index]));
  results.sort((a, b) => order.get(a.id) - order.get(b.id));
}
if (parentPort) parentPort.postMessage(results);
else {
  const output = Buffer.from(JSON.stringify(results));
  writeStdout(output);
}
