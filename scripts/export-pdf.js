#!/usr/bin/env node
/**
 * export-pdf.js — Exports ArkoNetwork_InstitutionalDeck.html to PDF
 * Captures each slide as a hi-res screenshot then assembles into a PDF.
 * This produces pixel-perfect output matching the browser visualization.
 *
 * Usage:
 *   node export-pdf.js [output.pdf]
 */

const puppeteer  = require('puppeteer');
const { PDFDocument } = require('pdf-lib');
const path = require('path');
const fs   = require('fs');

const HTML_FILE    = path.resolve(__dirname, '../ArkoSalesV3.html');
const EXPORTS_DIR  = path.resolve(__dirname, '../exports');

// Auto-increment version based on existing files in exports/
function resolveOutFile() {
  if (process.argv[2]) return path.resolve(process.cwd(), process.argv[2]);
  fs.mkdirSync(EXPORTS_DIR, { recursive: true });
  const existing = fs.readdirSync(EXPORTS_DIR)
    .map(f => f.match(/^ArkoSalesDeck_v(\d+)\.pdf$/))
    .filter(Boolean)
    .map(m => parseInt(m[1], 10));
  const next = existing.length ? Math.max(...existing) + 1 : 1;
  return path.join(EXPORTS_DIR, `ArkoSalesDeck_v${next}.pdf`);
}

const OUT_FILE = resolveOutFile();

const SLIDE_W = 1920;
const SLIDE_H = 1080;
const DPR     = 2; // device pixel ratio — 2× for retina-quality output

(async () => {
  if (!fs.existsSync(HTML_FILE)) {
    console.error('HTML file not found:', HTML_FILE);
    process.exit(1);
  }

  console.log('Launching browser…');
  const browser = await puppeteer.launch({ headless: 'new' });
  const page    = await browser.newPage();

  // Set exact slide dimensions + 2× DPR for high-res captures
  await page.setViewport({ width: SLIDE_W, height: SLIDE_H, deviceScaleFactor: DPR });
  await page.emulateMediaType('screen');
  await page.goto('file://' + HTML_FILE, { waitUntil: 'networkidle0' });

  // Wait for web fonts to fully render
  await page.evaluate(() => document.fonts.ready);

  // Hide nav controls; remove deck shadow/border/radius; body background
  // must fill the slide colour so no dark halo appears on light slides.
  await page.addStyleTag({ content: `
    .nav, .key-hint { display: none !important; }
    .deck {
      box-shadow: none !important;
      border: none !important;
      border-radius: 0 !important;
    }
  ` });

  // At 1920×1080 viewport the scaleDeck() function produces scale(1),
  // but let's explicitly reset it so the deck sits flush in the viewport.
  await page.evaluate(() => {
    const deck = document.querySelector('.deck');
    if (deck) deck.style.transform = 'none';
  });

  const slideCount = await page.evaluate(() =>
    document.querySelectorAll('.slide').length
  );
  console.log(`Found ${slideCount} slides.`);

  const pdfDoc = await PDFDocument.create();

  for (let i = 0; i < slideCount; i++) {
    // Make only this slide visible — disable transitions for instant switch
    await page.evaluate((idx) => {
      document.querySelectorAll('.slide').forEach((s, j) => {
        s.style.transition    = 'none';
        s.style.opacity       = j === idx ? '1' : '0';
        s.style.transform     = j === idx ? 'translateX(0)' : 'translateX(30px)';
        s.style.pointerEvents = j === idx ? 'auto' : 'none';
      });
    }, i);

    // One rAF to let the style change flush to the compositor
    await page.evaluate(() => new Promise(r => requestAnimationFrame(r)));

    // Capture the exact viewport — no clip needed since deck fills it
    const png = await page.screenshot({ type: 'png' });

    const img  = await pdfDoc.embedPng(png);
    const slide = pdfDoc.addPage([SLIDE_W, SLIDE_H]);
    slide.drawImage(img, { x: 0, y: 0, width: SLIDE_W, height: SLIDE_H });

    console.log(`  Slide ${i + 1}/${slideCount}`);
  }

  await browser.close();

  const finalBytes = await pdfDoc.save();
  fs.writeFileSync(OUT_FILE, finalBytes);

  const size = (fs.statSync(OUT_FILE).size / 1024 / 1024).toFixed(1);
  console.log(`\nPDF saved → ${OUT_FILE} (${size} MB, ${slideCount} slides)`);
})();
