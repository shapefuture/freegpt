// test-script.js
const puppeteer = require('puppeteer-extra');

(async () => {
  const browser = await puppeteer.launch({
    headless: false, // Set to true if you want to run in headless mode
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  
  const page = await browser.newPage();
  
  // Navigate to a site that uses Cloudflare
  await page.goto('https://example.com', { waitUntil: 'networkidle2' });
  
  // Take a screenshot to verify the page loaded correctly
  await page.screenshot({ path: 'example.png' });
  
  console.log('Screenshot taken, check example.png');
  
  await browser.close();
})();