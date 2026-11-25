// 화면 점검: 도커를 켠 뒤 npm run audit
// 주요 화면을 PC(1280) · 휴대폰(390) 너비로 열어 눈으로 놓치기 쉬운 어긋남을 찾아요:
//   옆으로 넘침 · 화면 밖으로 나간 것 · 잘린 글자 · 너무 작은 글씨(12px 미만) · 누르기 작은 곳(40px 미만) · 이름 없는 버튼 · 제목 단계 건너뜀
// 점검용 방은 끝나면 지워요.
import { chromium } from 'playwright-core'
import assert from 'node:assert/strict'

const base = process.argv[2] || 'http://localhost:8082'
const { ADMIN_ID = 'admin', ADMIN_PASSWORD } = process.env
assert.ok(ADMIN_PASSWORD, '.env 에 ADMIN_PASSWORD 가 있어야 해요')
const H = { 'X-Requested-With': 'mypick', 'Content-Type': 'application/json' }
const login = await fetch(`${base}/api/admin/login`, { method: 'POST', headers: H, body: JSON.stringify({ id: ADMIN_ID, password: ADMIN_PASSWORD }) })
const cookie = login.headers.get('set-cookie').split(';')[0]
const call = async (m, p, b) => (await fetch(base + p, { method: m, headers: { ...H, cookie }, body: b ? JSON.stringify(b) : undefined })).json()
const { id } = await call('POST', '/api/admin/rooms', { title: '화면 점검용 방 이름이 꽤 길 때는 어떻게 보이는지', mode: 'strict', seconds: 120 })
const room = await call('GET', `/api/admin/rooms/${id}`)
for (const t of ['가장 좋아하는 계절을 골라 주세요', '다음 모임 장소는 어디가 좋을까요? 조금 긴 제목도 넣어 봐요'])
  await call('POST', `/api/admin/rooms/${id}/items`, { title: t, options: ['봄', '여름', '가을', '아주아주 긴 선택지 이름이 들어오면 줄이 바뀌는지 봐요'], rule: 'majority', quorum: 0 })
await call('POST', `/api/admin/rooms/${id}/codes`, { count: 3 })
const codes = (await call('GET', `/api/admin/rooms/${id}/codes`)).codes

/** 화면 안에서 재요 */
const measure = () => {
  const out = []
  const vw = innerWidth
  const say = (kind, el, extra = '') => out.push(`${kind} | ${el.tagName.toLowerCase()}${el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : ''} | ${(el.innerText || el.getAttribute('aria-label') || '').trim().slice(0, 28)} ${extra}`)
  if (document.documentElement.scrollWidth > vw + 1) out.push(`넘침 | 화면이 옆으로 ${document.documentElement.scrollWidth - vw}px 넘쳐요`)
  let lastH = 0
  for (const el of document.querySelectorAll('body *')) {
    const cs = getComputedStyle(el)
    const r = el.getBoundingClientRect()
    if (cs.display === 'none' || cs.visibility === 'hidden' || r.width === 0 || r.height === 0 || el.closest('.sr, svg, [aria-hidden="true"]')) continue
    if (el.tagName !== 'SUMMARY' && el.closest('details:not([open])') && !el.closest('summary')) continue // 접혀 있는 칸 안은 안 보이는 것
    const text = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())
    if (r.right > vw + 2 && r.left < vw) say('화면 밖', el, `(오른쪽 ${Math.round(r.right - vw)}px)`)
    if (text && parseFloat(cs.fontSize) < 12) say('작은 글씨', el, `(${cs.fontSize})`)
    if (text && cs.overflow !== 'visible' && el.scrollWidth > el.clientWidth + 1 && cs.textOverflow !== 'ellipsis') say('잘린 글자', el)
    if (/^(BUTTON|A|SELECT|SUMMARY)$/.test(el.tagName) || (el.tagName === 'INPUT' && !['hidden'].includes(el.type))) {
      const hit = el.matches('input[type=checkbox],input[type=radio]') ? el.closest('label')?.getBoundingClientRect() ?? r : r
      const inline = el.tagName === 'A' && cs.display === 'inline'
      const min = el.matches('input[type=checkbox],input[type=radio]') ? 24 : 40 // 체크 상자는 24px 이상이면 돼요
      if (!inline && (hit.height < min || hit.width < min) && !(cs.position === 'absolute' && cs.opacity === '0')) say('작은 누를 곳', el, `(${Math.round(hit.width)}×${Math.round(hit.height)})`)
      if (/^(BUTTON|A)$/.test(el.tagName) && !(el.innerText || '').trim() && !el.getAttribute('aria-label')) say('이름 없는 버튼', el)
    }
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') {
      if (!el.labels?.length && !el.getAttribute('aria-label') && el.type !== 'hidden') say('이름 없는 입력 칸', el)
    }
    const h = /^H([1-6])$/.exec(el.tagName)
    if (h) {
      if (lastH && +h[1] > lastH + 1) say('제목 단계 건너뜀', el, `(h${lastH} → h${h[1]})`)
      lastH = +h[1]
    }
    if (el.tagName === 'IMG' && el.getAttribute('alt') === null) say('설명 없는 그림', el)
  }
  return out
}

