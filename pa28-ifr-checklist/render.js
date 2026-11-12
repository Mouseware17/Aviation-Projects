// Renders PA28_IFR_Checklist.html to a 5.5 x 8.5 in PDF.
const { chromium } = require('playwright');
const path = require('path');
(async () => {
  const b = await chromium.launch();
  const pg = await b.newPage({ viewport: { width: 528, height: 816 } });
  await pg.goto('file://' + path.join(__dirname, 'PA28_IFR_Checklist.html'), { waitUntil: 'networkidle' });
  await pg.evaluate(() => document.fonts.ready);
  await pg.pdf({ path: path.join(__dirname, 'PA28_IFR_Checklist.pdf'), width: '5.5in', height: '8.5in',
                 printBackground: true, margin: { top: 0, right: 0, bottom: 0, left: 0 } });
  await b.close();
})();
