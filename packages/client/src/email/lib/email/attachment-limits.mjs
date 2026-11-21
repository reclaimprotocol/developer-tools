import { readSync, writeSync } from "node:fs";
// Shared by the isolated extraction and preview workers. Sniffed bytes, never
// filenames, determine the limit; MIME metadata cannot enlarge an allowance.
const MiB = 1024 * 1024;
const text = new Set(['txt', 'csv', 'html', 'json', 'xml']);
const images = new Set(['png', 'jpg', 'gif', 'webp']);
export function checkAttachmentBytes(bytes, format) {
  const limit = text.has(format) ? MiB : images.has(format) ? 2 * MiB : 6 * MiB;
  if (bytes.length > limit) throw new Error('ATTACHMENT_TEXT_TOO_LARGE');
}
export function checkImageSize(bytes, format) {
  checkAttachmentBytes(bytes, format);
  const invalid = () => { throw new Error('ATTACHMENT_FORMAT_INVALID'); };
  let width, height;
  if (format === 'png') {
    if (bytes.length < 24 || bytes.toString('ascii', 12, 16) !== 'IHDR') invalid();
    width = bytes.readUInt32BE(16); height = bytes.readUInt32BE(20);
  } else if (format === 'gif') {
    if (bytes.length < 10) invalid();
    width = bytes.readUInt16LE(6); height = bytes.readUInt16LE(8);
  } else if (format === 'jpg') {
    for (let offset = 2; offset + 4 <= bytes.length;) {
      if (bytes[offset++] !== 0xff) invalid();
      while (bytes[offset] === 0xff) offset++;
      const marker = bytes[offset++];
      if (marker === 0xd9 || marker === 0xda) break;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (offset + 2 > bytes.length) invalid();
      const length = bytes.readUInt16BE(offset);
      if (length < 2 || offset + length > bytes.length) invalid();
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
        if (length < 8) invalid();
        height = bytes.readUInt16BE(offset + 3); width = bytes.readUInt16BE(offset + 5); break;
      }
      offset += length;
    }
  } else if (format === 'webp') {
    const type = bytes.toString('ascii', 12, 16);
    if (type === 'VP8X' && bytes.length >= 30) {
      width = 1 + bytes.readUIntLE(24, 3); height = 1 + bytes.readUIntLE(27, 3);
    } else if (type === 'VP8 ' && bytes.length >= 30 && bytes.toString('hex', 23, 26) === '9d012a') {
      width = bytes.readUInt16LE(26) & 0x3fff; height = bytes.readUInt16LE(28) & 0x3fff;
    } else if (type === 'VP8L' && bytes.length >= 25 && bytes[20] === 0x2f) {
      const bits = bytes.readUInt32LE(21); width = 1 + (bits & 0x3fff); height = 1 + ((bits >>> 14) & 0x3fff);
    }
  }
  if (!width || !height) invalid();
  if (width > 8192 || height > 8192 || width * height > 16_000_000) throw new Error('ATTACHMENT_TEXT_TOO_LARGE');
}

// Sniffing OOXML can inflate ZIP metadata. Check actual expansion first in both
// preview and verification, without interpreting unrelated XML in other ZIPs.
export async function checkArchiveSize(bytes) {
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) return;
  const { Unzip, UnzipInflate } = await import('fflate');
  let total = 0, entries = 0, completed = 0;
  const unzip = new Unzip(file => {
    if (++entries > 10_000) throw new Error('ATTACHMENT_TEXT_TOO_LARGE');
    file.ondata = (error, chunk, final) => {
      if (error) throw error;
      total += chunk.length;
      if (total > 64 * 1024 * 1024) { file.terminate(); throw new Error('ATTACHMENT_TEXT_TOO_LARGE'); }
      if (final) completed++;
    };
    file.start();
  });
  unzip.register(UnzipInflate);
  for (let offset = 0; offset < bytes.length; offset += 1024)
    unzip.push(bytes.subarray(offset, offset + 1024), offset + 1024 >= bytes.length);
  if (!entries || entries !== completed) throw new Error('ATTACHMENT_FORMAT_INVALID');
}

// Not in the core: importing file-type with strtok3 10.7 or later (what a
// fresh install of this package resolves) marks the inherited stdio sockets
// non-blocking. Large inputs and outputs then fail with EAGAIN or a partial
// write while the parent is still reading or writing, so retry both.
const pause = () => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);

/** Read the next chunk of the worker's stdin; 0 at end of input. */
export function readStdinChunk(chunk) {
  for (;;) {
    try {
      return readSync(0, chunk, 0, chunk.length, null);
    } catch (error) {
      if (error?.code !== "EAGAIN") throw error;
      pause();
    }
  }
}

/** Write all of `output` (a string or bytes) to the worker's stdout. */
export function writeStdout(output) {
  const bytes = typeof output === "string" ? Buffer.from(output) : output;
  for (let offset = 0; offset < bytes.length;) {
    try {
      offset += writeSync(1, bytes, offset, bytes.length - offset);
    } catch (error) {
      if (error?.code !== "EAGAIN") throw error;
      pause();
    }
  }
}
