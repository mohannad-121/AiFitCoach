import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require(`${process.env.TEMP.replaceAll('\\', '/')}/fitcoach-playwright/node_modules/playwright-core`);

const browser = await chromium.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: true,
});

const results = [];

for (const profile of [
  { name: 'desktop-en', width: 1440, height: 1000, language: 'en', output: 'deliverables/home-editorial-desktop.png' },
  { name: 'mobile-ar', width: 390, height: 844, language: 'ar', output: 'deliverables/home-editorial-mobile.png' },
  { name: 'tablet-light', width: 768, height: 1000, language: 'en', theme:'light', output: 'deliverables/home-editorial-light.png' },
]) {
  const page = await browser.newPage({ viewport: { width: profile.width, height: profile.height }, deviceScaleFactor: 1 });
  const issues = [];
  page.on('console', (message) => {
    if (message.type() === 'error') issues.push(`console: ${message.text()}`);
  });
  page.on('pageerror', (error) => issues.push(`pageerror: ${error.message}`));
  await page.addInitScript((language) => localStorage.setItem('fitcoach_language', language), profile.language);
  await page.addInitScript((theme) => localStorage.setItem('fitcoach_theme', theme), profile.theme || 'dark');
  await page.goto('http://127.0.0.1:8080/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);

  const tabCount = await page.locator('[role="tab"]').count();
  for (let index = 0; index < tabCount; index += 1) {
    const tab = page.locator('[role="tab"]').nth(index);
    await tab.click();
    await page.waitForTimeout(720);
    const selected = await tab.getAttribute('aria-selected');
    if (selected !== 'true') issues.push(`tab ${index} did not activate`);
    await page.locator('.editorial-chapter-panel').screenshot({ path: `deliverables/editorial-${profile.name}-view-${index + 1}.png` });
  }
  await page.locator('[role="tab"]').first().click();
  await page.waitForTimeout(180);

  const fullHeight = await page.evaluate(() => document.documentElement.scrollHeight);
  for (let top = 0; top < fullHeight; top += Math.max(420, Math.floor(profile.height * 0.62))) {
    await page.evaluate((nextTop) => window.scrollTo(0, nextTop), top);
    await page.waitForTimeout(90);
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(220);

  const metrics = await page.evaluate(() => ({
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: document.documentElement.clientWidth,
    documentHeight: document.documentElement.scrollHeight,
    direction: document.documentElement.dir,
    title: document.querySelector('h1')?.textContent?.replace(/\s+/g, ' ').trim(),
    tabs: document.querySelectorAll('[role="tab"]').length,
    selectedTabs: document.querySelectorAll('[role="tab"][aria-selected="true"]').length,
  }));
  if (metrics.documentWidth > metrics.viewportWidth) issues.push(`horizontal overflow ${metrics.documentWidth} > ${metrics.viewportWidth}`);
  await page.screenshot({ path: profile.output, fullPage: true });
  results.push({ profile: profile.name, metrics, issues });
  await page.close();
}

await browser.close();
console.log(JSON.stringify(results, null, 2));
