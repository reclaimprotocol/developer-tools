import sax from "sax";
import iconv from "iconv-lite";

const invalid = () => { throw new Error("ATTACHMENT_FORMAT_INVALID"); };
const unreadable = () => { throw new Error("ATTACHMENT_TEXT_UNREADABLE"); };
const tooLarge = () => { throw new Error("ATTACHMENT_TEXT_TOO_LARGE"); };
const declaration = /^\uFEFF?<\?xml\s+version\s*=\s*(['"])1\.[01]\1(?:\s+encoding\s*=\s*(['"])([A-Za-z][A-Za-z0-9._-]*)\2)?(?:\s+standalone\s*=\s*(['"])(?:yes|no)\4)?\s*\?>/;
function encodingOf(prefix, mimeCharset, final) {
  if (prefix.length < 12 && !final) return;
  const hex = prefix.subarray(0, 4).toString("hex");
  const detected = hex.startsWith("fffe0000") ? "utf-32le" : hex === "0000feff" ? "utf-32be"
    : hex.startsWith("fffe") || hex === "3c003f00" ? "utf-16le"
    : hex.startsWith("feff") || hex === "003c003f" ? "utf-16be"
    : hex.startsWith("efbbbf") ? "utf-8" : undefined;
  const preliminary = iconv.decode(prefix, detected ?? "utf-8", { stripBOM: false });
  const hasDeclaration = /^<\?xml(?:\s|\?>)/.test(preliminary.replace(/^\uFEFF/, ""));
  if (hasDeclaration && !preliminary.includes("?>") && !final) {
    if (prefix.length > 4096) invalid();
    return;
  }
  const match = hasDeclaration ? declaration.exec(preliminary) : undefined;
  if (hasDeclaration && (!match || match[0].length > 4096)) invalid();
  const declared = match?.[3];
  let encoding = detected ?? mimeCharset ?? declared ?? "utf-8";
  const compatible = (name) => {
    const normalized = name.toLowerCase().replace(/[-_]/g, "");
    if (detected && ["utf16", "utf32"].includes(normalized))
      return detected.replace(/-/g, "").startsWith(normalized);
    return iconv.encodingExists(name) && iconv.getCodec(name) === iconv.getCodec(encoding);
  };
  if (!iconv.encodingExists(encoding) || (mimeCharset && !compatible(mimeCharset)) || (declared && !compatible(declared))) unreadable();
  // Generic UTF-16/32 without a BOM or recognizable signature has ambiguous byte order.
  if (!detected && /^(utf[-_]?16|utf[-_]?32)$/i.test(encoding)) unreadable();
  return encoding;
}

/** Streaming SAX guard with explicit decoding and lossless round-trip validation.
 * Declarations are inspected only to choose/validate encoding; all XML structure,
 * namespace resolution, declarations and cell counts come from parser events.
 * @param {{ charset?: string, onOpenTag?: (node: import("sax").QualifiedTag) => void, textChunkSize?: number }} [options]
 */
export function createXmlGuard({ charset, onOpenTag = () => {}, textChunkSize = 4096 } = {}) {
  const parser = sax.parser(true, { xmlns: true, strictEntities: true, trim: false, normalize: false });
  let depth = 0, roots = 0, declarationSeen = false, started = false;
  parser.onerror = invalid;
  parser.ondoctype = invalid;
  parser.onsgmldeclaration = invalid;
  parser.onprocessinginstruction = ({ name }) => {
    if (name.toLowerCase() === "xml") {
      if (name !== "xml" || declarationSeen || started) invalid();
      declarationSeen = true;
    }
  };
  parser.onopentag = (node) => {
    started = true;
    if (++depth > 100) tooLarge();
    if (depth === 1 && ++roots > 1) invalid();
    onOpenTag(node);
  };
  parser.onclosetag = () => { depth--; };
  const original = [], text = [];
  let prefix = Buffer.alloc(0), decoder, encoding, bytes = 0;
  const feed = (value) => {
    if (!value) return;
    text.push(value);
    for (let offset = 0; offset < value.length; offset += textChunkSize)
      parser.write(value.slice(offset, offset + textChunkSize));
  };
  return {
    push(chunk, final = false) {
      bytes += chunk.length;
      if (bytes > 64 * 1024 * 1024) tooLarge();
      original.push(Buffer.from(chunk));
      if (!decoder) {
        prefix = Buffer.concat([prefix, chunk]);
        encoding = encodingOf(prefix, charset, final);
        if (!encoding) return;
        decoder = iconv.getDecoder(encoding, { stripBOM: false });
        feed(decoder.write(prefix));
        prefix = Buffer.alloc(0);
      } else feed(decoder.write(Buffer.from(chunk)));
      if (final) {
        feed(decoder.end());
        parser.close();
        const value = text.join("");
        if (roots !== 1 || value.includes("\ufffd") || !value.isWellFormed() ||
            !iconv.encode(value, encoding).equals(Buffer.concat(original))) unreadable();
        return { text: value, encoding };
      }
    },
  };
}
export function validateXmlBytes(bytes, charset) {
  const guard = createXmlGuard({ charset });
  let result;
  for (let offset = 0; offset < bytes.length; offset += 1024)
    result = guard.push(bytes.subarray(offset, offset + 1024), offset + 1024 >= bytes.length);
  return result ?? guard.push(Buffer.alloc(0), true);
}
