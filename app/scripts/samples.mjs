// 예시 사진 만들기: 도커를 켠 뒤 npm run samples  →  ../docs/예시 사진/
// 27명이 참여하는 ‘가을 축제 준비’를 실제로 한 번 돌리면서 사이트 전체를 순서대로 찍어요.
// (24명은 프로그램이 대신 들어와 픽하고, PC · 휴대폰 · 태블릿 한 대씩은 진짜 브라우저예요.)
// 번호와 한글 이름을 붙이고, 사진 설명을 ‘사진 목록.md’ 에 적고, 보내기 쉽게 zip 으로도 묶어요.
// 예시용 방과 로고는 끝나면 지워요.
import { chromium } from 'playwright-core'
import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import assert from 'node:assert/strict'

const base = process.argv[2] || 'http://localhost:8082'
const out = '../docs/예시 사진'
const { ADMIN_ID = 'admin', ADMIN_PASSWORD } = process.env
assert.ok(ADMIN_PASSWORD, '.env 에 ADMIN_PASSWORD 가 있어야 해요')
rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })

const startedAt = Date.now()
const b = await chromium.launch({ channel: 'chrome' })
const open = async (options) => {
  const ctx = await b.newContext({ locale: 'ko-KR', ...options })
  // 화면 안 확인 창(dialog.ask)은 ‘확인’을 눌러 줘요 (예전에 브라우저 기본 창을 받아 주던 것과 같게)
  await ctx.addInitScript(() => {
    new MutationObserver(() => document.querySelector('dialog.ask[open] .ask-ok')?.click()).observe(document, { childList: true, subtree: true })
  })
  const page = await ctx.newPage()
  page.on('dialog', (d) => d.accept())
  return page
}
const PC = { viewport: { width: 1440, height: 900 } }
const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }
const TABLET = { viewport: { width: 820, height: 1180 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1.5 }

const list = []

/** 선택지 칸을 하나씩 채워요 (칸이 모자라면 ‘선택지 더하기’) */
async function fillOptions(page, list) {
  for (let i = 0; i < list.length; i++) {
    if (i >= (await page.locator('.opt-row').count())) await page.getByRole('button', { name: '선택지 더하기' }).click()
    await page.getByLabel(`선택지 ${i + 1}`, { exact: true }).fill(list[i])
  }
}
/** 움직임이 끝나길 기다렸다가 찍고, 목록에 설명을 적어요 */
async function shot(page, name, caption, options = {}) {
  if (options.fullPage) await page.evaluate(() => scrollTo(0, 0)) // 긴 화면은 맨 위에서부터 (붙어 다니는 머리줄이 중간에 찍히지 않게)
  await page.waitForTimeout(1400)
  const file = `${String(list.length + 1).padStart(2, '0')} ${name}.png`
  await page.screenshot({ path: `${out}/${file}`, ...options })
  list.push([file, caption])
  console.log(`  ✓ ${file}`)
}
const pick = (page, label) => page.locator('.row', { hasText: label }).locator('input').check()
const castVote = async (page) => {
  await page.getByRole('button', { name: '픽하기' }).click()
  await page.getByRole('button', { name: '픽 확정' }).click()
}

// ── 대신 참여하는 24명 ──
const H = { 'X-Requested-With': 'mypick', 'Content-Type': 'application/json' }
const bots = []
const made = new Set() // 이 스크립트가 만든 방 번호 (끝나면 지워요)
const live = []
const hold = new AbortController()
let code = ''
async function botsJoin(n) {
  for (let i = 0; i < n; i++) {
    const res = await fetch(`${base}/api/join`, { method: 'POST', headers: H, body: JSON.stringify({ room: code, password: '1234' }) })
    assert.equal(res.status, 200)
    const cookie = res.headers.get('set-cookie').split(';')[0]
    live.push(await fetch(`${base}/api/events?room=${code}`, { headers: { cookie }, signal: hold.signal })) // 붙잡아 둬야 연결이 끝까지 살아 있어요
    bots.push(cookie)
  }
}
/** picks: 봇마다 고를 선택지 순서 번호 (null 은 건너뜀) */
async function botsVote(from, picks) {
  const me = await (await fetch(`${base}/api/me`, { headers: { cookie: bots[0] } })).json()
  const item = me.items.find((i) => i.status === 'open')
  for (const [k, p] of picks.entries()) {
    const res = await fetch(`${base}/api/vote`, { method: 'POST', headers: { ...H, cookie: bots[from + k] }, body: JSON.stringify({ item: item.id, options: p === null ? [] : [item.options[p].id] }) })
    assert.equal(res.status, 200)
  }
}

try {
  // ── 첫 화면 · 안내 ──
  const pc = await open(PC)
  await pc.goto(base)
  await pc.getByLabel('방 번호').waitFor()
  await shot(pc, '첫 화면 (PC)', '사이트에 처음 들어오면 보이는 화면. 방 번호만 넣으면 바로 참여해요.', { fullPage: true })
  const phone = await open(PHONE)
  await phone.goto(base)
  await phone.waitForURL(/\/m$/)
  await shot(phone, '첫 화면 (휴대폰)', '휴대폰 · 태블릿으로 들어오면 자동으로 모바일 화면(/m)으로 넘어가요.', { fullPage: true })
  const guide = await open(PC)
  await guide.goto(`${base}/guide`)
  await guide.getByRole('heading', { name: '비밀은 이렇게 지켜요' }).waitFor()
  await shot(guide, '이용 가이드', '참여하기 · 진행하기를 단계마다 화면 조각과 함께 보여 주고, 알아 두면 좋은 것 · 비밀 보장 · 자주 묻는 것을 모아 둔 페이지.', { fullPage: true })

  // ── 관리자: 로그인 · 기관 설정 · 방 만들기 ──
  const admin = await open(PC)
  await admin.goto(`${base}/admin`)
  await admin.getByLabel('아이디').fill(ADMIN_ID)
  await admin.getByLabel('비밀번호').fill('••••••••••••')
  await shot(admin, '관리자 로그인', '관리자 계정으로 로그인해요. 여러 번 틀리면 잠겨요.')
  await admin.getByLabel('비밀번호').fill(ADMIN_PASSWORD)
  await admin.getByRole('button', { name: '로그인' }).click()
  await admin.getByRole('heading', { name: '한눈에 보기' }).waitFor()

  await admin.getByRole('button', { name: '설정', exact: true }).click()
  const logoPage = await open({ viewport: { width: 360, height: 140 } })
  await logoPage.setContent('<body style="margin:0;display:grid;place-items:center;height:140px;background:#14213d;color:#fff;font:800 44px -apple-system,sans-serif;letter-spacing:.04em">예시 로고</body>')
  await admin.locator('input[type=file]').setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: await logoPage.screenshot() })
  await admin.getByAltText('지금 로고').waitFor()
  await shot(admin, '설정 (기관 이름 · 로고)', '기관 이름과 로고 사진을 올리면 모든 화면 맨 위에 나와요. (사진 속 로고는 예시예요.)')
  await admin.getByRole('button', { name: '로고 지우기' }).click()
  await admin.getByText('로고 없음').waitFor()

  await admin.getByRole('button', { name: '방 목록', exact: true }).click()
  await admin.getByRole('button', { name: '새 방 만들기' }).click()
  await admin.getByLabel('방 이름').fill('가을 축제 준비')
  await admin.getByRole('textbox', { name: /방 비밀번호/ }).fill('1234')
  await admin.getByRole('combobox', { name: '주제 제한 시간' }).selectOption('300')
  await admin.getByLabel(/끊긴 사람을 기다리는 시간/).fill('5')
  await shot(admin, '새 방 만들기', '입장 방식(간편 · 엄격), 방 비밀번호, 제한 시간, 결과 공개 방식을 방마다 정해요.', { fullPage: true })
  await admin.getByRole('button', { name: '방 만들기' }).click()
  await admin.locator('.fact-code').waitFor()
  code = (await admin.locator('.fact-code').innerText()).trim()
  made.add(code)

  await admin.getByRole('button', { name: '주제 더하기' }).first().click()
  await admin.getByLabel('주제 제목').fill('축제 주제를 골라 주세요')
  await fillOptions(admin, ['우주 여행', '레트로 게임', '숲속 캠핑'])
  await admin.locator('form.form-inset').getByRole('button', { name: '주제 더하기' }).click()
  await admin.getByRole('heading', { name: '축제 주제를 골라 주세요' }).waitFor()
  await admin.getByRole('button', { name: '주제 더하기' }).first().click()
  await admin.getByRole('button', { name: '찬성 / 반대 (절반을 넘으면 통과)', exact: true }).click()
  await admin.getByLabel('주제 제목').fill('회칙 제5조를 바꿀까요?')
  await admin.locator('form.form-inset').scrollIntoViewIfNeeded()
  await shot(admin, '주제 만들기 (자주 쓰는 모양)', '‘찬성 / 반대’, ‘절반을 넘으면 통과’, ‘연습 픽’ 같은 자주 쓰는 모양로 주제를 금방 만들어요.', { fullPage: true })
  await admin.locator('form.form-inset').getByRole('button', { name: '주제 더하기' }).click()
  await admin.getByRole('heading', { name: '회칙 제5조를 바꿀까요?' }).waitFor()

  // ── 큰 화면 · 입장 ──
  const screen = await open({ viewport: { width: 1920, height: 1080 } })
  await screen.goto(base + (await admin.getByRole('link', { name: '큰 화면 열기' }).getAttribute('href')))
  await botsJoin(14)
  await screen.getByText('14명 들어왔어요').waitFor()
  await shot(screen, '큰 화면 - 들어오는 방법', '빔프로젝터 · TV 에 띄우는 화면. QR 을 찍거나 주소와 방 번호로 들어와요.')

  await pc.goto(`${base}/?room=${code}`)
  await pc.getByLabel('방 비밀번호').fill('1234')
  await shot(pc, '들어가기 (방 비밀번호)', '방 번호를 넣으면 그 방에 필요한 것만 물어요. 비밀번호가 없는 방은 이 단계가 없어요.')
  await pc.getByRole('button', { name: '들어가기' }).click()
  await pc.getByText('다음 주제를 기다리고 있어요').waitFor()
  await phone.getByLabel('방 번호').fill(code)
  await phone.getByRole('button', { name: '다음' }).click()
  await phone.getByLabel('방 비밀번호').fill('1234')
  await phone.getByRole('button', { name: '들어가기' }).click()
  await phone.getByText('다음 주제를 기다리고 있어요').waitFor()
  await shot(phone, '기다리는 화면 (휴대폰)', '들어온 뒤에는 진행자가 주제를 열 때까지 기다려요. 새로고침하지 않아도 돼요.')
  const tablet = await open(TABLET)
  await tablet.goto(`${base}/?room=${code}`)
  await tablet.getByLabel('방 비밀번호').fill('1234')
  await tablet.getByRole('button', { name: '들어가기' }).click()
  await tablet.getByText('다음 주제를 기다리고 있어요').waitFor()
  await botsJoin(10)

  await admin.getByText('27명').first().waitFor()
  await shot(admin, '방 진행 화면 (준비)', '방장 · 관리자가 보는 화면. 방 번호, 들어온 사람, 접속 인원이 보이고 주제를 하나씩 열어요.')
  await admin.getByRole('button', { name: '입장 마감' }).click()
  await admin.getByRole('button', { name: '입장 다시 열기' }).waitFor()

  // ── 1번 주제: 학생회장 ──
  await admin.getByRole('button', { name: '픽 열기' }).first().click()
  await phone.getByRole('heading', { name: '축제 주제를 골라 주세요' }).waitFor()
  await botsVote(0, [1, 0, 1, 2, 1, 0, 1, null, 1, 0, 2, 1, 0, 1, 2, 1])
  await screen.getByText('16 / 27명 픽함').waitFor()
  await shot(screen, '큰 화면 - 픽 받는 중', '남은 시간이 고리로 줄어들고, 한 명이 픽할 때마다 점이 하나씩 채워져요. 결과는 마감 전까지 아무도 볼 수 없어요.')
  await shot(admin, '방 진행 화면 (픽 받는 중)', '몇 명이 픽했는지만 보여요. 진행자도 지금은 결과를 볼 수 없어요. ‘30초 더’로 시간을 늘릴 수 있어요.')
  await pick(pc, '레트로 게임')
  await shot(pc, '픽 카드 (PC)', '진짜 픽 카드처럼 오른쪽 기표란에 도장이 찍혀요.')
  await pick(tablet, '우주 여행')
  await shot(tablet, '픽 카드 (태블릿)', '태블릿에서도 같은 픽 카드. 누르는 곳이 크고 버튼은 아래쪽에 있어요.')
  await pick(phone, '레트로 게임')
  await shot(phone, '픽 카드 (휴대폰)', '휴대폰에서는 ‘픽하기’ 버튼이 엄지가 닿는 아래쪽에 붙어 있어요.')
  await phone.getByRole('button', { name: '픽하기' }).click()
  await phone.getByText('‘레트로 게임’ 고를까요?').waitFor()
  await shot(phone, '픽 확인 (휴대폰)', '확정하면 바꿀 수 없어서, 한 번 더 물어봐요.')
  await phone.getByRole('button', { name: '픽 확정' }).click()
  await phone.getByRole('heading', { name: '픽했어요' }).waitFor()
  await shot(phone, '픽 완료 (휴대폰)', '픽을 마치면 도장이 찍히고, 결과는 마감 뒤에 나와요.')
  await castVote(pc)
  await castVote(tablet)
  await botsVote(16, [1, 0, 1, 2, 0, 1, 1, 0])
  await screen.getByText('1번째 주제 결과').waitFor({ timeout: 15000 })
  await shot(screen, '큰 화면 - 결과', '모두 픽하면 저절로 마감되고, 결과가 모든 화면에 한꺼번에 나와요.')
  await pc.getByText('모두 픽함').first().waitFor()
  await shot(pc, '결과 (PC)', '참여자 화면 오른쪽에 지난 주제의 결과가 쌓여요.')
  await shot(phone, '결과 (휴대폰)', '휴대폰에서 보는 결과.')

  // ── 2번 주제: 통과 통과 여부 ──
  await admin.getByRole('button', { name: '픽 열기' }).first().click()
  await phone.getByRole('heading', { name: '회칙 제5조를 바꿀까요?' }).waitFor()
  await botsVote(0, [0, 0, 1, 0, 0, null, 0, 1, 0, 0, 0, 1, 0, 0, 1, 0, null, 0, 1, 0, 0, null, 1, 0])
  for (const p of [pc, phone, tablet]) {
    await pick(p, '찬성')
    await castVote(p)
  }
  await screen.getByText('통과', { exact: true }).waitFor({ timeout: 15000 })
  await shot(screen, '큰 화면 - 통과', '찬반 주제에 통과 기준(절반 넘게 · 3분의 2)을 정해 두면 통과 여부이 직인처럼 찍혀 나와요.')
  await phone.evaluate(() => (document.documentElement.dataset.theme = 'dark'))
  await phone.getByText('통과', { exact: true }).first().waitFor()
  await shot(phone, '어두운 화면 (휴대폰)', '기기가 어두운 화면이면 따라가고, 직접 바꿀 수도 있어요.', { fullPage: true })

  // ── 진행자: 결과 · 인쇄 · 기록 ──
  await admin.getByRole('button', { name: '한눈에', exact: true }).click()
  await admin.getByText('서버 상태').waitFor()
  await shot(admin, '한눈에 보기 (관리자 첫 화면)', '관리자가 로그인하면 먼저 보는 화면. 지금 열린 픽, 오늘 숫자, 확인할 신고, 서버 상태가 모여 있어요.', { fullPage: true })
  await admin.getByRole('button', { name: '통계', exact: true }).click()
  await admin.getByText('날마다 받은 픽').waitFor()
  await shot(admin, '통계', '방 · 참여 인원 · 받은 표 · 참여율을 날마다, 주마다 보여 줘요. 방이 지워져도 합계는 남아요.', { fullPage: true })
  await admin.getByRole('button', { name: '방 목록', exact: true }).click()
  await admin.locator('.room-row', { hasText: code }).click()
  await admin.locator('.menu > summary').click() // 내려받기 · 인쇄 · 결과 정리 인쇄가 여기 모여 있어요
  await shot(admin, '방 진행 화면 (마감 · 결과)', '마감된 주제의 결과. ‘결과 남기기’에서 내려받기(CSV) · 인쇄 · 결과 정리 인쇄를 고르고, 동점이면 그 선택지만으로 다시 고르게 할 수 있어요.', { fullPage: true })
  await admin.emulateMedia({ media: 'print' })
  await admin.evaluate(() => (document.body.dataset.print = 'results'))
  await shot(admin, '결과 인쇄 모양', '‘결과 인쇄’를 누르면 버튼 없이 결과만 종이에 나와요.', { fullPage: true })
  await admin.evaluate(() => (document.body.dataset.print = 'minutes'))
  const proof = (await admin.locator('.minutes').getByText(/결과 확인 코드: /).first().innerText()).split(': ')[1].trim()
  await shot(admin, '결과 정리 인쇄 모양', '‘결과 정리 인쇄’를 누르면 주제 · 받은 픽 · 통과 여부 · 서명 칸이 담긴 결과 정리가 한 장으로 나와요.', { fullPage: true })
  await admin.emulateMedia({ media: 'screen' })
  const checker = await open(PC)
  await checker.goto(`${base}/verify`)
  await checker.getByLabel(/결과 확인 코드/).fill(proof)
  await checker.getByRole('button', { name: '확인하기' }).click()
  await checker.getByText('마감했을 때의 결과 그대로예요.').waitFor()
  await shot(checker, '결과 확인', '마감 때 나온 12자리 코드를 넣으면, 결과가 그 뒤로 바뀌지 않았는지 누구나 확인할 수 있어요.', { fullPage: true })
  await admin.getByRole('button', { name: '기록' }).click()
  await admin.getByText('고치거나 뺀 흔적이 없어요').waitFor()
  await shot(admin, '기록', '진행자가 한 일과 마감 순간의 결과가 남아요. 누가 고치면 바로 드러나요.')

  // ── 방장: 누구나 방 만들기 ──
  const host = await open(PHONE)
  await host.goto(`${base}/new`)
  await host.getByLabel('모두 읽었어요').check()
  await shot(host, '방 만들기 전 설명', '가입 없이 누구나 방을 만들 수 있어요. 만들기 전에 꼭 알아 둘 것을 먼저 읽어요.', { fullPage: true })
  await host.getByRole('button', { name: '방 만들러 가기' }).click()
  await host.getByLabel('방 이름').fill('우리 반 소풍 장소 정하기')
  await host.getByLabel(/방장 비밀번호/).fill('sample-host')
  await host.getByRole('button', { name: '방 만들기' }).click()
  await host.waitForURL(/\/host$/)
  await host.getByText('자동으로 지워져요').waitFor()
  await shot(host, '방장 화면', '방을 만든 사람은 자기 방 하나만 진행해요. 마지막으로 쓴 뒤 며칠 지나면 자동으로 지워져요.', { fullPage: true })

  await admin.getByRole('button', { name: '방 목록', exact: true }).click()
  await admin.getByText('방장이 만든 방').waitFor()
  await shot(admin, '방 목록 (관리자)', '관리자는 모든 방을 봐요. 방장이 만든 방은 따로 묶이고 자동 삭제 날짜가 나와요.')

  await phone.locator('summary', { hasText: '이 방 신고하기' }).click()
  await phone.getByRole('button', { name: '신고 보내기' }).click()
  await phone.getByText('신고를 보냈어요').waitFor()
  await admin.getByRole('button', { name: /^신고/ }).click()
  await admin.getByText(`가을 축제 준비 (방 번호 ${code})`).waitFor() // 신고는 방이 지워져도 남으니, 이번 방 번호로 찾아요
  await shot(admin, '신고 · 제보 (관리자)', '신고 · 오류 제보 · 막을 낱말 · 막은 곳을 작은 탭으로 나눠 하나씩 봐요. 참여자가 ‘이 방 신고하기’로 보낸 신고가 여기에 모여요. (사진 속 신고는 예시예요.)')
  await admin.getByRole('button', { name: '관리자', exact: true }).click()
  await admin.getByLabel('아이디').fill('sample-teacher')
  await admin.getByLabel(/비밀번호/).fill('sample-pass-1')
  await admin.getByRole('button', { name: '관리자 더하기' }).click()
  await admin.locator('.reports li', { hasText: 'sample-teacher' }).getByRole('button', { name: '빼기' }).waitFor()
  await shot(admin, '관리자 여러 명', '최고 관리자가 다른 관리자를 더하고 뺄 수 있어요. 누가 무엇을 했는지는 기록에 남아요.')
  await admin.locator('.reports li', { hasText: 'sample-teacher' }).getByRole('button', { name: '빼기' }).click()
  await admin.locator('.reports li', { hasText: 'sample-teacher' }).getByRole('button', { name: '빼기' }).waitFor({ state: 'detached' })
  await admin.getByRole('button', { name: '방 목록', exact: true }).click()

  // ── 엄격 방식: 입장 코드 ──
  await admin.getByRole('button', { name: '새 방 만들기' }).click()
  await admin.getByLabel('방 이름').fill('운영진 뽑기 (1인 1코드)')
  await admin.getByRole('radio', { name: /엄격/ }).check()
  await admin.getByRole('button', { name: '방 만들기' }).click()
  await admin.locator('.room-tabs').getByRole('button', { name: '준비', exact: true }).click()
  await admin.getByLabel('만들 개수').fill('12')
  await admin.getByRole('button', { name: '코드 만들기' }).click()
  await admin.locator('.codes li').nth(11).waitFor()
  made.add((await admin.locator('.fact-code').innerText()).trim())
  await admin.emulateMedia({ media: 'print' })
  await admin.evaluate(() => (document.body.dataset.print = 'codes'))
  await shot(admin, '입장 코드 인쇄 모양', '중요한 픽은 한 사람에게 입장 코드를 하나씩 나눠 줘요. QR 을 찍으면 바로 들어오고, 코드 하나에 한 표뿐이에요.', { fullPage: true })
  await admin.emulateMedia({ media: 'screen' })

  const night = await open({ ...PC, colorScheme: 'dark' })
  await night.goto(base)
  await night.getByLabel('방 번호').waitFor()
  await shot(night, '어두운 화면 (PC 첫 화면)', '어두운 화면에서 본 첫 화면.')


  writeFileSync(
    `${out}/사진 목록.md`,
    `# My Pick 예시 사진\n\n0.2.0 을 실제로 띄워 찍은 화면이에요. ‘가을 축제 준비’ 방에 27명이 들어와 주제 두 개를 픽하는 장면이고, 이름과 숫자는 모두 지어낸 예시예요.\n\n| 사진 | 설명 |\n|---|---|\n${list.map(([f, c]) => `| ${f.replace(/\.png$/, '')} | ${c} |`).join('\n')}\n`,
  )
  execFileSync('zip', ['-qr', '../My Pick 예시 사진.zip', '.', '-x', '*.DS_Store'], { cwd: out })
  console.log(`\n✓ 사진 ${list.length}장을 만들었어요: ${out} (묶음: ../docs/My Pick 예시 사진.zip)`)
} catch (e) {
  console.error('\n✗ 예시 사진 만들기 실패:', e)
  process.exitCode = 1
} finally {
  hold.abort()
  // 치우기: 중간에 멈췄어도 이 스크립트가 만든 방 · 관리자는 남기지 않아요
  try {
    const X = { 'X-Requested-With': 'mypick', 'Content-Type': 'application/json' }
    const login = await fetch(`${base}/api/admin/login`, { method: 'POST', headers: X, body: JSON.stringify({ id: ADMIN_ID, password: ADMIN_PASSWORD }) })
    const cookie = login.headers.get('set-cookie').split(';')[0]
    const { rooms } = await (await fetch(`${base}/api/admin/rooms`, { headers: { cookie } })).json()
    for (const r of rooms) if (made.has(r.code) || r.title === '우리 반 소풍 장소 정하기') await fetch(`${base}/api/admin/rooms/${r.id}`, { method: 'DELETE', headers: { ...X, cookie } })
    // 이번에 시험하며 남긴 신고만 확인 처리한 뒤 지워요 (관리자의 신고 목록에 쌓이지 않게)
    for (const r of (await (await fetch(`${base}/api/admin/reports`, { headers: { cookie } })).json()).reports)
      if (r.at >= startedAt && /가을 축제 준비|우리 반 소풍/.test(r.roomTitle)) {
        await fetch(`${base}/api/admin/reports/${r.id}/handle`, { method: 'POST', headers: { ...X, cookie } })
        await fetch(`${base}/api/admin/reports/${r.id}`, { method: 'DELETE', headers: { ...X, cookie } })
      }
    const { admins } = await (await fetch(`${base}/api/admin/admins`, { headers: { cookie } })).json()
    for (const a of admins) if (a.name === 'sample-teacher') await fetch(`${base}/api/admin/admins/${a.id}`, { method: 'DELETE', headers: { ...X, cookie } })
  } catch {
    console.error('치우지 못했어요. 관리자 화면에서 예시용 방을 지워 주세요.')
  }
  await b.close()
}
