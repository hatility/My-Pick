// 화면 자동 시험: 도커(또는 개발 서버)를 켠 뒤 npm run e2e  (주소는 뒤에, 예: npm run e2e -- http://localhost:5200)
// 관리자 · 큰 화면 · PC 참여자 · 휴대폰 참여자 · 태블릿을 따로따로 열어 처음부터 끝까지 눌러 보고,
// 화면 사진을 ../docs/스크린샷 에 남겨요. 시험용 방과 로고는 끝나면 지워요.
// (설치된 Chrome 을 써요. 관리자 아이디 · 비밀번호는 .env 에서 읽어요.)
import { chromium } from 'playwright-core'
import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'

const base = process.argv[2] || 'http://localhost:8082'
const shots = '../docs/스크린샷'
mkdirSync(shots, { recursive: true })
const { ADMIN_ID = 'admin', ADMIN_PASSWORD } = process.env
assert.ok(ADMIN_PASSWORD, '.env 에 ADMIN_PASSWORD 가 있어야 해요')

const startedAt = Date.now()
const b = await chromium.launch({ channel: 'chrome' })
const problems = []
async function open(name, options) {
  const ctx = await b.newContext({ locale: 'ko-KR', ...options })
  // 화면 안 확인 창(dialog.ask)은 ‘확인’을 눌러 줘요 (예전에 브라우저 기본 창을 받아 주던 것과 같게)
  await ctx.addInitScript(() => {
    new MutationObserver(() => document.querySelector('dialog.ask[open] .ask-ok')?.click()).observe(document, { childList: true, subtree: true })
  })
  const page = await ctx.newPage()
  page.on('console', (m) => m.type() === 'error' && problems.push(`${name}: ${m.text()}`))
  page.on('pageerror', (e) => problems.push(`${name}: ${e.message}`))
  page.on('dialog', (d) => d.accept())
  return page
}
const shot = async (page, name) => {
  await page.waitForTimeout(400)
  // 옆으로 넘치는 화면이 없는지도 같이 봐요
  const over = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)
  if (over > 1) problems.push(`${name}: 화면이 옆으로 ${over}px 넘쳐요`)
  await page.screenshot({ path: `${shots}/${name}.png` })
}
// 선택지 한 줄을 눌러요 (줄 전체가 누르는 곳이에요)
// 방 화면의 진행 · 준비 · 설정 탭
const tab = (page, name) => page.locator('.room-tabs').getByRole('button', { name, exact: true }).click()
const pick = (page, label) => page.locator('.row', { hasText: label }).locator('input').check()
let n = 0

/** 선택지 칸을 하나씩 채워요 (칸이 모자라면 ‘선택지 더하기’) */
async function fillOptions(page, list) {
  for (let i = 0; i < list.length; i++) {
    if (i >= (await page.locator('.opt-row').count())) await page.getByRole('button', { name: '선택지 더하기' }).click()
    await page.getByLabel(`선택지 ${i + 1}`, { exact: true }).fill(list[i])
  }
}
const ok = (t) => console.log(`  ✓ ${++n}. ${t}`)

