/**
 * D/I 조합 시나리오 테스트
 *
 * 커버 시나리오:
 *   1. D 단독
 *   2. I 단독 (makeStr 입력)
 *   3. D → I 인접 (D 바로 아래 I)
 *   4. I → D 인접 (I 바로 아래 D)
 *   5. D → D 연속
 *   6. I → I 연속
 *   7. 저장 후 리로드 → 값 유지 확인
 *   8. 편집 초기화 후 원상 복구 확인
 *
 * 사용법: node test-di-scenarios.js
 * 전제: localhost:3000 에서 앱이 실행 중이어야 함
 */

const { chromium } = require('playwright');

const BASE  = 'http://localhost:3000';
const SS    = 'D:/YTS_TOOL/test-ss';
const LOGIN = { id: '2020038', pw: '1234' };
const MAKE_STR_SAMPLE = 'makeStr("X", 4, strYy)';

let ssIdx = 0;
async function ss(page, label) {
  const path = `${SS}/s${String(++ssIdx).padStart(2,'0')}_${label}.png`;
  await page.screenshot({ path, fullPage: false });
  console.log(`  📸 ${path}`);
}

async function login(page) {
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle', timeout: 20000 });
  await page.fill('#username', LOGIN.id);
  await page.fill('#password', LOGIN.pw);
  await page.click('button[type="submit"]');
  await page.waitForURL(url => !url.includes('/login'), { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(1000);
}

async function goMedia(page) {
  await page.goto(`${BASE}/tools/media-layout`, { waitUntil: 'networkidle', timeout: 15000 });
  // 비교 데이터 로딩 완료 대기 (스피너 사라질 때까지)
  await page.waitForFunction(() => {
    const spinner = document.querySelector('.animate-spin');
    return !spinner;
  }, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(1000);
}

/** 현재 레코드의 모든 행 데이터 수집 */
async function getRows(page) {
  return page.$$eval('tbody tr', rows =>
    rows
      .filter(r => !r.querySelector('td[colspan]'))   // SectSep 제외
      .map(r => {
        const cells = r.querySelectorAll('td');
        const dBtn  = r.querySelector('button:first-of-type');
        const iBtn  = r.querySelector('button:nth-of-type(2)');
        return {
          taxCode:    cells[0]?.textContent?.trim() ?? '',
          taxItem:    cells[1]?.querySelector('input')?.value ?? cells[1]?.textContent?.trim() ?? '',
          makeStr:    cells[6]?.querySelector('input')?.value ?? cells[6]?.textContent?.trim() ?? '',
          dActive:    dBtn?.classList?.contains('bg-red-500') ?? false,
          iActive:    iBtn?.classList?.contains('bg-yellow-500') ?? false,
          rowBg:      r.className,
        };
      })
  );
}

/** 저장 버튼 클릭 후 완료 대기 */
async function save(page) {
  const btn = page.locator('button:has-text("저장")').last();
  await btn.click();
  await page.waitForSelector('text=저장 완료', { timeout: 10000 }).catch(() => {});
  // loadCompare는 저장 메시지 표시 후 실행 — 스피너 사라질 때까지 대기
  await page.waitForFunction(
    () => !document.querySelector('td .animate-spin'),
    { timeout: 10000 }
  ).catch(() => {});
  await page.waitForTimeout(300);
}

/** 편집 초기화 */
async function reset(page) {
  const btn = page.locator('button:has-text("편집초기화")');
  if (await btn.count() === 0) { console.log('  ⚠ 편집초기화 버튼 없음'); return; }
  page.once('dialog', d => d.accept());
  await btn.click();
  await page.waitForSelector('text=초기화 완료', { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(1000);
}

/** 특정 행의 D 버튼 클릭 */
async function clickD(page, rowIdx) {
  const rows = await page.$$('tbody tr:not(:has(td[colspan]))');
  const btn  = await rows[rowIdx]?.$('button:first-of-type');
  if (!btn) { console.log(`  ⚠ 행 ${rowIdx}: D 버튼 없음`); return; }
  await btn.click();
  await page.waitForTimeout(200);
}

/** 특정 행의 I 버튼 클릭 */
async function clickI(page, rowIdx) {
  const rows = await page.$$('tbody tr:not(:has(td[colspan]))');
  const btn  = await rows[rowIdx]?.$('button:nth-of-type(2)');
  if (!btn) { console.log(`  ⚠ 행 ${rowIdx}: I 버튼 없음`); return; }
  await btn.click();
  await page.waitForTimeout(200);
}

/** I 행의 makeStr 입력 */
async function fillMakeStr(page, rowIdx, value) {
  const rows   = await page.$$('tbody tr:not(:has(td[colspan]))');
  const input  = await rows[rowIdx]?.$('td:nth-child(7) input[placeholder*="makeStr"]');
  if (!input) { console.log(`  ⚠ 행 ${rowIdx}: makeStr 입력 없음`); return; }
  await input.fill(value);
  await page.waitForTimeout(100);
}

/** 검증 헬퍼 */
function assert(cond, msg) {
  if (cond) { console.log(`  ✅ ${msg}`); }
  else       { console.error(`  ❌ FAIL: ${msg}`); process.exitCode = 1; }
}

// ──────────────────────────────────────────────
// 메인
// ──────────────────────────────────────────────
(async () => {
  const fs = require('fs');
  if (!fs.existsSync(SS)) fs.mkdirSync(SS, { recursive: true });

  const browser = await chromium.launch({ headless: false, slowMo: 200 });
  const page    = await browser.newPage();
  await page.setViewportSize({ width: 1440, height: 900 });

  console.log('\n━━━ 로그인 ━━━');
  await login(page);
  await goMedia(page);
  await ss(page, 'init');

  // 깨끗한 기준값 확보: 편집 내역 있으면 먼저 초기화
  await reset(page);
  await page.waitForTimeout(500);

  const beforeRows = await getRows(page);
  console.log(`\n기준 행 수 (초기화 후): ${beforeRows.length}`);
  if (beforeRows.length < 4) {
    console.error('❌ 테스트에 필요한 행(4+)이 없습니다. HWP/Java 업로드 후 실행하세요.');
    await browser.close(); return;
  }

  // ──────────────────────────────────────────
  console.log('\n━━━ 시나리오 1: D 단독 ━━━');
  // ──────────────────────────────────────────
  await reset(page);
  await page.waitForTimeout(500);
  const r1Before = await getRows(page);

  await clickD(page, 2);               // 3번째 행 D
  const r1After = await getRows(page);
  assert(r1After[2].dActive,           '행[2] D 활성화');
  assert(r1After.length === r1Before.length + 1, 'D 후 행 수 +1 (null 삽입)');
  await ss(page, 'sc1_d_before_save');

  await save(page);
  await page.waitForTimeout(1000);
  const r1Saved = await getRows(page);
  assert(r1Saved.some(r => r.dActive), '저장 후 D 행 존재');
  await ss(page, 'sc1_d_after_save');

  // ──────────────────────────────────────────
  console.log('\n━━━ 시나리오 2: I 단독 (makeStr 입력) ━━━');
  // ──────────────────────────────────────────
  await reset(page);
  await page.waitForTimeout(500);

  await clickI(page, 2);               // 3번째 행 I
  const iRowIdx = (await page.$$('tbody tr:not(:has(td[colspan]))')).findIndex
    ? 2 : 2;                           // I 삽입 위치
  await fillMakeStr(page, 2, MAKE_STR_SAMPLE);
  const r2After = await getRows(page);
  assert(r2After[2].iActive,           '행[2] I 활성화');
  assert(r2After[2].makeStr.includes('makeStr'), 'I 행 makeStr 입력 확인');
  await ss(page, 'sc2_i_before_save');

  await save(page);
  await page.waitForTimeout(1000);
  const r2Saved = await getRows(page);
  const iRow = r2Saved.find(r => r.iActive);
  assert(!!iRow,                        '저장 후 I 행 존재');
  assert(iRow?.makeStr?.includes('makeStr') ?? false, '저장 후 makeStr 보존');
  await ss(page, 'sc2_i_after_save');

  // ──────────────────────────────────────────
  console.log('\n━━━ 시나리오 3: D → I 인접 ━━━');
  // ──────────────────────────────────────────
  await reset(page);
  await page.waitForTimeout(500);

  await clickD(page, 2);               // D 먼저
  // D 후 행 수 +1, 원래 3번째 행이 4번째로 밀림 → 그 행에 I
  await clickI(page, 3);               // D 바로 아래 I
  await fillMakeStr(page, 3, MAKE_STR_SAMPLE);
  const r3After = await getRows(page);
  assert(r3After[2].dActive,           'D→I: 행[2] D 활성');
  assert(r3After[3].iActive,           'D→I: 행[3] I 활성');
  await ss(page, 'sc3_di_before_save');

  await save(page);
  await page.waitForTimeout(1000);
  const r3Saved = await getRows(page);
  assert(r3Saved.some(r => r.dActive), 'D→I: 저장 후 D 행 존재');
  assert(r3Saved.some(r => r.iActive), 'D→I: 저장 후 I 행 존재');
  await ss(page, 'sc3_di_after_save');

  // ──────────────────────────────────────────
  console.log('\n━━━ 시나리오 4: I → D 인접 ━━━');
  // ──────────────────────────────────────────
  await reset(page);
  await page.waitForTimeout(500);

  await clickI(page, 2);               // I 먼저
  await fillMakeStr(page, 2, MAKE_STR_SAMPLE);
  // I 삽입 후 원래 3번째 행(index 3)에 D
  await clickD(page, 3);
  const r4After = await getRows(page);
  assert(r4After[2].iActive,           'I→D: 행[2] I 활성');
  assert(r4After[3].dActive,           'I→D: 행[3] D 활성');
  await ss(page, 'sc4_id_before_save');

  await save(page);
  await page.waitForTimeout(1000);
  const r4Saved = await getRows(page);
  assert(r4Saved.some(r => r.iActive), 'I→D: 저장 후 I 행 존재');
  assert(r4Saved.some(r => r.dActive), 'I→D: 저장 후 D 행 존재');
  await ss(page, 'sc4_id_after_save');

  // ──────────────────────────────────────────
  console.log('\n━━━ 시나리오 5: D → D 연속 ━━━');
  // ──────────────────────────────────────────
  await reset(page);
  await page.waitForTimeout(500);

  await clickD(page, 2);
  await clickD(page, 3);               // 첫 D 아래 또 D
  const r5After = await getRows(page);
  assert(r5After[2].dActive,           'D→D: 행[2] D 활성');
  assert(r5After[3].dActive,           'D→D: 행[3] D 활성');
  await ss(page, 'sc5_dd_before_save');

  await save(page);
  await page.waitForTimeout(1000);
  const r5Saved = await getRows(page);
  const dCount = r5Saved.filter(r => r.dActive).length;
  assert(dCount === 2,                 `D→D: 저장 후 D 행 2개 (실제: ${dCount})`);
  await ss(page, 'sc5_dd_after_save');

  // ──────────────────────────────────────────
  console.log('\n━━━ 시나리오 6: I → I 연속 ━━━');
  // ──────────────────────────────────────────
  await reset(page);
  await page.waitForTimeout(500);

  await clickI(page, 2);
  await fillMakeStr(page, 2, 'makeStr("X", 4, strYy)');
  await clickI(page, 3);               // 첫 I 아래 또 I
  await fillMakeStr(page, 3, 'makeStr("9", 10, iIncome)');
  const r6After = await getRows(page);
  assert(r6After[2].iActive,           'I→I: 행[2] I 활성');
  assert(r6After[3].iActive,           'I→I: 행[3] I 활성');
  await ss(page, 'sc6_ii_before_save');

  await save(page);
  await page.waitForTimeout(1000);
  const r6Saved = await getRows(page);
  const iRows6 = r6Saved.filter(r => r.iActive);
  assert(iRows6.length === 2,          `I→I: 저장 후 I 행 2개 (실제: ${iRows6.length})`);
  assert(iRows6[0]?.makeStr?.includes('strYy'),   'I→I: 첫 I makeStr 보존');
  assert(iRows6[1]?.makeStr?.includes('iIncome'), 'I→I: 두 번째 I makeStr 보존');
  await ss(page, 'sc6_ii_after_save');

  // ──────────────────────────────────────────
  console.log('\n━━━ 시나리오 7: 저장 후 재접속 확인 ━━━');
  // ──────────────────────────────────────────
  // 시나리오 6 상태(I→I)에서 페이지 새로고침 후 값 유지 확인
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  const r7After = await getRows(page);
  const iRows7 = r7After.filter(r => r.iActive);
  assert(iRows7.length === 2,          `재접속 후 I 행 2개 유지 (실제: ${iRows7.length})`);
  assert(iRows7[0]?.makeStr?.includes('strYy')   ?? false, '재접속 후 첫 I makeStr 유지');
  assert(iRows7[1]?.makeStr?.includes('iIncome') ?? false, '재접속 후 두 번째 I makeStr 유지');
  await ss(page, 'sc7_reload');

  // ──────────────────────────────────────────
  console.log('\n━━━ 시나리오 8: 편집 초기화 후 원상 복구 ━━━');
  // ──────────────────────────────────────────
  await reset(page);
  await page.waitForTimeout(500);
  const r8After = await getRows(page);
  const dI8 = r8After.filter(r => r.dActive || r.iActive);
  assert(dI8.length === 0,             `초기화 후 D/I 행 없음 (실제: ${dI8.length})`);
  assert(r8After.length === beforeRows.length, `초기화 후 행 수 원상 복구 (기대: ${beforeRows.length}, 실제: ${r8After.length})`);
  await ss(page, 'sc8_reset');

  // ──────────────────────────────────────────
  console.log('\n━━━ 테스트 완료 ━━━');
  if (process.exitCode === 1) {
    console.error('\n❌ 일부 테스트 실패 — 스크린샷 확인: ' + SS);
  } else {
    console.log('\n✅ 모든 시나리오 통과');
  }

  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
