const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: false, slowMo: 300 });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1440, height: 900 });

  // 로그인
  await page.goto('http://localhost:3000/login', { waitUntil: 'networkidle', timeout: 20000 });
  await page.fill('#username', '2020038');
  await page.fill('#password', '1234');
  await page.click('button[type="submit"]');
  // signIn + router.push 대기
  await page.waitForURL(url => !url.includes('/login'), { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(1500);
  console.log('로그인 후 URL:', page.url());
  await page.screenshot({ path: 'D:/YTS_TOOL/ss1_after_login.png' });

  // 전산매체 비교·검증 페이지 이동
  await page.goto('http://localhost:3000/tools/media-layout', { waitUntil: 'networkidle', timeout: 15000 });
  await page.waitForTimeout(3000);
  await page.screenshot({ path: 'D:/YTS_TOOL/ss2_media.png' });
  console.log('전산매체 페이지 URL:', page.url());

  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
