// 화면 곳곳에서 같이 쓰는 작은 도구: 확인 창 · 알림 · 시간 읽기 · 기록 풀어 쓰기.
// 확인 창은 브라우저 기본 창(confirm) 대신 이 사이트의 모양으로 띄워요 (휴대폰에서 주소가 찍힌 회색 창이 뜨지 않게).

/** 화면 안의 확인 창. 첫 줄은 질문, 나머지 줄은 풀이. 누르면 true, 취소 · Esc · 바깥을 누르면 false */
export function ask(message: string, { ok = '확인', danger = false }: { ok?: string; danger?: boolean } = {}): Promise<boolean> {
  // 화면 안 확인 창을 못 띄우는 오래된 브라우저(아이폰 iOS 15.3 이하 등)는 예전 기본 창으로 (단추가 아무 일도 안 하는 일이 없게)
  if (typeof HTMLDialogElement !== 'function' || !('showModal' in HTMLDialogElement.prototype)) return Promise.resolve(window.confirm(message))
  return new Promise((done) => {
    const [head, ...rest] = message.split('\n')
    const d = document.createElement('dialog')
    d.className = 'ask'
    d.setAttribute('aria-labelledby', 'ask-q')
    const q = document.createElement('p')
    q.className = 'ask-q'
    q.id = 'ask-q'
    q.textContent = head
    d.append(q)
    if (rest.length) {
      const note = document.createElement('p')
      note.className = 'ask-note'
      note.textContent = rest.join(' ')
      d.append(note)
    }
    const row = document.createElement('div')
    row.className = 'actions'
    const no = document.createElement('button')
    no.type = 'button'
    no.className = 'btn'
    no.textContent = '취소'
    const yes = document.createElement('button')
    yes.type = 'button'
    yes.className = `btn ${danger ? 'btn-danger-solid' : 'btn-primary'} ask-ok`
    yes.textContent = ok
    row.append(no, yes)
    d.append(row)
    let settled = false
    const end = (v: boolean) => {
      if (settled) return
      settled = true
      d.close()
      d.remove()
      done(v)
    }
    no.addEventListener('click', () => end(false))
    yes.addEventListener('click', () => end(true))
    d.addEventListener('cancel', (e) => (e.preventDefault(), end(false))) // Esc
    d.addEventListener('click', (e) => e.target === d && end(false)) // 바깥(어두운 곳)을 누르면 취소
    document.body.append(d)
    d.showModal()
    ;(danger ? no : yes).focus() // 지우는 일은 ‘취소’에 먼저 손이 가게
  })
}

/** 알려 주기만 하는 창 (단추 하나) */
export function tell(title: string, lines: string[]) {
  if (typeof HTMLDialogElement !== 'function' || !('showModal' in HTMLDialogElement.prototype)) return window.alert([title, ...lines].join('\n'))
  const d = document.createElement('dialog')
  d.className = 'ask'
  const q = document.createElement('p')
  q.className = 'ask-q'
  q.textContent = title
  const list = document.createElement('ul')
  list.className = 'ask-list'
  for (const l of lines) {
    const li = document.createElement('li')
    li.textContent = l
    list.append(li)
  }
  const row = document.createElement('div')
  row.className = 'actions'
  const ok = document.createElement('button')
  ok.type = 'button'
  ok.className = 'btn btn-primary ask-ok'
  ok.textContent = '닫기'
  row.append(ok)
  d.append(q, list, row)
  const end = () => (d.close(), d.remove())
  ok.addEventListener('click', end)
  d.addEventListener('cancel', (e) => (e.preventDefault(), end()))
  d.addEventListener('click', (e) => e.target === d && end())
  document.body.append(d)
  d.showModal()
  ok.focus()
}

/** 잠깐 떴다 사라지는 알림 (복사했어요 · 저장했어요 같은 것). 화면을 읽어 주는 프로그램도 읽어요. */
let shelf: HTMLElement | null = null
export function toast(text: string) {
  if (!shelf || !shelf.isConnected) {
    shelf = document.createElement('div')
    shelf.className = 'toasts'
    shelf.setAttribute('role', 'status')
    shelf.setAttribute('aria-live', 'polite')
    document.body.append(shelf)
  }
  shelf.replaceChildren() // 한 번에 하나만 (빠르게 여러 번 눌러도 쌓이지 않게)
  const t = document.createElement('p')
  t.className = 'toast'
  t.textContent = text
  shelf.append(t)
  setTimeout(() => t.classList.add('toast-out'), 2600)
  setTimeout(() => t.remove(), 3000)
}

/** 초를 사람이 읽는 말로: 90 → ‘1분 30초’, 0 → ‘제한 없음’ */
export const dur = (s: number) => (s <= 0 ? '제한 없음' : s < 60 ? `${s}초` : s % 60 ? `${Math.floor(s / 60)}분 ${s % 60}초` : `${s / 60}분`)

const RULE: Record<string, string> = { none: '없음', majority: '절반 넘게', two_thirds: '3분의 2 이상' }
const WAY: Record<string, string> = { simple: '간편', strict: '엄격' }
type Vote = { label: string; votes: number }
const isVote = (x: unknown): x is Vote => !!x && typeof x === 'object' && 'label' in x && 'votes' in x
const votes = (list: Vote[]) => list.map((o) => `${o.label} ${o.votes}명`).join(' · ')

/** 기록 한 줄의 자세한 내용을 사람이 읽는 말로 (true → 예, majority → 절반 넘게, [{label, votes}] → ‘찬성 18명 · 반대 6명’) */
export function describe(detail: Record<string, unknown>) {
  const out: string[] = []
  for (const [k, v] of Object.entries(detail)) {
    if ((k === '방' || k === '주제') && typeof v === 'number') continue // 안쪽 번호는 사람이 쓸 일이 없어요 (내려받는 기록에는 남아요)
    let s: string
    if (v === null || v === undefined || v === '') s = '없음'
    else if (typeof v === 'boolean') s = v ? '예' : '아니요'
    else if (k === '통과기준' && typeof v === 'string') s = RULE[v] ?? v
    else if (k === '방식' && typeof v === 'string') s = WAY[v] ?? v
    else if (k === '제한시간' && typeof v === 'number') s = dur(v)
    else if ((k === '남은초' || k === '늘린초') && typeof v === 'number') s = dur(v)
    else if ((k === '여는때' || k === '마감때') && typeof v === 'string') s = new Date(v).toLocaleString('ko-KR')
    else if (Array.isArray(v) && v.every(isVote) && v.length && !('title' in (v[0] as object))) s = votes(v as Vote[])
    else if (Array.isArray(v) && v.length && v.every((x) => x && typeof x === 'object' && 'title' in x)) {
      // 지운 방의 마지막 결과: 주제마다 묶어요
      const by = new Map<string, Vote[]>()
      for (const r of v as (Vote & { title: string })[]) {
        const list = by.get(r.title) ?? []
        if (r.label !== null && r.label !== undefined) list.push(r)
        by.set(r.title, list)
      }
      s = [...by].map(([t, list]) => (list.length ? `${t}: ${votes(list)}` : t)).join(' / ')
    } else if (Array.isArray(v)) s = v.map(String).join(', ')
    else if (typeof v === 'object') s = JSON.stringify(v)
    else s = String(v)
    out.push(`${k} ${s}`)
  }
  return out.join(', ')
}
