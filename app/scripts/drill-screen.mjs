// 큰 화면: 선택지가 많을 때 주제가 가려지는지 (진행 중 · 결과, 실시간 공개 방 포함). 인자: 사진 앞머리
import { chromium } from 'playwright-core'
const base = process.env.DRILL_URL || 'http://localhost:8082', tag = process.argv[2] || '전'
const out = '../docs/스크린샷/1.0.1'
import { mkdirSync } from 'node:fs'; mkdirSync(out, { recursive: true })
const H = { 'X-Requested-With': 'mypick', 'Content-Type': 'application/json' }
const call = async (c, m, p, b) => { const r = await fetch(base + p, { method: m, headers: { ...(m === 'GET' ? {} : H), cookie: c || '' }, body: b ? JSON.stringify(b) : undefined }); const s = r.headers.get('set-cookie'); return { status: r.status, data: await r.json().catch(() => null), cookie: s ? s.split(';')[0] : c } }
const admin = (await call('', 'POST', '/api/admin/login', { id: process.env.ADMIN_ID || 'admin', password: process.env.ADMIN_PASSWORD })).cookie
const b = await chromium.launch({ channel: 'chrome' })
const ids = []
try {
  for (const [live, n] of [[false, 12], [false, 30], [true, 20]]) {
    const id = (await call(admin, 'POST', '/api/admin/rooms', { title: `큰 화면 선택지 ${n}개 시험`, mode: 'simple', seconds: 120, live })).data.id
    ids.push(id)
    const path = `/api/admin/rooms/${id}`
    const item = (await call(admin, 'POST', `${path}/items`, { title: '우리 반 체험 학습으로 가고 싶은 곳을 골라 주세요 (조금 긴 제목이 두 줄이 될 때)', note: '설명도 한 줄 있어요.', options: Array.from({ length: n }, (_, i) => `${i + 1}번 선택지 ${'가나다라마바사'.slice(0, 2 + (i % 5))}`), maxPick: 2 })).data.id
    const s = (await call(admin, 'GET', path)).data
    const voters = []
    for (let i = 0; i < 40; i++) voters.push((await call('', 'POST', '/api/join', { room: s.room.code })).cookie)
    await call(admin, 'POST', `/api/admin/items/${item}/open`)
    const opts = (await call(admin, 'GET', path)).data.items[0].options
    for (let i = 0; i < 30; i++) await call(voters[i], 'POST', '/api/vote', { item, options: [opts[(i * 7) % n].id] })
    for (const [w, h] of [[1920, 1080], [1366, 768]]) {
      const page = await (await b.newContext({ viewport: { width: w, height: h }, locale: 'ko-KR' })).newPage()
      await page.goto(`${base}/screen/${s.room.code}?k=${s.admin.screenKey}`)
      await page.waitForTimeout(1500)
      const m = await page.evaluate(() => { const t = document.querySelector('h1, h2, .sc-title'); const r = t?.getBoundingClientRect(); const ring = document.querySelector('.sc-ring')?.getBoundingClientRect(); const time = document.querySelector('.sc-ring span')?.getBoundingClientRect(); const count = document.querySelector('.sc-progress strong')?.getBoundingClientRect(); return { title: t?.textContent?.slice(0, 12), top: r && Math.round(r.top), bottom: r && Math.round(r.bottom), docH: document.documentElement.scrollHeight, viewH: innerHeight, 시간이동그라미안: !!ring && !!time && time.left >= ring.left && time.right <= ring.right && time.top >= ring.top && time.bottom <= ring.bottom, 시간과숫자겹침: !!time && !!count && time.bottom > count.top } })
      console.log(`${live ? '실시간' : '보통'} ${n}개 ${w}x${h} 진행 중:`, JSON.stringify(m))
      await page.screenshot({ path: `${out}/${tag} - 큰 화면 ${live ? '실시간 ' : ''}선택지 ${n}개 진행 중 ${w}.png` })
      await page.context().close()
    }
    await call(admin, 'POST', `/api/admin/items/${item}/close`)
    for (const [w, h] of [[1920, 1080], [1366, 768]]) {
      const page = await (await b.newContext({ viewport: { width: w, height: h }, locale: 'ko-KR' })).newPage()
      await page.goto(`${base}/screen/${s.room.code}?k=${s.admin.screenKey}`)
      await page.waitForTimeout(1800)
      const m = await page.evaluate(() => { const t = document.querySelector('h1, h2, .sc-title'); const r = t?.getBoundingClientRect(); return { title: t?.textContent?.slice(0, 12), top: r && Math.round(r.top), docH: document.documentElement.scrollHeight, viewH: innerHeight, scrollY: Math.round(scrollY) } })
      console.log(`${live ? '실시간' : '보통'} ${n}개 ${w}x${h} 결과:`, JSON.stringify(m))
      await page.screenshot({ path: `${out}/${tag} - 큰 화면 ${live ? '실시간 ' : ''}선택지 ${n}개 결과 ${w}.png` })
      await page.context().close()
    }
  }
  // 방이 끝난 뒤의 ‘모든 결과 정리’ (주제 14개) · 지켜보기의 큰 화면 모드 (선택지 30개)
  {
    const id = (await call(admin, 'POST', '/api/admin/rooms', { title: '큰 화면 주제 14개 정리 시험', mode: 'simple', seconds: 120 })).data.id
    ids.push(id)
    const path = `/api/admin/rooms/${id}`
    const s = (await call(admin, 'GET', path)).data
    const voters = []
    for (let i = 0; i < 12; i++) voters.push((await call('', 'POST', '/api/join', { room: s.room.code })).cookie)
    for (let k = 0; k < 14; k++) {
      const n = k === 13 ? 30 : 3
      const item = (await call(admin, 'POST', `${path}/items`, { title: `${k + 1}번째 주제: 조금 긴 제목이 들어와도 한 줄에 잘 들어가는지 봐요`, options: Array.from({ length: n }, (_, i) => `${i + 1}번 선택지 이름`), ...(k % 3 === 0 && n === 3 ? { rule: 'majority' } : {}) })).data.id
      await call(admin, 'POST', `/api/admin/items/${item}/open`)
      const opts = (await call(admin, 'GET', path)).data.items[k].options
      for (let i = 0; i < 12; i++) await call(voters[i], 'POST', '/api/vote', { item, options: [opts[(i + k) % n].id] })
      await call(admin, 'POST', `/api/admin/items/${item}/close`).catch(() => {})
    }
    for (const [w, h] of [[1440, 900], [390, 844]]) {
      const ctx = await b.newContext({ viewport: { width: w, height: h }, locale: 'ko-KR', isMobile: w < 500 })
      await ctx.addInitScript(() => localStorage.setItem('mypick-watch-big', '1'))
      const page = await ctx.newPage()
      await page.goto(`${base}/observe/${s.room.code}?k=${s.admin.observerKey}`)
      await page.waitForTimeout(1500)
      console.log(`지켜보기 큰 화면 모드 ${w}: 옆으로 넘침 ${await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)}px · 큰 화면 모드 ${await page.evaluate(() => document.documentElement.dataset.big ?? '꺼짐')}`)
      await page.screenshot({ path: `${out}/${tag} - 지켜보기 큰 화면 모드 선택지 30개 ${w}.png` })
      await ctx.close()
    }
    await call(admin, 'POST', `${path}/close`)
    for (const [w, h] of [[1920, 1080], [1366, 768]]) {
      const page = await (await b.newContext({ viewport: { width: w, height: h }, locale: 'ko-KR' })).newPage()
      await page.goto(`${base}/screen/${s.room.code}?k=${s.admin.screenKey}`)
      await page.waitForTimeout(1500)
      const m = await page.evaluate(() => ({ docH: document.documentElement.scrollHeight, viewH: innerHeight, over: document.documentElement.scrollWidth - innerWidth, rows: document.querySelectorAll('.final li').length }))
      console.log(`방이 끝난 뒤 정리 ${w}x${h}:`, JSON.stringify(m))
      await page.screenshot({ path: `${out}/${tag} - 큰 화면 방이 끝난 뒤 정리 주제 14개 ${w}.png` })
      await page.context().close()
    }
  }
} finally { for (const id of ids) await call(admin, 'DELETE', `/api/admin/rooms/${id}`); await b.close() }
