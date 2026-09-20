import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { deflateRawSync } from 'node:zlib';
import { docxToText, looksLikeZip } from '../dist/index.js';

/**
 * A .docx is a ZIP, and reading one as UTF-8 text produces lone surrogates that
 * cannot go in a JSON request body at all — the API rejects it before it ever
 * sees the resume. That is what these are here to stop happening again.
 */

/** Builds a real .docx in memory: a ZIP with the parts Word writes. */
function buildDocx(parts: Record<string, string>): Uint8Array {
  const files = Object.entries(parts).map(([name, content]) => {
    const data = Buffer.from(content, 'utf8');
    return { name: Buffer.from(name, 'utf8'), data, deflated: deflateRawSync(data) };
  });

  const crcTable = Array.from({ length: 256 }, (_unused, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc32 = (buffer: Buffer): number => {
    let c = 0xffffffff;
    for (const byte of buffer) c = (crcTable[(c ^ byte) & 0xff] as number) ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };

  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;

  for (const file of files) {
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0, 6);
    header.writeUInt16LE(8, 8); // deflate
    header.writeUInt32LE(crc32(file.data), 14);
    header.writeUInt32LE(file.deflated.length, 18);
    header.writeUInt32LE(file.data.length, 22);
    header.writeUInt16LE(file.name.length, 26);
    const local = Buffer.concat([header, file.name, file.deflated]);
    locals.push(local);

    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(8, 10);
    entry.writeUInt32LE(crc32(file.data), 16);
    entry.writeUInt32LE(file.deflated.length, 20);
    entry.writeUInt32LE(file.data.length, 24);
    entry.writeUInt16LE(file.name.length, 28);
    entry.writeUInt32LE(offset, 42);
    central.push(Buffer.concat([entry, file.name]));
    offset += local.length;
  }

  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);

  return new Uint8Array(Buffer.concat([...locals, directory, end]));
}

const paragraph = (text: string): string =>
  `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;

const document = (body: string): string =>
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
  + '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
  + `<w:body>${body}</w:body></w:document>`;

test('reads the text out of a .docx', () => {
  const docx = buildDocx({
    'word/document.xml': document(
      [paragraph('Ada Lovelace'), paragraph('Senior Product Designer'), paragraph('Charlotte, NC')].join(''),
    ),
  });
  const text = docxToText(docx);
  assert.match(text, /Ada Lovelace/);
  assert.match(text, /Senior Product Designer/);
  assert.match(text, /Charlotte, NC/);
});

test('keeps accents, other scripts and emoji intact', () => {
  // Getting this wrong is how a resume reaches the model as mojibake.
  const docx = buildDocx({
    'word/document.xml': document(
      [paragraph('Café résumé'), paragraph('中文测试'), paragraph('👋 emoji')].join(''),
    ),
  });
  const text = docxToText(docx);
  assert.match(text, /Café résumé/);
  assert.match(text, /中文测试/);
  assert.match(text, /👋 emoji/);
});

test('decodes XML entities rather than showing them', () => {
  const docx = buildDocx({
    'word/document.xml': document(paragraph('R&amp;D &lt;lead&gt; &#233;quipe &quot;x&quot;')),
  });
  assert.equal(docxToText(docx), 'R&D <lead> équipe "x"');
});

test('includes headers, where a resume often keeps its contact details', () => {
  const docx = buildDocx({
    'word/document.xml': document(paragraph('Experience')),
    'word/header1.xml':
      '<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
      + paragraph('ada@example.com') + '</w:hdr>',
  });
  const text = docxToText(docx);
  assert.match(text, /Experience/);
  assert.match(text, /ada@example\.com/, 'a header-only email must not be lost');
});

test('tabs and line breaks survive as whitespace', () => {
  const docx = buildDocx({
    'word/document.xml': document(
      '<w:p><w:r><w:t>A</w:t><w:tab/><w:t>B</w:t><w:br/><w:t>C</w:t></w:r></w:p>',
    ),
  });
  assert.equal(docxToText(docx), 'A\tB\nC');
});

test('the extracted text is always valid JSON payload', () => {
  // The original bug: lone surrogates from decoding ZIP bytes as UTF-8 made the
  // request body invalid, and the API rejected it with a 400 naming a column.
  const docx = buildDocx({
    'word/document.xml': document([paragraph('Café'), paragraph('👋')].join('')),
  });
  const text = docxToText(docx);
  assert.doesNotThrow(() => JSON.stringify({ text }));
  assert.ok(
    !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(text),
    'no lone surrogates may survive extraction',
  );
});

test('says so plainly when the file is not a readable .docx', () => {
  assert.throws(() => docxToText(new Uint8Array([1, 2, 3, 4])), /not a readable \.docx/);
  // A valid ZIP that simply is not a Word document.
  const notWord = buildDocx({ 'hello.txt': 'hi' });
  assert.throws(() => docxToText(notWord), /no word\/document\.xml/);
  // A Word document with no text in it.
  const empty = buildDocx({ 'word/document.xml': document('') });
  assert.throws(() => docxToText(empty), /no text/);
});

test('looksLikeZip recognises a docx by content, not by name', () => {
  assert.equal(looksLikeZip(buildDocx({ 'word/document.xml': document(paragraph('x')) })), true);
  assert.equal(looksLikeZip(new Uint8Array([0x25, 0x50, 0x44, 0x46])), false, 'a PDF is not a zip');
  assert.equal(looksLikeZip(new Uint8Array([])), false);
});