try {
  // ── 관리자: 로그인 → 로고 → 방 · 주제 만들기 ──
  const admin = await open('관리자', { viewport: { width: 1280, height: 860 } })
  await admin.goto(`${base}/admin`)
  await admin.getByLabel('아이디').fill(ADMIN_ID)
  await admin.getByLabel('비밀번호').fill(ADMIN_PASSWORD)
  await admin.getByRole('button', { name: '로그인' }).click()
  await admin.getByRole('heading', { name: '한눈에 보기' }).waitFor()
  await admin.getByText('서버 상태').waitFor()
  await shot(admin, 'admin-home-1280')
  // 앞선 시험이 중간에 멈췄다면 남아 있을 시험용 관리자를 먼저 치워요
  const X = { headers: { 'X-Requested-With': 'mypick' } }
  for (const a of (await (await admin.request.get(`${base}/api/admin/admins`)).json()).admins) if (a.name === 'teacher1') await admin.request.delete(`${base}/api/admin/admins/${a.id}`, X)
  ok('관리자 로그인')

  await admin.getByRole('button', { name: '설정', exact: true }).click()
  const logo = await (await open('로고', { viewport: { width: 320, height: 120 } })).screenshot({ type: 'png' }) // 아무 그림이나 한 장
  await admin.locator('input[type=file]').setInputFiles({ name: '우리학교.png', mimeType: 'image/png', buffer: logo })
  await admin.getByAltText('지금 로고').waitFor()
  await shot(admin, 'admin-org-1280')
  ok('기관 로고 올리기')

  await admin.getByRole('button', { name: '방 목록', exact: true }).click()
  await admin.getByRole('button', { name: '새 방 만들기' }).click()
  await admin.getByLabel('방 이름').fill('가을 축제 준비')
  await admin.getByRole('textbox', { name: /방 비밀번호/ }).fill('1234')
  await admin.getByLabel(/끊긴 사람을 기다리는 시간/).fill('3')
  await shot(admin, 'admin-new-room-1280')
  await admin.getByRole('button', { name: '방 만들기' }).click()
  await admin.locator('.fact-code').waitFor()
  const code = (await admin.locator('.fact-code').innerText()).trim()
  assert.match(code, /^\d{6}$/)

  const addItem = async (title, options, pick) => {
    await admin.getByRole('button', { name: '주제 더하기' }).first().click()
    if (typeof options === 'string') await admin.getByRole('button', { name: options, exact: true }).click() // 빠른 틀
    await admin.getByLabel('주제 제목').fill(title)
    if (typeof options !== 'string') await fillOptions(admin, options)
    if (pick) await admin.getByLabel('한 사람이 고를 수 있는 개수').fill(String(pick))
    await admin.locator('form.form-inset').getByRole('button', { name: '주제 더하기' }).click()
    await admin.getByRole('heading', { name: title }).waitFor()
  }
  await addItem('축제 주제를 골라 주세요', ['우주 여행', '레트로 게임', '숲속 캠핑'])
  await addItem('축제 부스를 두 개 골라 주세요', ['먹거리', '게임', '사진관', '공연'], 2)
  await addItem('회칙을 바꿀까요?', '찬성 / 반대 (절반을 넘으면 통과)')
  await admin.getByText('‘찬성’ 절반을 넘으면 통과').waitFor()
  await shot(admin, 'admin-room-1280')
  await tab(admin, '준비')
  await admin.getByText('주제 묶음 (자주 쓰는 주제 저장 · 불러오기)').click()
  await admin.getByLabel('묶음 이름').fill('축제 준비 회의')
  await admin.getByRole('button', { name: '지금 주제 3개를 묶음으로 저장' }).click()
  await admin.getByText('묶음에 주제 3개를 저장했어요').waitFor()
  await tab(admin, '진행')
  ok(`방(${code})과 주제 세 개 만들기 (빠른 틀 포함), 주제 묶음으로 저장`)

  // ── 리허설: 똑같은 연습 방에서 가짜 참여자 10명과 한 바퀴 ──
  await tab(admin, '준비')
  await admin.getByRole('button', { name: '리허설 해 보기' }).click()
  await admin.getByRole('heading', { name: '가을 축제 준비 (리허설)' }).waitFor()
  await admin.getByText('10명').first().waitFor()
  await admin.getByRole('button', { name: '다음 주제 열기' }).click()
  await admin.getByText('모두 픽함').first().waitFor({ timeout: 20000 })
  await shot(admin, 'admin-rehearsal-1280')
  await admin.getByRole('button', { name: '리허설 끝내고 원래 방으로' }).click()
  await admin.getByRole('heading', { name: '가을 축제 준비', exact: true }).waitFor()
  assert.equal(await admin.locator('.item-draft').count(), 3)
  ok('리허설: 가짜 참여자 10명이 알아서 고르고, 끝내면 원래 방으로')

  // ── 큰 화면 ──
  const screen = await open('큰 화면', { viewport: { width: 1920, height: 1080 } })
  await screen.goto(base + (await admin.getByRole('link', { name: '큰 화면 열기' }).getAttribute('href')))
  await screen.getByText('곧 My Pick 을 시작해요').waitFor()
  await shot(screen, 'screen-wait-1920')
  await admin.locator('.screen-ctl > summary').click() // 접혀 있는 ‘큰 화면에 띄울 것’을 펼쳐요
  await admin.getByLabel('공지로 띄울 글').fill('10분 뒤에 시작해요')
  await admin.getByRole('button', { name: '공지', exact: true }).click()
  await screen.getByRole('heading', { name: '10분 뒤에 시작해요' }).waitFor()
  await shot(screen, 'screen-notice-1920')
  await admin.getByRole('button', { name: '자동', exact: true }).click()
  await screen.getByText('곧 My Pick 을 시작해요').waitFor()
  ok('큰 화면: 들어오는 방법 (주소 · 방 번호 · QR), 진행자가 공지를 띄웠다 내려요')

  // ── 참여자: PC ──
  const pc = await open('PC', { viewport: { width: 1280, height: 860 } })
  await pc.goto(base)
  await pc.getByRole('link', { name: '방 만들기' }).waitFor()
  await shot(pc, 'home-1280')
  await pc.screenshot({ path: `${shots}/home-full-1280.png`, fullPage: true })
  await pc.goto(`${base}/?room=${code}`)
  assert.equal(new URL(pc.url()).pathname, '/')
  await pc.getByText('가을 축제 준비').waitFor() // 방 번호가 주소에 있으면 바로 다음 단계
  await shot(pc, 'join-1280')
  await pc.getByLabel('방 비밀번호').fill('0000')
  await pc.getByRole('button', { name: '들어가기' }).click()
  await pc.getByRole('alert').waitFor()
  await pc.getByLabel('방 비밀번호').fill('1234')
  await pc.getByRole('button', { name: '들어가기' }).click()
  await pc.getByText('다음 주제를 기다리고 있어요').waitFor()
  ok('PC: 틀린 비밀번호는 막히고, 맞으면 들어가요')

  // ── 참여자: 휴대폰 (/ 로 가도 /m 으로 넘어가요) ──
  const phone = await open('휴대폰', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 })
  await phone.goto(base)
  await phone.waitForURL(/\/m$/)
  await shot(phone, 'm-home-390')
  await phone.getByLabel('방 번호').fill(code)
  await phone.getByRole('button', { name: '다음' }).click()
  await phone.getByLabel('방 비밀번호').waitFor()
  await shot(phone, 'm-join-390')
  await phone.getByLabel('방 비밀번호').fill('1234')
  await phone.getByRole('button', { name: '들어가기' }).click()
  await phone.getByText('다음 주제를 기다리고 있어요').waitFor()
  await phone.getByText('주제 3개 중').waitFor() // 어디까지 왔는지와 다음 주제
  await phone.getByText('다음은').waitFor()
  await shot(phone, 'm-wait-390')
  await phone.getByRole('button', { name: '한 손 모드' }).click()
  await phone.locator('.m[data-reach]').waitFor()
  ok('휴대폰: / 로 들어와도 /m 으로, 방 번호 → 필요한 것만 묻기')

  // ── 참여자: 태블릿 ──
  const tablet = await open('태블릿', { viewport: { width: 820, height: 1180 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 })
  await tablet.goto(`${base}/?room=${code}`)
  await tablet.waitForURL(/\/m\?room=/)
  await tablet.getByLabel('방 비밀번호').fill('1234')
  await tablet.getByRole('button', { name: '들어가기' }).click()
  await tablet.getByText('다음 주제를 기다리고 있어요').waitFor()
  ok('태블릿도 /m 으로')

  // ── 방 꾸미기: 색 ──
  await tab(admin, '설정')
  await admin.getByText('방 꾸미기 (로고 · 색)').click()
  await admin.getByText('초록', { exact: true }).click()
  await pc.locator('.pc[data-tone="green"]').waitFor()
  await tab(admin, '진행')
  ok('방마다 색: 고르면 참여자 화면에 바로 입혀져요')

  // ── 지켜보기 화면 ──
  await tab(admin, '준비')
  await admin.getByRole('button', { name: '지켜보기 주소' }).click()
  const watchLink = (await admin.locator('.watch-link').innerText()).trim()
  await tab(admin, '진행')
  const watcher = await open('지켜보는 사람', { viewport: { width: 1280, height: 860 } })
  await watcher.goto(watchLink)
  await watcher.getByText('지켜보기 화면').waitFor()
  await watcher.getByRole('heading', { name: '이 방에서 진행자가 한 일' }).waitFor()
  assert.equal(await watcher.locator('main button').count(), 0) // 진행을 바꿀 버튼이 없어요 (밝기 · 전체 화면만 있어요)
  ok('지켜보는 사람: 주소를 받은 사람은 지켜보기만 해요')

  // ── 예약 열기 ──
  const soon = new Date(Date.now() + 30 * 60_000)
  const local = `${soon.getFullYear()}-${String(soon.getMonth() + 1).padStart(2, '0')}-${String(soon.getDate()).padStart(2, '0')}T${String(soon.getHours()).padStart(2, '0')}:${String(soon.getMinutes()).padStart(2, '0')}`
  await admin.locator('.item-draft').last().getByText('예약 (저절로 열고 마감하기)').click()
  await admin.locator('.item-draft').last().getByLabel('예약 열기').fill(local)
  await admin.locator('.item-draft').last().getByRole('button', { name: '예약하기' }).click()
  await admin.getByText('에 저절로 열려요.').waitFor()
  await phone.getByText(/다음 주제는 .*에 열려요/).waitFor()
  await shot(phone, 'm-wait-scheduled-390')
  await admin.getByRole('button', { name: '예약 취소' }).click()
  await phone.getByText(/다음 주제는 .*에 열려요/).waitFor({ state: 'detached' })
  ok('예약 열기: 정한 때가 기다리는 사람에게 보이고, 취소할 수 있어요')

  await admin.getByText('3명').first().waitFor() // 들어온 사람 수가 관리자 화면에 바로 반영돼요
  await admin.getByRole('button', { name: '입장 마감' }).click()
  await admin.getByRole('button', { name: '입장 다시 열기' }).waitFor()
  ok('관리자: 들어온 사람 3명 확인 → 입장 마감')

  // ── 1번 주제 ──
  await admin.getByRole('button', { name: '픽 열기' }).first().click()
  await phone.getByRole('heading', { name: '축제 주제를 골라 주세요' }).waitFor()
  await pick(phone, '레트로 게임')
  await shot(phone, 'm-ballot-390')
  await phone.getByRole('button', { name: '픽하기' }).click()
  await phone.getByText('‘레트로 게임’ 고를까요?').waitFor()
  await shot(phone, 'm-confirm-390')
  await phone.getByRole('button', { name: '픽 확정' }).click()
  await phone.getByRole('heading', { name: '픽했어요' }).waitFor()
  await shot(phone, 'm-done-390')
  ok('휴대폰: 고르기 → 한 번 더 확인 → 픽 확정')

  await phone.reload()
  await phone.getByRole('heading', { name: '픽했어요' }).waitFor()
  assert.equal(await phone.getByRole('button', { name: '픽하기' }).count(), 0)
  ok('새로고침해도 세션이 남고, 다시 픽할 수 없어요')

  await pick(pc, '레트로 게임')
  await shot(pc, 'ballot-1280')
  await pick(tablet, '우주 여행')
  await shot(tablet, 'm-ballot-820')
  await screen.getByText('1 / 3명 픽함').waitFor()
  await screen.getByText('3명 접속').waitFor() // 새로고침한 사람도 빠짐없이 세요
  await shot(screen, 'screen-vote-1920')
  await shot(admin, 'admin-live-1280')
  assert.equal(await screen.locator('.res').count(), 0)
  assert.equal(await admin.locator('.item-open .res').count(), 0)
  ok('픽 받는 중에는 큰 화면 · 관리자 화면에 받은 픽이 나오지 않아요')

  await pc.getByRole('button', { name: '픽하기' }).click()
  await pc.getByRole('button', { name: '픽 확정' }).click()
  await tablet.getByRole('button', { name: '픽하기' }).click()
  await tablet.getByRole('button', { name: '픽 확정' }).click()
  await screen.getByText('1번째 주제 결과').waitFor({ timeout: 8000 })
  await screen.getByText('모두 픽함').waitFor()
  await shot(screen, 'screen-result-1920')
  await pc.getByText('모두 픽함').first().waitFor()
  await shot(pc, 'result-1280')
  await shot(phone, 'm-result-390')
  await phone.locator('summary', { hasText: '확인 요청하기' }).click()
  await phone.getByLabel('확인할 내용').fill('한 번 더 확인해 주세요')
  await phone.getByRole('button', { name: '확인 요청 보내기' }).click()
  await phone.getByText('이 주제에 확인 요청을 보냈어요').waitFor()
  await admin.getByText('확인 요청 1건').first().waitFor()
  await watcher.getByText('확인 요청 1건이 들어왔어요').waitFor()
  await shot(watcher, 'observe-1280')
  ok('모두 픽하면 바로 마감되고 결과가 한꺼번에 나와요. 마감 뒤 확인 요청을 익명으로 남겨요')

  // ── 2번 주제: 여러 개 고르기 · 건너뜀 · 접속이 끊긴 사람 ──
  await admin.getByRole('button', { name: '픽 열기' }).first().click()
  await pick(pc, '먹거리')
  await pick(pc, '공연')
  assert.ok(await pc.getByRole('checkbox', { name: '게임' }).isDisabled())
  await pc.getByRole('button', { name: '픽하기' }).click()
  await pc.getByRole('button', { name: '픽 확정' }).click()
  await phone.getByRole('heading', { name: '축제 부스를 두 개 골라 주세요' }).waitFor()
  await phone.getByRole('button', { name: '건너뛰기' }).click()
  await phone.getByRole('button', { name: '건너뛰기 확정' }).click()
  await tablet.context().close() // 태블릿은 픽하지 않고 접속이 끊김 → 3초 기다린 뒤 자동 마감
  await screen.getByText('2번째 주제 결과').waitFor({ timeout: 10000 })
  await pc.getByText('그중 건너뜀 1명').first().waitFor()
  await shot(admin, 'admin-closed-1280')
  ok('여러 개 고르기 · 건너뜀 · 끊긴 사람은 몇 초 뒤 빼고 자동 마감')

  // ── 3번 주제: 통과 통과 여부 · 시간 연장 · 어두운 화면 ──
  await admin.locator('.item-draft .memo summary').last().click() // 접혀 있는 메모 칸을 펼쳐요
  await admin.getByLabel('진행자 메모').last().fill('반대 의견 먼저 듣기')
  await admin.getByLabel('진행자 메모').last().blur()
  await admin.getByText('메모를 저장했어요').waitFor()
  const remote = await admin.context().newPage() // 진행자의 휴대폰 리모컨 (같은 로그인)
  remote.on('dialog', (d) => d.accept())
  await remote.setViewportSize({ width: 390, height: 844 })
  await remote.goto(base + (await admin.getByRole('link', { name: '휴대폰 리모컨' }).getAttribute('href')))
  await remote.getByText('다음 주제', { exact: true }).waitFor()
  await shot(remote, 'remote-390')
  await remote.getByRole('button', { name: '다음 주제 열기' }).click()
  await phone.getByRole('heading', { name: '회칙을 바꿀까요?' }).waitFor()
  await remote.getByRole('button', { name: '안 한 사람에게 알리기' }).click()
  await phone.getByText('진행자가 알려요.').waitFor()
  assert.equal(await phone.getByText('반대 의견 먼저 듣기').count(), 0) // 메모는 참여자에게 안 보여요
  await admin.getByRole('button', { name: '30초 더' }).click()
  await admin.locator('.item-open .time-num').filter({ hasText: /^1:[12]\d$/ }).waitFor() // 60초 → 90초
  await phone.getByRole('heading', { name: '회칙을 바꿀까요?' }).waitFor()
  await phone.evaluate(() => (document.documentElement.dataset.theme = 'dark'))
  await pick(phone, '찬성')
  await shot(phone, 'm-ballot-dark-390')
  for (const p of [phone, pc]) {
    if (p === pc) await pick(pc, '찬성')
    await p.getByRole('button', { name: '픽하기' }).click()
    await p.getByRole('button', { name: '픽 확정' }).click()
  }
  await screen.getByText('통과', { exact: true }).waitFor({ timeout: 10000 })
  await shot(screen, 'screen-verdict-1920')
  await pc.getByText('통과', { exact: true }).first().waitFor()
  ok('시간 30초 늘리기, 절반 넘게 찬성이면 ‘통과’가 모든 화면에 나와요')

  // ── 결과 내려받기 · 인쇄 모양 ──
  await admin.locator('.menu > summary').click() // 내려받기 · 인쇄 · 결과 정리 인쇄가 여기 모여 있어요
  assert.match(await admin.getByRole('link', { name: '결과 내려받기' }).getAttribute('href'), /^\/api\/admin\/rooms\/\d+\/results\.csv$/)
  await admin.emulateMedia({ media: 'print' })
  await admin.evaluate(() => (document.body.dataset.print = 'results'))
  assert.equal(await admin.getByRole('button', { name: '방 지우기' }).isVisible(), false)
  await admin.screenshot({ path: `${shots}/print-results.png`, fullPage: true })
  await admin.evaluate(() => (document.body.dataset.print = 'minutes'))
  await admin.getByRole('heading', { name: '가을 축제 준비 My Pick 결과 정리' }).waitFor()
  assert.equal(await admin.getByRole('link', { name: '큰 화면 열기' }).isVisible(), false)
  const proof = (await admin.locator('.minutes').getByText(/결과 확인 코드: [A-Z2-9]{4}-/).first().innerText()).split(': ')[1].trim()
  await admin.screenshot({ path: `${shots}/print-minutes.png`, fullPage: true })
  await admin.emulateMedia({ media: 'screen' })
  ok('결과 내려받기 주소 · 인쇄하면 버튼 없이 결과만 · 결과 정리 인쇄')

  // ── 결과 확인 코드 ──
  await screen.getByText(/결과 확인 코드/).first().waitFor()
  const checker = await open('결과 확인', { viewport: { width: 1280, height: 860 } })
  await checker.goto(`${base}/verify`)
  await checker.getByLabel(/결과 확인 코드/).fill(proof)
  await checker.getByRole('button', { name: '확인하기' }).click()
  await checker.getByText('마감했을 때의 결과 그대로예요.').waitFor()
  await checker.screenshot({ path: `${shots}/verify-1280.png`, fullPage: true })
  // 이 기기가 마감 때 본 코드와 달라지면 경고 (기억해 둔 코드를 일부러 바꿔 놓고 다시 열어 봐요)
  await pc.evaluate(() => {
    for (const k of Object.keys(localStorage)) if (k.startsWith('mypick-proof-')) localStorage.setItem(k, 'AAAA-BBBB-CCCC')
  })
  await pc.reload()
  await pc.getByText('이 기기가 마감 때 본 코드(AAAA-BBBB-CCCC)와 달라요.').first().waitFor()
  await pc.evaluate(() => localStorage.clear())
  // 멀쩡한 결과에는 경고가 없어야 해요 (큰 화면은 같은 자리에 주제가 바뀌어 나와요)
  assert.equal(await screen.getByText('이 기기가 마감 때 본 코드').count(), 0)
  assert.equal(await phone.getByText('이 기기가 마감 때 본 코드').count(), 0)
  ok('결과 확인 코드: 결과 정리의 코드로 누구나 확인, 기기가 기억한 코드와 달라지면 경고')

  // ── 엄격 방식: 입장 코드 인쇄 모양 ──
  await admin.getByRole('button', { name: '방 목록', exact: true }).click()
  await admin.getByRole('button', { name: '새 방 만들기' }).click()
  await admin.getByLabel('방 이름').fill('운영진 뽑기 (코드)')
  await admin.getByRole('radio', { name: /엄격/ }).check()
  await admin.getByRole('button', { name: '방 만들기' }).click()
  await tab(admin, '준비')
  await admin.getByText('주제 묶음 (자주 쓰는 주제 저장 · 불러오기)').click()
  await admin.getByRole('button', { name: '불러오기' }).click()
  await admin.getByText('묶음의 주제 3개를 더했어요').waitFor()
  assert.equal(await admin.locator('.items > li').count(), 3)
  await admin.getByRole('button', { name: '코드 만들기' }).click()
  await admin.locator('.codes li').nth(9).waitFor()
  assert.equal(await admin.locator('.codes .qr').count(), 10)
  // QR 주소로 들어오면 방 번호 · 코드를 치지 않고 바로 입장
  const first = (await admin.locator('.codes strong').first().innerText()).replace('-', '')
  const scanned = await open('QR 로 입장', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  await scanned.goto(`${base}/?room=${(await admin.locator('.fact-code').innerText()).trim()}&code=${first}`)
  await scanned.getByText('다음 주제를 기다리고 있어요').waitFor()
  assert.equal(new URL(scanned.url()).search, '')
  await admin.emulateMedia({ media: 'print' })
  await admin.evaluate(() => (document.body.dataset.print = 'codes'))
  assert.equal(await admin.getByRole('heading', { name: '운영진 뽑기 (코드)' }).isVisible(), false)
  await admin.screenshot({ path: `${shots}/print-codes.png`, fullPage: true })
  await admin.emulateMedia({ media: 'screen' })
  await tab(admin, '설정')
  await admin.getByRole('button', { name: '방 지우기' }).click()
  await admin.getByRole('heading', { name: '모든 방' }).waitFor()
  ok('묶음 불러오기 · 입장 코드 10개에 QR · QR 주소로 바로 입장 · 인쇄하면 코드만')

  // ── 어두운 화면 (기기가 어두운 화면이면 그대로 따라가요) ──
  const night = await open('어두운 화면', { viewport: { width: 1280, height: 860 }, colorScheme: 'dark' })
  await night.goto(base)
  await night.getByRole('button', { name: '밝은 화면으로 바꾸기' }).waitFor()
  await shot(night, 'home-dark-1280')
  await night.screenshot({ path: `${shots}/home-full-dark-1280.png`, fullPage: true })
  ok('어두운 화면')

  // ── 안내 페이지 ──
  const guide = await open('안내', { viewport: { width: 1280, height: 860 } })
  await guide.goto(base)
  await guide.getByRole('link', { name: '가이드' }).first().click()
  await guide.waitForURL(/\/guide$/)
  await guide.getByRole('heading', { name: '비밀은 이렇게 지켜요' }).waitFor()
  await guide.screenshot({ path: `${shots}/guide-1280.png`, fullPage: true })
  const guideM = await open('안내 휴대폰', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 })
  await guideM.goto(`${base}/guide`)
  await shot(guideM, 'guide-390')
  await guide.goto(`${base}/terms`)
  await guide.getByRole('heading', { name: '이용약관' }).waitFor()
  await guide.screenshot({ path: `${shots}/terms-1280.png`, fullPage: true })
  await guide.goto(`${base}/privacy`)
  await guide.getByRole('heading', { name: '개인정보 처리방침' }).waitFor()
  await guide.screenshot({ path: `${shots}/privacy-1280.png`, fullPage: true })
  ok('가이드 · 이용약관 · 개인정보 처리방침')

  // ── 통계 · 백업 · 방 복제 · 찾기 ──
  await admin.getByRole('button', { name: '통계', exact: true }).click()
  await admin.getByText('날마다 받은 픽').waitFor()
  await shot(admin, 'admin-stats-1280')
  await admin.getByRole('button', { name: '설정', exact: true }).click()
  await admin.getByRole('button', { name: '지금 백업하기' }).click()
  await admin.getByRole('button', { name: '이 때로 되돌리기' }).first().waitFor()
  await admin.getByRole('button', { name: '방 목록', exact: true }).click()
  await admin.getByLabel('방 찾기').fill(code)
  assert.equal(await admin.locator('.room-row').count(), 1)
  await shot(admin, 'admin-rooms-1280')
  await admin.locator('.room-row').click()
  await tab(admin, '설정')
  await admin.getByRole('button', { name: '방 복제' }).click()
  await admin.getByRole('heading', { name: '가을 축제 준비 (복사)' }).waitFor()
  assert.equal(await admin.locator('.item-draft').count(), 3) // 주제가 모두 ‘준비’로 따라와요
  await tab(admin, '설정')
  await admin.getByRole('button', { name: '방 지우기' }).click()
  await admin.getByRole('heading', { name: '모든 방' }).waitFor()
  ok('통계 · 지금 백업하기 · 방 찾기 · 방 복제')

  // ── 기록 ──
  await admin.getByRole('button', { name: '기록' }).click()
  await admin.getByText('고치거나 뺀 흔적이 없어요').waitFor()
  await shot(admin, 'admin-audit-1280')
  ok('기록이 이어져 있어요')

  // ── 방장: 가입 없이 방 만들기 (휴대폰에서) ──
  const host = await open('방장', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 })
  await host.goto(`${base}/m`)
  await host.getByRole('link', { name: '방 만들기' }).click()
  await host.getByRole('heading', { name: '방을 만들기 전에 읽어 주세요' }).waitFor()
  assert.ok(await host.getByRole('button', { name: '방 만들러 가기' }).isDisabled())
  await host.getByLabel('모두 읽었어요').check()
  await shot(host, 'new-guide-390')
  await host.getByRole('button', { name: '방 만들러 가기' }).click()
  await host.getByLabel('방 이름').fill('우리 반 소풍 장소')
  await host.getByLabel(/방장 비밀번호/).fill('host-secret')
  await shot(host, 'new-form-390')
  await host.getByRole('button', { name: '방 만들기' }).click()
  await host.waitForURL(/\/host$/)
  await host.getByRole('heading', { name: '우리 반 소풍 장소' }).waitFor()
  await host.getByText('자동으로 지워져요').waitFor()
  await shot(host, 'host-room-390')
  const hostCode = (await host.locator('.fact-code').innerText()).trim()
  assert.equal(await host.getByRole('button', { name: '기록' }).count(), 0) // 관리자 메뉴는 없어요
  ok('방장: 설명을 읽고 → 방 만들기 → 방장 화면')

  const guest = await open('손님', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  await guest.goto(`${base}/m`)
  await guest.getByLabel('방 번호').fill(hostCode)
  await guest.getByRole('button', { name: '다음' }).click()
  await guest.getByText('다음 주제를 기다리고 있어요').waitFor() // 비밀번호가 없는 방은 칸이 아예 안 나와요
  ok('비밀번호 없는 방은 방 번호만으로 바로 들어가요')

  // ── 공동 진행자 · 신고 ──
  await tab(host, '설정')
  await host.locator('summary', { hasText: '공동 진행자' }).click()
  await host.getByLabel(/공동 진행자 비밀번호/).fill('co-pass-1')
  await host.getByRole('button', { name: '공동 진행자 두기' }).click()
  await host.getByText('공동 진행자 비밀번호를 정했어요').waitFor()
  const co = await open('공동 진행자', { viewport: { width: 1280, height: 860 } })
  await co.goto(`${base}/host`)
  await co.getByLabel('방 번호').fill(hostCode)
  await co.getByLabel(/방장 비밀번호/).fill('co-pass-1')
  await co.getByRole('button', { name: '들어가기' }).click()
  await co.locator('.ad-role', { hasText: '공동 진행자 화면' }).waitFor()
  await co.getByRole('button', { name: '주제 더하기' }).first().waitFor()
  assert.equal(await co.getByRole('button', { name: '방 지우기' }).count(), 0)
  assert.equal(await co.getByText('방 설정 바꾸기').count(), 0)
  await shot(co, 'cohost-1280')
  ok('공동 진행자: 주제는 진행하되 방 지우기 · 설정은 안 보여요')

  await guest.locator('summary', { hasText: '이 방 신고하기' }).click()
  await guest.getByRole('button', { name: '신고 보내기' }).click()
  await guest.getByText('신고를 보냈어요').waitFor()
  await admin.getByRole('button', { name: /^신고/ }).click()
  await admin.getByText(`우리 반 소풍 장소 (방 번호 ${hostCode})`).waitFor() // 신고는 방이 지워져도 남으니, 이번 방 번호로 찾아요
  await shot(admin, 'admin-reports-1280')
  ok('신고: 참여자가 보내면 관리자 화면에 모여요')

  // ── 관리자 여러 명 ──
  await admin.getByRole('button', { name: '관리자', exact: true }).click()
  await admin.getByLabel('아이디').fill('teacher1')
  await admin.getByLabel(/비밀번호/).fill('teacher-pass-1')
  await admin.getByRole('button', { name: '관리자 더하기' }).click()
  await admin.locator('.reports li', { hasText: 'teacher1' }).getByRole('button', { name: '빼기' }).waitFor()
  await shot(admin, 'admin-admins-1280')
  const helper = await open('더한 관리자', { viewport: { width: 1280, height: 860 } })
  await helper.goto(`${base}/admin`)
  await helper.getByLabel('아이디').fill('teacher1')
  await helper.getByLabel('비밀번호').fill('teacher-pass-1')
  await helper.getByRole('button', { name: '로그인' }).click()
  await helper.getByRole('heading', { name: '한눈에 보기' }).waitFor()
  assert.equal(await helper.getByRole('button', { name: '관리자', exact: true }).count(), 0) // 더한 관리자에게는 관리자 탭이 없어요
  await admin.locator('.reports li', { hasText: 'teacher1' }).getByRole('button', { name: '빼기' }).click()
  await admin.locator('.reports li', { hasText: 'teacher1' }).getByRole('button', { name: '빼기' }).waitFor({ state: 'detached' })
  ok('관리자 여러 명: 더한 관리자가 로그인하고, 최고 관리자만 더하고 빼요')

  const again = await open('방장2', { viewport: { width: 1280, height: 860 } })
  await again.goto(`${base}/host`)
  await again.getByLabel('방 번호').fill(hostCode)
  await again.getByLabel('방장 비밀번호').fill('host-secret')
  await again.getByRole('button', { name: '들어가기' }).click()
  await again.getByRole('heading', { name: '우리 반 소풍 장소' }).waitFor()
  await shot(again, 'host-room-1280')
  await tab(again, '설정')
  await again.getByRole('button', { name: '방 지우기' }).click()
  await again.waitForURL(base + '/')
  ok('방장: 다른 기기에서 다시 들어와 방 지우기')

  // ── 치우기 ──
  await admin.getByRole('button', { name: '방 목록', exact: true }).click()
  await admin.getByRole('button', { name: /가을 축제 준비/ }).first().click()
  await tab(admin, '설정')
  await admin.getByRole('button', { name: '방 지우기' }).click()
  await admin.getByRole('heading', { name: '모든 방' }).waitFor()
  await admin.getByRole('button', { name: '설정', exact: true }).click()
  await admin.getByRole('button', { name: '로고 지우기' }).click()
  for (const x of (await (await admin.request.get(`${base}/api/admin/bundles`)).json()).bundles) if (x.name === '축제 준비 회의') await admin.request.delete(`${base}/api/admin/bundles/${x.id}`, X)
  await admin.getByText('로고 없음').waitFor()
  await pc.getByRole('heading', { name: '방 들어가기' }).waitFor({ timeout: 20000 }) // 방이 지워지면 들어가기 화면으로
  ok('시험용 방 · 로고 치우기')

  // 방이 지워진 뒤 끊기는 연결 알림은 문제로 세지 않아요
  const real = problems.filter((p) => !/Failed to load resource.*(401|403|404)|ERR_INCOMPLETE_CHUNKED|net::ERR/.test(p))
  assert.deepEqual(real, [])
  ok('콘솔 오류 · 보안 정책 위반 · 옆으로 넘침 없음')
  console.log(`\n✓ 화면 시험 ${n}개를 모두 지나갔어요 (사진: ${shots})`)
} catch (e) {
  console.error('\n✗ 화면 시험 실패:', e, '\n', problems)
  process.exitCode = 1
} finally {
  await b.close()
  // 중간에 멈췄어도 이 시험이 만든 방 · 관리자는 남기지 않아요
  try {
    const X = { 'X-Requested-With': 'mypick', 'Content-Type': 'application/json' }
    const login = await fetch(`${base}/api/admin/login`, { method: 'POST', headers: X, body: JSON.stringify({ id: ADMIN_ID, password: ADMIN_PASSWORD }) })
    const cookie = login.headers.get('set-cookie').split(';')[0]
    const { rooms } = await (await fetch(`${base}/api/admin/rooms`, { headers: { cookie } })).json()
    const mine = ['가을 축제 준비', '가을 축제 준비 (복사)', '운영진 뽑기 (코드)', '우리 반 소풍 장소']
    for (const r of rooms) if (mine.includes(r.title) && r.createdAt >= startedAt) await fetch(`${base}/api/admin/rooms/${r.id}`, { method: 'DELETE', headers: { ...X, cookie } })
    // 이번에 시험하며 남긴 신고만 확인 처리한 뒤 지워요 (관리자의 신고 목록에 쌓이지 않게)
    for (const r of (await (await fetch(`${base}/api/admin/reports`, { headers: { cookie } })).json()).reports)
      if (r.at >= startedAt && /가을 축제 준비|우리 반 소풍/.test(r.roomTitle)) {
        await fetch(`${base}/api/admin/reports/${r.id}/handle`, { method: 'POST', headers: { ...X, cookie } })
        await fetch(`${base}/api/admin/reports/${r.id}`, { method: 'DELETE', headers: { ...X, cookie } })
      }
  } catch {
    /* 서버가 꺼져 있으면 치울 것도 없어요 */
  }
}
