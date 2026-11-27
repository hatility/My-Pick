// 1000명 · 방 5개 동시 진행: 방마다 200명, 관리자 5명 + 공동 진행자 1명이 같은 방을 함께 다뤄요.
// 여러 관리자가 같은 버튼을 동시에 누를 때(경합)도 결과가 하나로 맞는지, 지켜보기 화면과 사이트의 모든 화면이 그동안 멀쩡한지 봐요.
// 끝나면 방 · 임시 관리자 계정을 지워요.
import { chromium } from 'playwright-core'
import { mkdirSync, writeFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'

const base = process.env.DRILL_URL || 'http://localhost:8082'
const out = '../docs/스크린샷/1000명 시험'
mkdirSync(out, { recursive: true })
const { ADMIN_ID = 'admin', ADMIN_PASSWORD } = process.env
if (!ADMIN_PASSWORD) throw new Error('.env 에 ADMIN_PASSWORD 가 있어야 해요')
const PER = 200
const PREFIX = '1000명 시험'
const MEMO = '3번 관리자가 쓴 비밀 메모'
const H = { 'X-Requested-With': 'mypick', 'Content-Type': 'application/json' }
async function call(cookie, method, path, body) {
  const t = performance.now()
  const res = await fetch(base + path, { method, headers: { ...(method === 'GET' ? {} : H), cookie: cookie || '' }, body: body === undefined ? undefined : JSON.stringify(body) })
  const set = res.headers.get('set-cookie')
  const data = (res.headers.get('content-type') || '').includes('json') ? await res.json().catch(() => null) : await res.text()
  return { status: res.status, data, cookie: set ? set.split(';')[0] : cookie, ms: performance.now() - t }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const pct = (list, p) => Math.round([...list].sort((a, b) => a - b)[Math.min(list.length - 1, Math.floor(list.length * p))])
const problems = []
let passed = 0
const check = (label, cond, detail = '') => {
  if (cond) passed++
  else problems.push(`${label}${detail ? ` → ${detail}` : ''}`)
  console.log(`${cond ? '  ✓' : '  ✗'} ${label}${cond || !detail ? '' : ` → ${detail}`}`)
  return cond
}
const ok = (rs) => rs.filter((r) => r.status === 200).length
/** 응답 어디에 있든 id 가 같은 것을 찾아요 */
const find = (node, id) => {
  if (!node || typeof node !== 'object') return null
  if (!Array.isArray(node) && node.id === id && Array.isArray(node.options)) return node
  for (const v of Object.values(node)) {
    const hit = find(v, id)
    if (hit) return hit
  }
  return null
}

const top = (await call('', 'POST', '/api/admin/login', { id: ADMIN_ID, password: ADMIN_PASSWORD })).cookie
if (!top) throw new Error('관리자 로그인이 안 돼요')
const rooms = []
const aborts = []
const joinMs = []
const voteMs = []
const photos = []
const consoleErrors = []
let b
try {
  console.log('■ 관리자 5명 만들기')
  const pw = randomBytes(12).toString('hex')
  for (let i = 1; i <= 5; i++) await call(top, 'POST', '/api/admin/admins', { name: `drill-admin-${i}`, password: pw })
  const mgr = []
  for (let i = 1; i <= 5; i++) mgr.push((await call('', 'POST', '/api/admin/login', { id: `drill-admin-${i}`, password: pw })).cookie)
  check('임시 관리자 5명이 로그인돼요', mgr.every((c) => c && c.startsWith('mp_admin=')))
  check('일반 관리자는 관리자를 더할 수 없어요 (403)', (await call(mgr[0], 'POST', '/api/admin/admins', { name: 'drill-x', password: pw })).status === 403)

  const KINDS = [
    { name: '엄격 방식 (입장 코드)', body: { mode: 'strict' } },
    { name: '간편 방식 + 비밀번호', body: { mode: 'simple', password: 'room-pass-1' } },
    { name: '간편 방식 + 정원 200', body: { mode: 'simple', capacity: PER } },
    { name: '실시간 공개 + 쉬운 말', body: { mode: 'simple', live: true, easy: true } },
    { name: '엄격 방식 + 비밀번호', body: { mode: 'strict', password: 'room-pass-5' } },
  ]

  /** 방 하나를 처음부터 끝까지 */
  async function runRoom(k) {
    const kind = KINDS[k]
    const tag = `[방 ${k + 1}]`
    const c = (label, cond, detail) => check(`${tag} ${label}`, cond, detail)
    const made = await call(mgr[k], 'POST', '/api/admin/rooms', { title: `${PREFIX} ${k + 1} · ${kind.name}`, seconds: 90, grace: 5, closeAll: true, ...kind.body })
    const id = made.data.id
    const R = { id, k }
    rooms.push(R)
    const path = `/api/admin/rooms/${id}`
    const state = async (who = mgr[0]) => (await call(who, 'GET', path)).data
    const itemOf = async (iid) => (await state()).items.find((i) => i.id === iid)
    const s0 = await state()
    R.code = s0.room.code
    R.screenKey = s0.admin.screenKey
    R.observerKey = s0.admin.observerKey
    const watch = async () => call('', 'GET', `/api/observe?room=${R.code}&k=${R.observerKey}`)
    // 관리자 다섯이 나눠서 준비: 주제 · 공동 진행자 · 큰 화면 · 색 · 코드
    const defs = [
      { title: `${k + 1}-가. 수학여행을 가을로 옮길까요?`, options: ['좋아요', '아니에요'], rule: 'majority', seconds: 90 },
      { title: `${k + 1}-나. 급식 메뉴를 두 개까지 골라 주세요`, options: ['비빔밥', '돈가스', '떡볶이', '카레', '국수'], maxPick: 2, shuffle: true, seconds: 90 },
      { title: `${k + 1}-다. 반 이름표 색`, options: ['파랑', '초록', '노랑'], seconds: 90 },
      { title: `${k + 1}-라. 빠르게: 자리 바꾸기를 할까요?`, options: ['해요', '안 해요'], rule: 'two_thirds', basis: 'joined', seconds: 10 },
      { title: `${k + 1}-마. 지울 주제`, options: ['가', '나'] },
    ]
    const added = await Promise.all(defs.map((d, i) => call(mgr[i], 'POST', `${path}/items`, d)))
    c('관리자 5명이 동시에 주제를 하나씩 더해요', ok(added) === 5 && (await state()).items.length === 5)
    const [A, B, C, D, E] = added.map((r) => r.data.id)
    const prep = await Promise.all([
      call(mgr[0], 'POST', `${path}/cohost`, { password: `cohost-${k}-pass` }),
      call(mgr[1], 'POST', `${path}/screen`, { mode: 'notice', notice: `${k + 1}번 방 곧 시작해요` }),
      call(mgr[2], 'POST', `${path}/logo?tone=${['blue', 'green', 'purple', 'orange', 'pink'][k]}`),
      call(mgr[3], 'POST', `/api/admin/items/${A}/memo`, { memo: MEMO }),
      call(mgr[4], 'DELETE', `/api/admin/items/${E}`),
      ...(kind.body.mode === 'strict' ? [call(mgr[4], 'POST', `${path}/codes`, { count: PER + 5 })] : []),
    ])
    c('관리자 5명이 동시에 준비 (공동 진행자 · 공지 · 색 · 메모 · 주제 지우기 · 코드)', prep.every((r) => r.status === 200), prep.map((r) => r.status).join())
    // 같은 주제를 5명이 동시에 고쳐요: 마지막에 저장된 하나로 온전히 남아야 해요
    const edits = await Promise.all(mgr.map((m, i) => call(m, 'PUT', `/api/admin/items/${C}`, { title: `${k + 1}-다. 반 이름표 색 (고침 ${i})`, options: ['파랑', '초록', '노랑'].map((x) => `${x}${i}`), seconds: 90 })))
    const cNow = await itemOf(C)
    const who = cNow.title.match(/고침 (\d)/)?.[1]
    c('5명이 같은 주제를 동시에 고쳐도 한 사람 것으로 온전히 남아요', ok(edits) === 5 && cNow.options.length === 3 && cNow.options.every((o) => o.label.endsWith(who)), `${cNow.title} / ${cNow.options.map((o) => o.label).join()}`)
    const co = await call('', 'POST', '/api/host/login', { room: R.code, hostPassword: `cohost-${k}-pass` })
    c('공동 진행자 로그인', co.status === 200 && co.data.role === 'cohost')
    R.cohost = co.cookie
    const all6 = [...mgr, co.cookie]
    await call(mgr[1], 'POST', `${path}/screen`, { mode: 'auto' })

    // 200명 입장
    const codes = kind.body.mode === 'strict' ? (await call(mgr[0], 'GET', `${path}/codes`)).data.codes.map((x) => x.code) : []
    const voters = []
    for (let i = 0; i < PER; i += 40) {
      const batch = await Promise.all(Array.from({ length: Math.min(40, PER - i) }, (_, j) => call('', 'POST', '/api/join', { room: R.code, password: kind.body.password, entryCode: codes[i + j] })))
      for (const r of batch) {
        if (r.status !== 200) problems.push(`${tag} 입장 실패 ${r.status} ${JSON.stringify(r.data)}`)
        else voters.push({ cookie: r.cookie })
        joinMs.push(r.ms)
      }
    }
    await Promise.all(
      voters.map(async (v) => {
        v.ctrl = new AbortController()
        aborts.push(v.ctrl)
        const res = await fetch(`${base}/api/events?room=${R.code}`, { headers: { cookie: v.cookie }, signal: v.ctrl.signal })
        if (res.status !== 200) problems.push(`${tag} 실시간 연결 실패 ${res.status}`)
        ;(async () => {
          try {
            for await (const _ of res.body);
          } catch {
            /* 끊을 때 */
          }
        })()
      }),
    )
    await sleep(500)
    let s = await state()
    c(`${PER}명 입장 · 모두 접속`, s.joined === PER && s.present === PER, `들어온 ${s.joined} · 접속 ${s.present}`)
    if (kind.body.capacity) c('정원이 차면 201번째는 못 들어와요 (403)', (await call('', 'POST', '/api/join', { room: R.code })).status === 403)
    if (kind.body.password) c('비밀번호가 틀리면 못 들어와요 (401)', (await call('', 'POST', '/api/join', { room: R.code, password: 'wrong-pass', entryCode: codes[PER] })).status === 401)
    R.voters = voters
    // 지켜보기 (진행 전): 사람 수가 같고, 지켜보는 연결은 참여자로 세지 않아요
    const obCtrl = new AbortController()
    aborts.push(obCtrl)
    const obStream = await fetch(`${base}/api/events?room=${R.code}&k=${R.observerKey}`, { signal: obCtrl.signal })
    let w = await watch()
    s = await state()
    c('지켜보기: 실시간 연결이 되고, 지켜보는 사람은 참여자 수에 안 들어가요', obStream.status === 200 && w.status === 200 && s.joined === PER && s.present === PER, `연결 ${obStream.status} · 자료 ${w.status} · 접속 ${s.present}`)
    c('지켜보기 열쇠로는 큰 화면 자료 · 관리 기능을 못 써요 (403 · 401)', (await call('', 'GET', `/api/screen?room=${R.code}&k=${R.observerKey}`)).status === 403 && (await call('', 'GET', path)).status === 401)

    /** 픽: plan(i) → 번호 배열 · [] · null. 실제로 받아들여진 것만 세요 */
    async function vote(iid, plan, spread = 2000) {
      const opts = (await itemOf(iid)).options
      const want = opts.map(() => 0)
      let done = 0
      let skipped = 0
      let refused = 0
      await Promise.all(
        voters.map(async (v, i) => {
          const picks = plan(i)
          if (picks === null) return
          await sleep(Math.random() * spread)
          const r = await call(v.cookie, 'POST', '/api/vote', { item: iid, options: picks.map((x) => opts[x].id) })
          voteMs.push(r.ms)
          if (r.status === 200) {
            done++
            if (!picks.length) skipped++
            else picks.forEach((x) => want[x]++)
          } else if (r.status === 409) refused++
          else problems.push(`${tag} 픽 오류 ${r.status} ${JSON.stringify(r.data)}`)
        }),
      )
      return { want, done, skipped, refused }
    }
    const waitClosed = async (iid, ms = 15000) => {
      const until = Date.now() + ms
      let it
      while (Date.now() < until) {
        it = await itemOf(iid)
        if (it.status === 'closed') return it
        await sleep(250)
      }
      return it
    }
    const same = (it, exp, label) => c(`${label}: 받은 픽 ${exp.want.join(' / ')} · 픽한 사람 ${exp.done} · 건너뜀 ${exp.skipped} 이 정확해요`, it.options.map((o) => o.votes).join() === exp.want.join() && it.voted === exp.done && it.abstain === exp.skipped, `서버 ${it.options.map((o) => o.votes).join(' / ')} · ${it.voted} · ${it.abstain}`)

    // ── 가: 6명이 동시에 서로 다른 주제를 열어요 → 하나만 열려야 해요
    const openRace = await Promise.all(all6.map((m, i) => call(m, 'POST', `/api/admin/items/${[A, B, C, D, A, B][i]}/open`)))
    s = await state()
    const opened = s.items.filter((i) => i.status === 'open')
    c('6명이 동시에 주제를 열어도 하나만 열려요', ok(openRace) === 1 && opened.length === 1, `성공 ${ok(openRace)} · 열린 주제 ${opened.length}`)
    // 열린 것이 무엇이든 가 → 나 → 다 → 라 순서로 진행하려고, 가가 아니면 마감하고 복사해 둬요
    let order = [A, B, C, D]
    if (opened[0] && opened[0].id !== A) {
      await call(mgr[0], 'POST', `/api/admin/items/${opened[0].id}/close`)
      await call(mgr[0], 'POST', `/api/admin/items/${opened[0].id}/copy`)
      const copy = (await state()).items.find((i) => i.status === 'draft' && i.title.endsWith('(다시)'))
      order = order.map((x) => (x === opened[0].id ? copy.id : x))
      await call(mgr[0], 'POST', `/api/admin/items/${order[0]}/open`)
    }
    const [a, bb, cc, d] = order
    // 80명이 픽하는 동안 6명이 동시에 잠깐 멈추기
    const p1 = vote(a, (i) => (i < 80 ? [i % 2] : null), 1500)
    await sleep(600)
    const pauseRace = await Promise.all(all6.map((m) => call(m, 'POST', `/api/admin/items/${a}/pause`)))
    c('6명이 동시에 멈춰도 한 번만 멈춰요', ok(pauseRace) === 1, `성공 ${ok(pauseRace)}`)
    const r1 = await p1
    let cur = await itemOf(a)
    c('멈추기 전까지 받은 픽만 세어져요 (받은 것 + 거절된 것 = 80)', r1.done + r1.refused === 80 && cur.voted === r1.done, `받음 ${r1.done} · 거절 ${r1.refused} · 서버 ${cur.voted}`)
    // 멈춘 동안: 손들기 30명, 6명이 동시에 시간 늘리기 · 손 내리기
    const hands = await Promise.all(voters.slice(100, 130).map((v, i) => call(v.cookie, 'POST', '/api/hand', { kind: i % 2 ? 'question' : 'more' })))
    s = await state(mgr[3])
    c('손들기 30명이 관리자 모두에게 같게 보여요', ok(hands) === 30 && s.hands.question + s.hands.more === 30 && (await state(R.cohost)).hands.question === s.hands.question)
    // 지켜보기 (진행 중 · 멈춤): 관리자와 같은 숫자, 숨겨야 할 것은 안 보여요
    w = await watch()
    const wi = find(w.data, a)
    const raw = JSON.stringify(w.data)
    c('지켜보기 (진행 중): 픽한 사람 수 · 멈춤 표시가 관리자 화면과 같아요', !!wi && wi.voted === cur.voted && wi.paused === true && wi.status === 'open', JSON.stringify(wi && { v: wi.voted, p: wi.paused, s: wi.status }))
    c(`지켜보기 (진행 중): 받은 픽은 ${kind.body.live ? '실시간 공개 방이라 보여요' : '마감 전이라 안 보여요'}`, !!wi && (kind.body.live ? wi.options.reduce((n, o) => n + (o.votes ?? 0), 0) === cur.voted : wi.options.every((o) => o.votes === undefined)), JSON.stringify(wi?.options))
    c('지켜보기: 진행자 메모 · 든 손 · 관리 열쇠 · 준비 중인 주제는 안 보여요', !raw.includes(MEMO) && !raw.includes(R.screenKey) && !raw.includes('"hands"') && !(w.data.items ?? []).some((x) => x.status === 'draft') && w.data.items.length === s.items.filter((x) => x.status !== 'draft').length, raw.includes(MEMO) ? '메모가 보여요' : raw.includes(R.screenKey) ? '큰 화면 열쇠가 보여요' : raw.includes('"hands"') ? '든 손이 보여요' : '준비 중인 주제가 보여요')
    const left0 = cur.pausedLeft
    const ext = await Promise.all(all6.map((m) => call(m, 'POST', `/api/admin/items/${a}/extend`, { seconds: 10 })))
    cur = await itemOf(a)
    c('멈춘 동안 6명이 10초씩 늘리면 정확히 60초 늘어요', ok(ext) === 6 && cur.pausedLeft - left0 === 60000, `${cur.pausedLeft - left0}ms`)
    await Promise.all(all6.map((m) => call(m, 'DELETE', `${path}/hands`)))
    c('손 내리기', (await state()).hands.question === 0)
    R.hold = true // 사진 찍을 틈 (멈춘 상태)
    await sleep(k === 0 ? 9000 : 3000)
    const resumeRace = await Promise.all(all6.map((m) => call(m, 'POST', `/api/admin/items/${a}/resume`)))
    c('6명이 동시에 다시 시작해도 한 번만', ok(resumeRace) === 1, `성공 ${ok(resumeRace)}`)
    const nudge = await Promise.all(all6.map((m) => call(m, 'POST', `/api/admin/items/${a}/nudge`)))
    c('6명이 동시에 독려해도 알림은 한 번만', ok(nudge) === 1, `성공 ${ok(nudge)}`)
    // 멈췄을 때 거절된 사람 + 나머지가 다시 픽 (이미 픽한 사람이 또 누르면 거절돼야 해요)
    const r2 = await vote(a, (i) => [i % 2], 2000)
    let it = await waitClosed(a)
    c('모두 픽하면 저절로 마감', it.status === 'closed' && it.reason === '모두 픽함', `${it.status} ${it.reason}`)
    c('두 번째 시도에서 이미 픽한 사람은 모두 거절돼요', r2.refused === r1.done && r1.done + r2.done === PER, `거절 ${r2.refused} · 첫 번째 ${r1.done} · 두 번째 ${r2.done}`)
    same(it, { want: r1.want.map((n, i) => n + r2.want[i]), done: r1.done + r2.done, skipped: 0 }, '가')
    c('가: 100 / 200 은 절반을 넘지 않아 통과 못 함', it.outcome === 'fail', String(it.outcome))
    // 지켜보기 (마감 뒤): 결과 · 확인 코드가 관리자와 같아요
    w = await watch()
    const wc = find(w.data, a)
    c('지켜보기 (마감 뒤): 결과 숫자 · 확인 코드 · 통과 여부가 관리자 화면과 같아요', !!wc && wc.options.map((o) => o.votes).join() === it.options.map((o) => o.votes).join() && wc.proof === it.proof && wc.outcome === it.outcome && wc.voted === it.voted, JSON.stringify(wc && { o: wc.options.map((o) => o.votes), p: wc.proof }))

    // ── 나: 여러 개 고르기. 한창 픽이 들어오는 중에 6명이 동시에 마감
    await call(R.cohost, 'POST', `/api/admin/items/${bb}/open`)
    const p2 = vote(bb, (i) => (i % 9 === 0 ? [] : i % 2 ? [i % 5, (i + 1) % 5] : [i % 5]), 3000)
    await sleep(1500)
    const closeRace = await Promise.all(all6.map((m) => call(m, 'POST', `/api/admin/items/${bb}/close`)))
    c('6명이 동시에 마감해도 한 번만 마감돼요', ok(closeRace) === 1, `성공 ${ok(closeRace)}`)
    const r3 = await p2
    it = await itemOf(bb)
    c('마감 순간에 걸친 픽: 받은 것 + 거절된 것 = 200 (사라진 것 없음)', r3.done + r3.refused === PER, `받음 ${r3.done} · 거절 ${r3.refused}`)
    same(it, r3, '나 (마감 경합)')

    // ── 다: 동점 → 6명이 동시에 동점 가리기
    await call(mgr[2], 'POST', `/api/admin/items/${cc}/open`)
    const r4 = await vote(cc, (i) => [i < 80 ? 0 : i < 160 ? 1 : 2], 1500)
    it = await waitClosed(cc)
    same(it, r4, '다 (동점 80 / 80 / 40)')
    const runRace = await Promise.all(all6.map((m) => call(m, 'POST', `/api/admin/items/${cc}/runoff`)))
    const runs = (await state()).items.filter((i) => i.title.includes('동점 가리기'))
    c('6명이 동시에 ‘동점 가리기’ 를 눌러도 주제는 하나만 생겨요', runs.length === 1 && ok(runRace) === 1, `생긴 주제 ${runs.length}개 (성공 응답 ${ok(runRace)})`)
    for (const x of runs.slice(1)) await call(mgr[0], 'DELETE', `/api/admin/items/${x.id}`)
    // 5명이 동시에 서로 다른 순서를 보내요
    const drafts = (await state()).items.filter((i) => i.status === 'draft').map((i) => i.id)
    const orders = await Promise.all(mgr.map((m, i) => call(m, 'POST', `${path}/order`, { ids: i % 2 ? [...drafts].reverse() : drafts })))
    const after = (await state()).items.filter((i) => i.status === 'draft').map((i) => i.id)
    c('5명이 동시에 순서를 바꿔도 주제가 빠지거나 겹치지 않아요', ok(orders) === 5 && [...after].sort().join() === [...drafts].sort().join())
    await call(mgr[4], 'POST', `/api/admin/items/${runs[0].id}/open`)
    const r5 = await vote(runs[0].id, (i) => [i < 101 ? 0 : 1], 1500)
    it = await waitClosed(runs[0].id)
    same(it, r5, '동점 가리기')

    // ── 라: 10초 제한 · 3분의 2 (들어온 사람 기준). 120명만 픽
    await call(mgr[1], 'POST', `/api/admin/items/${d}/open`)
    const r6 = await vote(d, (i) => (i >= 120 ? null : [i < 110 ? 0 : 1]), 3000)
    it = await waitClosed(d, 16000)
    c('시간이 끝나 마감', it.reason === '시간이 끝남', it.reason)
    same(it, r6, '라')
    c('라: 110 / 들어온 200명 → 3분의 2 가 안 돼 통과 못 함', it.outcome === 'fail', String(it.outcome))
    // 확인 요청 5건 → 지켜보기에는 건수만
    await Promise.all(voters.slice(0, 5).map((v, i) => call(v.cookie, 'POST', '/api/object', { item: d, note: `시험 확인 요청 내용 ${i}번` })))
    w = await watch()
    c('지켜보기: 확인 요청은 건수만 보이고 내용은 안 보여요', find(w.data, d)?.objections === 5 && !JSON.stringify(w.data).includes('시험 확인 요청 내용'), `건수 ${find(w.data, d)?.objections}`)

    R.closed = (await state()).items.filter((i) => i.status === 'closed')
    R.state = state
    R.path = path
    R.all6 = all6
    R.watch = watch
  }

  console.log('■ 방 5개 동시에 진행 (방마다 200명 · 관리자 5명 + 공동 진행자)')
  b = await chromium.launch({ channel: 'chrome' })
  const t0 = performance.now()
  const running = Promise.all(KINDS.map((_, k) => runRoom(k).catch((e) => problems.push(`[방 ${k + 1}] 멈춤: ${e.stack?.split('\n').slice(0, 2).join(' | ')}`))))
  const shot = async (page, name, wait = 1000, fullPage = false) => {
    await page.waitForTimeout(wait)
    const file = `${String(photos.length + 1).padStart(2, '0')} ${name}.png`
    await page.screenshot({ path: `${out}/${file}`, fullPage }).then(() => photos.push(file), () => {})
  }
  const ctxOf = async (name, options, cookies = []) => {
    const ctx = await b.newContext({ locale: 'ko-KR', ...options })
    if (cookies.length) await ctx.addCookies(cookies)
    const page = await ctx.newPage()
    page.on('pageerror', (e) => consoleErrors.push(`${name}: 화면 오류 ${String(e.message).slice(0, 140)}`))
    page.on('console', (m) => {
      if (m.type() === 'error' && !/401|vibrate/.test(m.text())) consoleErrors.push(`${name}: ${m.text().slice(0, 140)}`)
    })
    return page
  }
  const ap = await ctxOf('관리자', { viewport: { width: 1440, height: 900 } }, [{ name: 'mp_admin', value: top.split('=')[1], url: base }])
  const tv = await ctxOf('큰 화면', { viewport: { width: 1920, height: 1080 } })
  const ob = await ctxOf('지켜보기 PC', { viewport: { width: 1440, height: 900 } })
  const obPhone = await ctxOf('지켜보기 휴대폰', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 })
  // 방 1 이 ‘멈춤’ 에 들어갈 때까지 기다렸다가 찍어요
  for (let i = 0; i < 80 && !rooms.find((r) => r.k === 0)?.hold; i++) await sleep(250)
  const first = rooms.find((r) => r.k === 0)
  await Promise.all([ob.goto(`${base}/observe/${first.code}?k=${first.observerKey}`), obPhone.goto(`${base}/observe/${first.code}?k=${first.observerKey}`), tv.goto(`${base}/screen/${first.code}?k=${first.screenKey}`), ap.goto(`${base}/admin#room-${first.id}`)])
  await shot(ob, '지켜보기 - 방 1 진행 중 (PC)', 1500, true)
  await shot(obPhone, '지켜보기 - 방 1 진행 중 (휴대폰)', 300, true)
  for (const [p, n] of [[ob, '지켜보기 PC'], [obPhone, '지켜보기 휴대폰']]) {
    const over = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth)
    check(`${n}: 옆으로 넘치지 않아요`, over <= 1, `${over}px`)
    const hasControls = await p.locator('button', { hasText: /픽하기|지금 마감|픽 열기|다시 시작/ }).count()
    check(`${n}: 고르거나 조작하는 버튼이 없어요`, hasControls === 0, `${hasControls}개`)
  }
  await shot(tv, '큰 화면 - 방 1 진행 중 (잠깐 멈춤)', 300)
  await shot(ap, '관리자 - 방 1 진행 화면 (200명)', 300, true)
  // 지켜보기 큰 화면 모드
  await ob.getByRole('button', { name: /큰 화면|크게/ }).first().click({ timeout: 3000 }).catch(() => problems.push('지켜보기: 큰 화면 모드 버튼을 못 찾았어요'))
  await shot(ob, '지켜보기 - 방 1 큰 화면 모드', 800)
  await ap.goto(`${base}/admin`)
  await shot(ap, '관리자 - 한눈에 (방 5개 · 1000명)', 1200, true)
  await ap.locator('.ad-tabs').getByRole('button', { name: '방 목록', exact: true }).click().catch(() => {})
  await shot(ap, '관리자 - 방 목록 (5개 동시 진행)', 1000, true)
  for (const R of [...rooms].sort((x, y) => x.k - y.k).slice(1)) {
    await tv.goto(`${base}/screen/${R.code}?k=${R.screenKey}`)
    await shot(tv, `큰 화면 - 방 ${R.k + 1} 진행 중`, 1200)
  }
  // 1000명이 붙어 있는 동안 사이트의 모든 공개 화면을 PC · 휴대폰으로 열어 봐요
  console.log('■ 진행 중에 사이트 전체 화면 열어 보기')
  const pc = await ctxOf('둘러보기 PC', { viewport: { width: 1280, height: 800 } })
  const ph = await ctxOf('둘러보기 휴대폰', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 })
  const slow = []
  for (const [name, url] of [['첫 화면', '/'], ['모바일 첫 화면', '/m'], ['방 만들기', '/new'], ['방장 들어가기', '/host'], ['가이드', '/guide'], ['소개', '/about'], ['오류 제보', '/feedback'], ['결과 확인', '/verify'], ['이용약관', '/terms'], ['개인정보 처리방침', '/privacy'], ['관리자 로그인', '/admin'], ['없는 주소', '/nowhere']]) {
    for (const [page, dev] of [[pc, 'PC'], [ph, '휴대폰']]) {
      const t = performance.now()
      const res = await page.goto(base + url, { waitUntil: 'networkidle' }).catch(() => null)
      const ms = Math.round(performance.now() - t)
      const text = (await page.locator('body').innerText().catch(() => '')).trim()
      const over = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)
      const want = url === '/nowhere' ? 404 : 200
      if (!(res?.status() === want && text.length > 20 && over <= 1)) problems.push(`${name} (${dev}): 상태 ${res?.status()} · 글자 ${text.length} · 넘침 ${over}px`)
      else passed++
      if (ms > 1500) slow.push(`${name} ${dev} ${ms}ms`)
    }
    await shot(ph, `둘러보기 - ${name} (휴대폰)`, 200)
  }
  check('1000명 진행 중에도 공개 화면 12곳 × 2 가 1.5초 안에 열려요', slow.length === 0, slow.join(', '))
  await running
  console.log(`  (방 5개 진행에 ${Math.round((performance.now() - t0) / 1000)}초)`)

  console.log('■ 끝난 뒤 한꺼번에 확인')
  rooms.sort((x, y) => x.k - y.k)
  const ready = rooms.filter((R) => R.closed)
  check('방 5개가 모두 끝까지 진행됐어요', ready.length === 5, `${ready.length}개`)
  if (ready.length >= 2) {
    const [r1, r2] = ready
    check('다른 방 참여자는 이 방 주제에 픽할 수 없어요 (404)', (await call(r1.voters[0].cookie, 'POST', '/api/vote', { item: r2.closed[0].id, options: [r2.closed[0].options[0].id] })).status === 404)
    check('다른 방 공동 진행자는 이 방을 볼 수도 다룰 수도 없어요 (403)', (await call(r1.cohost, 'GET', r2.path)).status === 403 && (await call(r1.cohost, 'POST', `${r2.path}/lock`, { locked: true })).status === 403)
    check('다른 방 공동 진행자는 이 방 주제를 복사할 수 없어요 (403)', (await call(r1.cohost, 'POST', `/api/admin/items/${r2.closed[0].id}/copy`)).status === 403)
    check('방 1 의 지켜보기 열쇠로 방 2 는 못 봐요 (403)', (await call('', 'GET', `/api/observe?room=${r2.code}&k=${r1.observerKey}`)).status === 403)
  }
  let proofs = 0
  let bad = 0
  for (const R of ready)
    for (const it of R.closed) {
      const v = await call('', 'GET', `/api/verify?code=${it.proof}`)
      proofs++
      if (!(v.status === 200 && v.data.same && v.data.logged && v.data.voted === it.voted)) bad++
    }
  check(`마감된 주제 ${proofs}개 모두 결과 확인 코드로 맞게 확인돼요`, proofs > 0 && bad === 0, `어긋난 것 ${bad}개`)
  check('결과 확인 코드가 모두 달라요', new Set(ready.flatMap((R) => R.closed.map((i) => i.proof))).size === proofs)
  const au = await call(top, 'GET', '/api/admin/audit')
  check('기록이 처음부터 끝까지 이어져 있어요 (여러 명이 동시에 써도 깨지지 않음)', au.data?.intact === true)
  await ob.goto(`${base}/observe/${ready[0].code}?k=${ready[0].observerKey}`)
  await shot(ob, '지켜보기 - 방 1 모든 결과와 기록 (PC)', 1500, true)
  await obPhone.goto(`${base}/observe/${ready[0].code}?k=${ready[0].observerKey}`)
  await shot(obPhone, '지켜보기 - 방 1 모든 결과 (휴대폰)', 1200, true)
  const obText = await ob.locator('body').innerText()
  check('지켜보기 화면에 마감된 주제 제목이 모두 보여요', ready[0].closed.every((i) => obText.includes(i.title.slice(0, 12))), ready[0].closed.filter((i) => !obText.includes(i.title.slice(0, 12))).map((i) => i.title).join(' / '))
  check('지켜보기 화면에 진행자 메모는 안 보여요', !obText.includes(MEMO))
  // 끝내기: 방마다 6명이 동시에 입장 마감 · 방 끝내기
  for (const R of ready) {
    const lock = await Promise.all(R.all6.map((m) => call(m, 'POST', `${R.path}/lock`, { locked: true })))
    const end = await Promise.all(R.all6.map((m) => call(m, 'POST', `${R.path}/close`)))
    const s = await R.state()
    check(`[방 ${R.k + 1}] 6명이 동시에 끝내기: 방이 끝나고 공동 진행자만 거절돼요`, ok(lock) === 6 && ok(end) === 5 && end[5].status === 403 && s.room.closed === true && s.joined === PER, `마감 ${ok(lock)} · 끝내기 ${ok(end)} · 공동 ${end[5].status}`)
    check(`[방 ${R.k + 1}] 방이 끝난 뒤에도 지켜보기로 결과를 볼 수 있어요`, (await R.watch()).status === 200)
  }
  check('서버 상태 정상 (healthz)', (await call('', 'GET', '/healthz')).status === 200)
  await tv.goto(`${base}/screen/${ready[1]?.code}?k=${ready[1]?.screenKey}`)
  await shot(tv, '큰 화면 - 방 2 끝난 뒤', 1500)
  await ap.goto(`${base}/admin#room-${ready[0].id}`)
  await shot(ap, '관리자 - 방 1 모든 결과', 1500, true)
  await ap.goto(`${base}/admin`)
  await ap.locator('.ad-tabs').getByRole('button', { name: '기록', exact: true }).click().catch(() => {})
  await shot(ap, '관리자 - 기록 (여러 관리자가 한 일)', 1500)
  await ap.locator('.ad-tabs').getByRole('button', { name: '통계', exact: true }).click().catch(() => {})
  await shot(ap, '관리자 - 통계', 1200, true)
} catch (e) {
  problems.push(`시험이 멈췄어요: ${e.stack?.split('\n').slice(0, 3).join(' | ')}`)
} finally {
  aborts.forEach((a) => a.abort())
  for (const R of rooms) await call(top, 'DELETE', `/api/admin/rooms/${R.id}`)
  const list = (await call(top, 'GET', '/api/admin/admins')).data?.admins ?? []
  for (const a of list.filter((x) => x.name.startsWith('drill-'))) await call(top, 'DELETE', `/api/admin/admins/${a.id}`)
  const leftRooms = JSON.stringify((await call(top, 'GET', '/api/admin/rooms')).data).includes(PREFIX)
  const leftAdmins = ((await call(top, 'GET', '/api/admin/admins')).data?.admins ?? []).some((x) => x.name.startsWith('drill-'))
  console.log(leftRooms || leftAdmins ? '  ✗ 시험용 방이나 계정이 남아 있어요' : '  ✓ 시험용 방 5개 · 임시 관리자 5명을 지웠어요')
  await b?.close()
}
const uniq = [...new Set(consoleErrors)]
const timing = { join: `입장 ${joinMs.length}번: 가운데값 ${pct(joinMs, 0.5)}ms · 느린 쪽 95% ${pct(joinMs, 0.95)}ms · 가장 느린 ${Math.round(Math.max(...joinMs))}ms`, vote: `픽 요청 ${voteMs.length}번: 가운데값 ${pct(voteMs, 0.5)}ms · 느린 쪽 95% ${pct(voteMs, 0.95)}ms · 가장 느린 ${Math.round(Math.max(...voteMs))}ms` }
writeFileSync(`${out}/시험 결과.json`, JSON.stringify({ passed, problems, consoleErrors: uniq, timing, photos }, null, 2))
console.log(`\n══ 결과: 확인 ${passed + problems.length}개 중 통과 ${passed} · 문제 ${problems.length}`)
for (const p of problems) console.log(`  ✗ ${p}`)
console.log(`브라우저 콘솔 오류 ${uniq.length}가지`)
for (const e of uniq.slice(0, 15)) console.log(`  · ${e}`)
console.log(`속도: ${timing.join}\n      ${timing.vote}\n사진 ${photos.length}장 → ${out}`)
