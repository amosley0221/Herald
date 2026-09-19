import { unzipSync } from 'fflate';

/**
 * Reading the text out of a .docx.
 *
 * A .docx is a ZIP archive, which is why this exists: decoding one as UTF-8
 * produces lone surrogates that cannot be put in a JSON request body at all.
 * The text lives in `word/document.xml`, in `<w:t>` elements.
 *
 * This is a deliberately shallow read — paragraphs, tabs and breaks, nothing
 * about styling — because the only consumer is a model being asked what the
 * resume says. Headers, footers and text boxes live in their own parts and are
 * included, since a resume's name and contact details are often in a header.
 */

/** Parts worth reading, in the order their text should appear. */
const BODY = 'word/document.xml';
const EXTRA = /^word\/(header\d*|footer\d*|footnotes|endnotes)\.xml$/;

export function docxToText(bytes: Uint8Array): string {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes);
  } catch (cause) {
    throw new Error(
      `That file is not a readable .docx: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }

  if (!files[BODY]) {
    throw new Error('That .docx has no word/document.xml, so there is no text to read.');
  }

  // The body first, then headers and footers, so the resume reads in its own
  // order rather than the archive's.
  const parts = [BODY, ...Object.keys(files).filter((name) => EXTRA.test(name)).sort()];

  const text = parts
    .map((name) => xmlToText(utf8(files[name] as Uint8Array)))
    .filter((part) => part.trim().length > 0)
    .join('\n\n');

  if (!text.trim()) {
    throw new Error('That .docx appears to contain no text.');
  }
  return text;
}

/**
 * Turns WordprocessingML into plain text.
 *
 * `<w:t>` holds the runs of text; `<w:p>` ends a paragraph; `<w:tab>` and
 * `<w:br>` are the whitespace inside one. Everything else is presentation.
 */
function xmlToText(xml: string): string {
  let out = '';
  // Matches an opening tag, a closing tag, or the text between them.
  const token = /<[^>]+>|[^<]+/g;
  let inText = false;
  let match: RegExpExecArray | null;

  while ((match = token.exec(xml)) !== null) {
    const piece = match[0];

    if (piece.startsWith('<')) {
      const name = /^<\/?([a-zA-Z0-9:]+)/.exec(piece)?.[1] ?? '';
      const closing = piece.startsWith('</');

      if (name === 'w:t') {
        inText = !closing;
      } else if (name === 'w:tab' && !closing) {
        out += '\t';
      } else if (name === 'w:br' || name === 'w:cr') {
        if (!closing) out += '\n';
      } else if (name === 'w:p' && closing) {
        out += '\n';
      }
      continue;
    }

    if (inText) out += decodeEntities(piece);
  }

  // Word writes a paragraph per line, so runs of blank lines are its formatting
  // rather than the author's.
  return out.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

function decodeEntities(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code: string) => String.fromCodePoint(parseInt(code, 16)))
    // Ampersand last, or an escaped entity would be decoded twice.
    .replace(/&amp;/g, '&');
}

/** UTF-8 bytes to a string, without TextDecoder, which older runtimes lack. */
function utf8(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    const byte = bytes[i] as number;
    if (byte < 0x80) {
      out += String.fromCharCode(byte);
    } else if (byte < 0xe0) {
      out += String.fromCharCode(((byte & 0x1f) << 6) | ((bytes[++i] as number) & 0x3f));
    } else if (byte < 0xf0) {
      out += String.fromCharCode(
        ((byte & 0x0f) << 12) | (((bytes[++i] as number) & 0x3f) << 6) | ((bytes[++i] as number) & 0x3f),
      );
    } else {
      const code = ((byte & 0x07) << 18)
        | (((bytes[++i] as number) & 0x3f) << 12)
        | (((bytes[++i] as number) & 0x3f) << 6)
        | ((bytes[++i] as number) & 0x3f);
      const adjusted = code - 0x10000;
      out += String.fromCharCode(0xd800 + (adjusted >> 10), 0xdc00 + (adjusted & 0x3ff));
    }
  }
  return out;
}

/** True when these bytes look like a ZIP, which every .docx is. */
export function looksLikeZip(bytes: Uint8Array): boolean {
  return bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b;
}
