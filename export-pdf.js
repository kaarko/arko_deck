#!/usr/bin/env node
/**
 * export-pdf.js — Exports ArkoNetwork_InstitutionalDeck.html to PDF
 * Renders each slide individually (preserving original layout) then merges.
 *
 * Usage:
 *   node export-pdf.js [output.pdf]
 */

const puppeteer  = require('puppeteer');
const { PDFDocument } = require('pdf-lib');
const path = require('path');
const fs   = require('fs');

const HTML_FILE = path.resolve(__dirname, 'ArkoNetwork_InstitutionalDeck.html');
const OUT_FILE  = path.resolve(__dirname, process.argv[2] || 'ArkoNetwork_Deck.pdf');

const SLIDE_W = 1920;
const SLIDE_H = 1080;

(async () => {
  if (!fs.existsSync(HTML_FILE)) {
    console.error('HTML file not found:', HTML_FILE);
    process.exit(1);
  }

  console.log('Launching browser…');
  const browser = await puppeteer.launch({ headless: 'new' });
  const page    = await browser.newPage();

  await page.setViewport({ width: SLIDE_W, height: SLIDE_H });
  await page.emulateMediaType('screen');
  await page.goto('file://' + HTML_FILE, { waitUntil: 'networkidle0' });

  // Hide nav/hint — only change we inject at runtime
  await page.addStyleTag({ content: `
    .nav, .key-hint { display: none !important; }
    .deck { box-shadow: none !important; border: none !important; border-radius: 0 !important; }
  ` });

  const slideCount = await page.evaluate(() =>
    document.querySelectorAll('.slide').length
  );
  console.log(`Found ${slideCount} slides.`);

  const merger = await PDFDocument.create();

  for (let i = 0; i < slideCount; i++) {
    // Show only this slide, keep all others invisible — same layout as normal
    await page.evaluate((idx) => {
      document.querySelectorAll('.slide').forEach((s, j) => {
        s.style.opacity        = j === idx ? '1'            : '0';
        s.style.transform      = j === idx ? 'translateX(0)': 'translateX(30px)';
        s.style.pointerEvents  = j === idx ? 'auto'         : 'none';
      });
    }, i);

    // Wait for any transition to settle
    await new Promise(r => setTimeout(r, 120));

    const pdfBytes = await page.pdf({
      width:  `${SLIDE_W}px`,
      height: `${SLIDE_H}px`,
      printBackground: true,
      margin: { top: 0, right: 0, bottom: 0, left: 0 },
    });

    const slidePdf = await PDFDocument.load(pdfBytes);
    const [slidePage] = await merger.copyPages(slidePdf, [0]);
    merger.addPage(slidePage);

    console.log(`  Slide ${i + 1}/${slideCount}`);
  }

  await browser.close();

  const finalBytes = await merger.save();
  fs.writeFileSync(OUT_FILE, finalBytes);

  const size = (fs.statSync(OUT_FILE).size / 1024).toFixed(0);
  console.log(`\nPDF saved → ${OUT_FILE} (${size} KB)`);
})();
