// 카카오톡 · 메신저 미리보기 그림(public/og.png, 1200×630)을 만들어요. 도커를 켠 뒤: npm run og
// 실제 첫 화면의 그림 · 글꼴 · 색을 그대로 써요. 카카오톡은 가운데를 2:1 로 잘라 쓰니 위아래 15px 은 비워 둬요.
import { chromium } from 'playwright-core'
const base = process.env.DRILL_URL || 'http://localhost:8082'
const b = await chromium.launch({ channel: 'chrome' })
const p = await (await b.newContext({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1, bypassCSP: true })).newPage()
await p.goto(`${base}/?pc=1`, { waitUntil: 'networkidle' })
await p.waitForSelector('.art')
await p.evaluate(() => {
  const art = document.querySelector('.art').cloneNode(true)
  const root = document.createElement('div')
  root.innerHTML = `<style>
    #og { position: fixed; inset: 0; z-index: 99999; display: flex; align-items: center; justify-content: space-between; gap: 40px; padding: 0 90px; background: radial-gradient(var(--dot) 1.5px, transparent 2px) 0 0 / 26px 26px var(--paper); color: var(--ink); font-family: var(--font); }
    #og .mark { display: flex; align-items: center; gap: 18px; }
    #og .mark svg { width: 84px; height: 84px; fill: none; stroke: var(--stamp); stroke-width: 4.5; stroke-linecap: round; }
    #og h1 { margin: 0; font-size: 104px; font-weight: 800; letter-spacing: -0.03em; line-height: 1; }
    #og p { margin: 34px 0 0; font-size: 40px; font-weight: 600; line-height: 1.4; color: var(--mute); letter-spacing: -0.01em; }
    #og .art { width: 430px; max-width: none; flex: none; }
    #og .art, #og .art * { animation: none !important; transition: none !important; }
  </style>
  <div id="og"><div><div class="mark"><svg viewBox="0 0 48 48"><circle cx="24" cy="24" r="19"/><path d="M15 24.5l6.5 6.5L33.5 17.5" stroke-linejoin="round"/></svg><h1>My Pick</h1></div><p>방 번호 하나로 모여<br/>함께 고르고, 결과를 같이 봐요</p></div></div>`
  root.querySelector('#og').append(art)
  document.body.append(root)
})
await p.evaluate(() => document.fonts.ready)
await p.waitForTimeout(300)
await p.screenshot({ path: 'public/og.png' })
await b.close()
console.log('✓ public/og.png 을 만들었어요')
