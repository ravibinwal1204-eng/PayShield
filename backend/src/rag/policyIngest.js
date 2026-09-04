/**
 * policyIngest.js
 *
 * Reads every PDF in knowledge_base/, extracts text PAGE BY PAGE (so page
 * numbers are real and traceable), makes a light attempt to detect a
 * section heading per page (first short line, e.g. "2. Decision Thresholds"),
 * and sends each page's text to the existing C++ VectorDB via
 * POST /doc/insert (vectorDbDocClient.insertPolicyChunk).
 *
 * Chunking and embedding happen inside the C++ server, not here — this
 * script only extracts text and metadata from the PDFs and hands it off.
 *
 * Run with:
 *   cd backend
 *   npm run ingest-policies
 *
 * Requires the C++ VectorDB to be running and VECTORDB_URL set in .env.
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const pdfParse = require('pdf-parse');
const { insertPolicyChunk } = require('../vectordb/vectorDbDocClient');

const KB_DIR = path.join(__dirname, '..', '..', '..', 'knowledge_base');

// Heuristic: a page's first non-empty line is treated as its section
// heading if it's short and looks like "N. Title" or a short title line.
function detectSection(pageText) {
  const firstLine = pageText.split('\n').map((l) => l.trim()).find((l) => l.length > 0);
  if (!firstLine) return '';
  if (firstLine.length <= 80) return firstLine;
  return '';
}

async function extractPages(pdfPath) {
  const buffer = fs.readFileSync(pdfPath);
  const pageTexts = [];

  // pdf-parse's pagerender hook fires once per page, letting us capture
  // page-accurate text instead of one flattened string for the whole file.
  await pdfParse(buffer, {
    pagerender: (pageData) =>
      pageData.getTextContent().then((tc) => {
        const text = tc.items.map((it) => it.str).join(' ');
        pageTexts.push(text);
        return text;
      })
  });

  return pageTexts;
}

async function ingestFile(filename) {
  const fullPath = path.join(KB_DIR, filename);
  console.log(`\n[ingest] ${filename}`);

  const pages = await extractPages(fullPath);
  console.log(`  extracted ${pages.length} page(s)`);

  let totalChunks = 0;
  for (let i = 0; i < pages.length; i++) {
    const pageNum = i + 1;
    const pageText = pages[i].trim();
    if (!pageText) {
      console.log(`  page ${pageNum}: empty, skipping`);
      continue;
    }

    const section = detectSection(pageText);
    const title = `${filename} p.${pageNum}${section ? ` — ${section}` : ''}`;

    const result = await insertPolicyChunk({
      title,
      text: pageText,
      document: filename,
      section,
      page: pageNum
    });

    totalChunks += result.chunks;
    console.log(`  page ${pageNum}: "${section || '(no heading detected)'}" -> ${result.chunks} chunk(s), ids=${result.ids.join(',')}`);
  }

  return totalChunks;
}

async function main() {
  if (!fs.existsSync(KB_DIR)) {
    throw new Error(`knowledge_base directory not found at ${KB_DIR}`);
  }

  const files = fs.readdirSync(KB_DIR).filter((f) => f.toLowerCase().endsWith('.pdf'));
  if (files.length === 0) {
    console.log('No PDF files found in knowledge_base/. Nothing to ingest.');
    return;
  }

  console.log(`Found ${files.length} policy PDF(s) in knowledge_base/: ${files.join(', ')}`);

  let grandTotal = 0;
  for (const file of files) {
    grandTotal += await ingestFile(file);
  }

  console.log(`\nDone. Inserted ${grandTotal} chunk(s) across ${files.length} document(s).`);
}

main().catch((err) => {
  console.error('\n[ingest] FAILED:', err.message);
  console.error('Check that the C++ VectorDB is running and VECTORDB_URL is correct in backend/.env');
  process.exit(1);
});