const b = await chromium.launch({ channel: 'chrome' })
const found = new Map()
let pages = 0
async function look(name, url, { as = 'guest', prep } = {}) {
  for (const [w, h, mobile] of [[1280, 860, false], [390, 844, true]]) {
    const ctx = await b.newContext({ viewport: { width: w, height: h }, isMobile: mobile, hasTouch: mobile, locale: 'ko-KR' })
    if (as === 'admin') await ctx.addCookies([{ name: 'mp_admin', value: cookie.split('=')[1], url: base }])
    const page = await ctx.newPage()
    page.on('dialog', (d) => d.accept())
    try {
      await page.goto(base + url)
      await page.waitForTimeout(700)
      if (prep) await prep(page)
      await page.waitForTimeout(500)
      for (const line of await page.evaluate(measure)) {
        const key = `${line.split(' | ').slice(0, 2).join(' | ')} | ${line.split(' | ')[2]}`
        found.set(key, [...(found.get(key) ?? []), `${name} ${w}`])
      }
      pages++
    } catch (e) {
      found.set(`열지 못함 | ${name} | ${String(e.message).slice(0, 80)}`, [`${w}`])
    }
    await ctx.close()
  }
}
const tabOf = (name) => (p) => p.locator('.room-tabs').getByRole('button', { name, exact: true }).click()
const menu = (name) => (p) => p.locator('.ad-tabs').getByRole('button', { name, exact: true }).click()

try {
  await look('첫 화면', '/')
  await look('안내', '/guide')
  await look('약관', '/terms')
  await look('개인정보', '/privacy')
  await look('결과 확인', '/verify')
  await look('방 만들기 설명', '/new')
  await look('방장 들어가기', '/host')
  await look('없는 주소', '/nowhere')
  await look('참여자: 기다림', `/?room=${room.room.code}&code=${codes[0].code}`)
  await call('POST', `/api/admin/items/${room.items?.[0]?.id ?? (await call('GET', `/api/admin/rooms/${id}`)).items[0].id}/open`)
  await look('참여자: 픽 카드', `/?room=${room.room.code}&code=${codes[1].code}`)
  await look('큰 화면', `/screen/${room.room.code}?k=${room.admin.screenKey}`)
  await look('참관인', `/observe/${room.room.code}?k=${room.admin.observerKey}`)
  await look('리모컨', `/remote#room-${id}`, { as: 'admin' })
  await look('관리자: 한눈에', '/admin', { as: 'admin' })
  await look('관리자: 방 목록', '/admin', { as: 'admin', prep: menu('방 목록') })
  await look('관리자: 신고', '/admin', { as: 'admin', prep: menu('신고') })
  await look('관리자: 통계', '/admin', { as: 'admin', prep: menu('통계') })
  await look('관리자: 설정', '/admin', { as: 'admin', prep: menu('설정') })
  await look('관리자: 기록', '/admin', { as: 'admin', prep: menu('기록') })
  await look('방: 진행', `/admin#room-${id}`, { as: 'admin' })
  await look('방: 준비', `/admin#room-${id}`, { as: 'admin', prep: tabOf('준비') })
  await look('방: 설정', `/admin#room-${id}`, { as: 'admin', prep: tabOf('설정') })
} finally {
  await call('DELETE', `/api/admin/rooms/${id}`)
  await b.close()
}

const byKind = new Map()
for (const [key, where] of found) {
  const kind = key.split(' | ')[0]
  byKind.set(kind, [...(byKind.get(kind) ?? []), `${key.split(' | ').slice(1).join(' | ')}  ← ${[...new Set(where)].slice(0, 4).join(', ')}${where.length > 4 ? ' …' : ''}`])
}
console.log(`화면 ${pages}개를 봤어요.`)
for (const [kind, lines] of byKind) {
  console.log(`\n■ ${kind} ${lines.length}건`)
  for (const l of lines.slice(0, 30)) console.log('  ' + l)
  if (lines.length > 30) console.log(`  … ${lines.length - 30}건 더`)
}
if (!byKind.size) console.log('✓ 어긋난 곳을 찾지 못했어요')
process.exitCode = byKind.size ? 1 : 0
