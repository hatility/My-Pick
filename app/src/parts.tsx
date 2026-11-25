// PC 화면 · 모바일 화면 · 큰 화면 · 관리자 화면이 같이 쓰는 조각
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Moon, Sun } from 'lucide-react'
import { BoxArt } from './art'
import { api, ApiError, type Item, type Org, type RoomState } from './api'

/** skew: 서버 시계 − 이 기기 시계. 남은 시간을 모두가 같게 보도록 서버 시계에 맞춰요. */
export type Live = RoomState & { skew: number }

/**
 * 방 상태를 실시간으로. 서버는 ‘바뀌었어요’ 신호만 보내고, 내용은 그때마다 다시 읽어요.
 * 신호가 끊겨도 15초마다 다시 읽고, 연결은 브라우저가 알아서 다시 붙여요.
 */
export function useLive(load: () => Promise<RoomState>, events: (s: RoomState) => string) {
  const [state, setState] = useState<Live | null>(null)
  const [ready, setReady] = useState(false)
  const [online, setOnline] = useState(true)
  const [denied, setDenied] = useState<string | null>(null)
  const loadRef = useRef(load)
  loadRef.current = load
  const refresh = useCallback(async () => {
    try {
      const s = await loadRef.current()
      setState({ ...s, skew: s.now - Date.now() })
      setDenied(null)
      setOnline(true)
    } catch (e) {
      if (e instanceof ApiError && [401, 403, 404].includes(e.status)) {
        setState(null)
        setDenied(e.message)
      } else setOnline(false)
    } finally {
      setReady(true)
    }
  }, [])
  useEffect(() => {
    refresh()
  }, [refresh])
  const url = state ? events(state) : null
  useEffect(() => {
    if (!url) return
    const es = new EventSource(url)
    // 숫자만 바뀐 알림({j,p,v})이면 다시 읽지 않고 화면의 숫자만 고쳐요
    es.onmessage = (e) => {
      if (e.data[0] !== '{') return void refresh()
      const c = JSON.parse(e.data) as { j: number; p: number; v: Record<string, number> }
      setState((s) => s && { ...s, joined: c.j, present: c.p, items: s.items.map((i) => (c.v[i.id] === undefined ? i : { ...i, voted: c.v[i.id] })) })
    }
    es.onopen = () => setOnline(true)
    es.onerror = () => setOnline(false)
    const t = setInterval(refresh, 15_000)
    return () => {
      es.close()
      clearInterval(t)
    }
  }, [url, refresh])
  return { state, ready, online, denied, refresh }
}

/** 참여자 화면의 상태 (PC · 모바일 공통) */
export function useVoter() {
  const [org, setOrg] = useState<Org | null>(null)
  const live = useLive(
    () => api<RoomState>('/api/me'),
    (s) => `/api/events?room=${s.room.code}`,
  )
  useEffect(() => {
    api<Org>('/api/org').then(setOrg, () => {})
  }, [])
  const vote = async (item: number, options: number[]) => {
    try {
      await api('/api/vote', 'POST', { item, options })
    } finally {
      await live.refresh()
    }
  }
  return { ...live, org: live.state?.org ?? org, vote }
}

export function useTick(active: boolean) {
  const [, set] = useState(0)
  useEffect(() => {
    if (!active) return
    const t = setInterval(() => set((n) => n + 1), 250)
    return () => clearInterval(t)
  }, [active])
}

export const secondsLeft = (item: Item, skew: number) => (item.closesAt ? Math.max(0, Math.ceil((item.closesAt - (Date.now() + skew)) / 1000)) : null)
/** 남은 시간 글자: 1시간 안쪽은 4:59, 그보다 길면 ‘3시간 20분’ · ‘2일 5시간’ */
export const clock = (s: number) =>
  s >= 86_400 ? `${Math.floor(s / 86_400)}일 ${Math.floor((s % 86_400) / 3600)}시간` : s >= 3600 ? `${Math.floor(s / 3600)}시간 ${Math.floor((s % 3600) / 60)}분` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
/** 열려 있는 전체 길이(초). 예약 마감 · 시간 연장도 맞게 재요. */
export const spanOf = (item: Item) => (item.closesAt && item.openedAt ? (item.closesAt - item.openedAt) / 1000 : item.seconds)

export function TimeLeft({ item, skew }: { item: Item; skew: number }) {
  useTick(item.status === 'open' && !!item.closesAt)
  const left = secondsLeft(item, skew)
  if (left === null) return <p className="time time-none">제한 시간 없이 진행해요</p>
  const span = spanOf(item)
  const pct = span ? Math.min(100, (left / span) * 100) : 0
  return (
    <div className={`time${left <= 10 ? ' time-soon' : ''}`}>
      <span className="time-label">남은 시간</span>
      <span className="time-num">{clock(left)}</span>
      <svg className="time-bar" viewBox="0 0 100 4" preserveAspectRatio="none" aria-hidden="true">
        <rect className="time-track" width="100" height="4" />
        <rect className="time-fill" width={pct} height="4" />
      </svg>
    </div>
  )
}

/** 픽 도장. 이 서비스의 얼굴이에요 (기표란에 찍히는 그 도장). */
export const Stamp = ({ className = '' }: { className?: string }) => (
  <svg className={`stamp ${className}`} viewBox="0 0 48 48" aria-hidden="true">
    <circle cx="24" cy="24" r="19" />
    <path d="M21 13v22M21 23h11" />
  </svg>
)

/** 밝은 화면 ↔ 어두운 화면. 고른 것은 이 브라우저에 기억해요. */
export function ThemeToggle() {
  const [dark, setDark] = useState(document.documentElement.dataset.theme === 'dark')
  const flip = () => {
    const next = dark ? 'light' : 'dark'
    document.documentElement.dataset.theme = next
    try {
      localStorage.setItem('mypick-theme', next)
    } catch {
      /* 기억 못 해도 괜찮아요 */
    }
    setDark(!dark)
  }
  return (
    <button type="button" className="icon-btn" onClick={flip} aria-label={dark ? '밝은 화면으로 바꾸기' : '어두운 화면으로 바꾸기'} title={dark ? '밝은 화면으로' : '어두운 화면으로'}>
      {dark ? <Sun size={20} aria-hidden="true" /> : <Moon size={20} aria-hidden="true" />}
    </button>
  )
}

/** 맨 위 줄 (첫 화면 · 안내 · 방 만들기가 같이 써요): 왼쪽에 기관, 오른쪽에 메뉴와 밝기 */
export function TopBar({ org, children }: { org: Org | null; children?: ReactNode }) {
  return (
    <header className="top">
      <a className="org-link" href="/" aria-label="첫 화면으로">
        <OrgMark org={org} />
      </a>
      <nav className="top-nav" aria-label="메뉴">
        {children}
        <ThemeToggle />
      </nav>
    </header>
  )
}

/** 맨 아래 줄: 안내 · 라이선스 · 소스 */
export function HomeFoot({ org }: { org: Org | null }) {
  return (
    <footer className="foot">
      <p>My Pick 은 누구나 고쳐 쓸 수 있는 자유 소프트웨어예요 (AGPL-3.0).</p>
      <p className="foot-links">
        <a href="/guide">안내</a>
        <a href="/guide#secret">비밀 보장</a>
        <a href="/verify">결과 확인</a>
        <a href="/terms">이용약관</a>
        <a href="/privacy">개인정보 처리방침</a>
        {org?.source && (
          <a href={org.source} rel="noopener">
            소스 코드
          </a>
        )}
      </p>
    </footer>
  )
}

/** 새 안건이 열리면 알려요: 진동(되는 기기만) · 짧은 소리 · 창 제목. 처음 들어왔을 때 이미 열려 있던 것은 울리지 않아요. */
function useOpenAlert(id: number | undefined, title: string | undefined) {
  const last = useRef<number | undefined | null>(null)
  useEffect(() => {
    if (last.current !== null && id && id !== last.current) {
      navigator.vibrate?.([200, 100, 200])
      try {
        const ctx = new AudioContext()
        const osc = ctx.createOscillator()
        const gain = ctx.createGain()
        osc.frequency.value = 880
        gain.gain.value = 0.08
        osc.connect(gain).connect(ctx.destination)
        osc.start()
        osc.stop(ctx.currentTime + 0.2)
        osc.onended = () => ctx.close()
      } catch {
        /* 소리를 못 내는 브라우저 */
      }
    }
    last.current = id
    document.title = id ? `픽이 열렸어요: ${title}` : 'My Pick'
  }, [id, title])
}

/** 가결을 따질 모수의 이름 */
export const BASIS = { voted: '픽한 사람', valid: '기권을 뺀 사람', joined: '들어온 사람 전체' } as const

/** 진행자의 독려 알림: 아직 픽하지 않은 사람에게만, 방금(30초 안) 온 것만 보여 줘요 */
function useNudge(item: Item | undefined, skew: number) {
  const [on, setOn] = useState(false)
  const at = item && !item.mine ? item.nudgeAt : null
  useEffect(() => {
    if (!at || Date.now() + skew - at > 30_000) return setOn(false)
    setOn(true)
    navigator.vibrate?.([120, 80, 120])
    const t = setTimeout(() => setOn(false), 30_000)
    return () => clearTimeout(t)
  }, [at])
  return on
}

export const Practice = ({ item }: { item: Item }) => (item.practice ? <span className="tag">연습</span> : null)

export function OrgMark({ org }: { org: Org | null }) {
  return (
    <div className="org">
      {org?.logo ? <img className="org-logo" src={org.logo} alt="" /> : <Stamp className="org-stamp" />}
      <span className="org-name">{org?.name ?? 'My Pick'}</span>
    </div>
  )
}

export function Offline({ online }: { online: boolean }) {
  if (online) return null
  return (
    <p className="offline" role="status">
      연결이 끊겼어요. 다시 연결하고 있어요. 이미 한 픽은 그대로 남아 있어요.
    </p>
  )
}

type Need = { title: string; needPass: boolean; needCode: boolean }

/**
 * 들어가기: 방 번호를 먼저 넣고, 그 방에 필요한 것(방 비밀번호 · 입장 코드)만 다음에 물어요.
 * 둘 다 필요 없는 방은 방 번호만으로 바로 들어가요. ?room=123456&code=… 주소면 미리 채워요.
 */
export function JoinForm({ onJoined }: { onJoined: () => void }) {
  const q = new URLSearchParams(location.search)
  const [room, setRoom] = useState((q.get('room') ?? '').replace(/\D/g, '').slice(0, 6))
  const [need, setNeed] = useState<Need | null>(null)
  const [password, setPassword] = useState('')
  const [entryCode, setEntryCode] = useState(q.get('code') ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const join = async () => {
    await api('/api/join', 'POST', { room, password, entryCode })
    history.replaceState(null, '', location.pathname) // 주소에 남은 방 번호 · 코드 지우기
    onJoined()
  }
  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    setError('')
    try {
      await fn()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const look = () =>
    run(async () => {
      if (room.length !== 6) throw new Error('방 번호 6자리를 넣어 주세요.')
      const n = await api<Need>(`/api/room?code=${room}`)
      // 필요한 것이 없거나, 입장 코드만 필요한데 주소(QR)로 이미 받았으면 바로 들어가요
      if (n.needPass || (n.needCode && !entryCode)) setNeed(n)
      else await join()
    })
  // 주소로 방 번호를 받았으면 (QR · 링크) 바로 다음 단계로
  useEffect(() => {
    if (room.length === 6) look()
  }, [])

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (need) run(join)
    else look()
  }

  return (
    <form className="join" onSubmit={submit} noValidate>
      {!need ? (
        <label className="field">
          <span>방 번호</span>
          <input className="input input-code" inputMode="numeric" autoComplete="off" maxLength={6} placeholder="6자리 숫자" value={room} onChange={(e) => setRoom(e.target.value.replace(/\D/g, ''))} autoFocus />
        </label>
      ) : (
        <>
          <p className="join-room">
            <strong>{need.title}</strong>
            <span>방 번호 {room}</span>
            <button type="button" className="link" onClick={() => (setNeed(null), setError(''))}>
              다른 방 번호 넣기
            </button>
          </p>
          {need.needPass && (
            <label className="field">
              <span>방 비밀번호</span>
              <input className="input" type="password" autoComplete="off" maxLength={100} placeholder="진행자가 알려 준 비밀번호" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
            </label>
          )}
          {need.needCode && (
            <label className="field">
              <span>입장 코드</span>
              <input className="input input-code" autoComplete="off" autoCapitalize="characters" maxLength={12} placeholder="받은 코드 8자리" value={entryCode} onChange={(e) => setEntryCode(e.target.value.toUpperCase())} autoFocus={!need.needPass} />
            </label>
          )}
        </>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <button className="btn btn-primary btn-big" disabled={busy}>
        {busy ? '확인하는 중' : need ? '들어가기' : '다음'}
      </button>
    </form>
  )
}

/** 첫 화면 아래쪽: 방을 만들고 싶은 사람에게 (누구나 방 만들기가 켜져 있을 때만) */
export function HostDoor({ org }: { org: Org | null }) {
  if (!org?.open) return null
  return (
    <section className="door" aria-labelledby="door-title">
      <div>
        <h2 id="door-title">My Pick 을 열고 싶나요?</h2>
        <p>가입 없이 방을 만들고, 안건을 하나씩 열어 함께 정해요.</p>
      </div>
      <div className="actions actions-start">
        <a className="btn" href="/new">
          방 만들기
        </a>
        <a className="link" href="/host">
          내가 만든 방 진행하기
        </a>
      </div>
    </section>
  )
}

/** 픽 카드: 고르기 → ‘픽하기’ → 한 번 더 확인 → 확정. 확정하면 바꿀 수 없어요. */
export function Ballot({ item, onVote }: { item: Item; onVote: (ids: number[]) => Promise<void> }) {
  const [picked, setPicked] = useState<number[]>([])
  const [confirm, setConfirm] = useState<number[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const single = item.maxPick === 1
  const full = !single && picked.length >= item.maxPick

  const toggle = (id: number) => {
    setError('')
    if (single) setPicked([id])
    else if (picked.includes(id)) setPicked(picked.filter((x) => x !== id))
    else if (!full) setPicked([...picked, id])
  }

  const send = async () => {
    if (!confirm) return
    setBusy(true)
    try {
      await onVote(confirm)
    } catch (e) {
      setError((e as Error).message)
      setConfirm(null)
    } finally {
      setBusy(false)
    }
  }

  const names = (confirm ?? []).map((id) => item.options.find((o) => o.id === id)?.label).join(', ')

  return (
    <div className={`ballot${busy ? ' ballot-busy' : ''}`}>
      {busy && (
        <p className="sending" role="status">
          <Stamp /> 보내는 중이에요
        </p>
      )}
      <fieldset className="ballot-rows" disabled={busy || !!confirm}>
        <legend className="ballot-hint">{single ? '하나를 골라 주세요' : `${item.maxPick}개까지 고를 수 있어요 (${picked.length}/${item.maxPick})`}</legend>
        {item.options.map((o) => {
          const on = picked.includes(o.id)
          return (
            <label key={o.id} className={`row${on ? ' row-on' : ''}${!on && full ? ' row-off' : ''}`}>
              <input type={single ? 'radio' : 'checkbox'} name={`item-${item.id}`} checked={on} disabled={!on && full} onChange={() => toggle(o.id)} />
              <span className="row-label">{o.label}</span>
              <span className="row-box">{on && <Stamp className="stamp-press" />}</span>
            </label>
          )
        })}
      </fieldset>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      {confirm ? (
        <div className="confirm" role="alertdialog" aria-labelledby="confirm-q">
          <p id="confirm-q" className="confirm-q">
            {confirm.length ? `‘${names}’ 고를까요?` : '아무것도 고르지 않고 기권할까요?'}
          </p>
          <p className="confirm-note">확정하면 바꿀 수 없어요.</p>
          <div className="actions">
            <button type="button" className="btn" onClick={() => setConfirm(null)} disabled={busy}>
              다시 고르기
            </button>
            <button type="button" className="btn btn-primary" onClick={send} disabled={busy} autoFocus>
              {busy ? '보내는 중' : confirm.length ? '픽 확정' : '기권 확정'}
            </button>
          </div>
        </div>
      ) : (
        <div className="actions">
          <button type="button" className="btn btn-quiet" onClick={() => setConfirm([])}>
            기권
          </button>
          <button type="button" className="btn btn-primary btn-big" disabled={!picked.length} onClick={() => setConfirm(picked)}>
            픽하기
          </button>
        </div>
      )}
    </div>
  )
}

/** 결과 막대. 마감된 안건에서 가장 많이 받은 선택지에는 도장이 찍혀요. */
export function Result({ item }: { item: Item }) {
  const votes = item.options.map((o) => o.votes ?? 0)
  const max = Math.max(1, ...votes)
  const top = item.status === 'closed' ? Math.max(0, ...votes) : 0
  const tied = top > 0 && votes.filter((v) => v === top).length > 1
  // 이 기기가 마감 때 처음 본 확인 코드를 기억해 뒀다가, 나중에 달라지면 알려요 (각자의 기기가 증거가 돼요)
  const [first, setFirst] = useState<string | null>(null)
  useEffect(() => {
    if (!item.proof) return
    try {
      const key = `mypick-proof-${item.id}`
      const kept = localStorage.getItem(key)
      if (kept) setFirst(kept)
      else localStorage.setItem(key, item.proof)
    } catch {
      /* 기억 못 해도 괜찮아요 */
    }
  }, [item.id, item.proof])
  return (
    <div className="result">
      {item.outcome && (
        <p className={`verdict verdict-${item.outcome}`}>
          <strong>{item.outcome === 'pass' ? '가결' : '부결'}</strong>
          <span>
            ‘{item.options[0]?.label}’이 {BASIS[item.basis]}의 {item.rule === 'majority' ? '과반' : '3분의 2 이상'}이면 가결
          </span>
        </p>
      )}
      {tied && !item.outcome && <p className="tie">가장 많이 받은 선택지가 동점이에요.</p>}
      <ul className="result-rows">
        {item.options.map((o, i) => {
          const win = top > 0 && votes[i] === top
          return (
            <li key={o.id} className={`res${win ? ' res-win' : ''}`}>
              <span className="res-label">
                {win && <Stamp className="res-stamp" />}
                {o.label}
              </span>
              <span className="res-count">
                {votes[i]}명{item.voted > 0 && <small> {Math.round((votes[i] / item.voted) * 100)}%</small>}
              </span>
              <svg className="res-bar" viewBox="0 0 100 6" preserveAspectRatio="none" aria-hidden="true">
                <rect className="res-track" width="100" height="6" />
                <rect className="res-fill" width={(votes[i] / max) * 100} height="6" />
              </svg>
            </li>
          )
        })}
      </ul>
      <p className="result-meta">
        {item.status === 'closed' && item.eligible !== null ? `들어온 ${item.eligible}명 중 ${item.voted}명 픽` : `${item.voted}명 픽`}
        {item.abstain ? `, 그중 기권 ${item.abstain}명` : ''}
        {item.status === 'closed' && item.reason ? ` (${item.reason})` : ''}
      </p>
      {item.proof && (
        <p className="proof">
          결과 확인 코드 <strong>{item.proof}</strong>
        </p>
      )}
      {item.proof && first && first !== item.proof && (
        <p className="error" role="alert">
          이 기기가 마감 때 본 코드({first})와 달라요. 마감한 뒤에 결과가 바뀌었을 수 있어요. 진행자나 관리자에게 알려 주세요.
        </p>
      )}
    </div>
  )
}

/** 기다리는 동안: 어디까지 왔는지와 다음 안건 */
function Agenda({ state }: { state: Live }) {
  const { total, done, next } = state.agenda
  if (!total) return null
  return (
    <div className="agenda">
      <svg viewBox="0 0 100 4" preserveAspectRatio="none" aria-hidden="true">
        <rect className="time-track" width="100" height="4" />
        <rect className="agenda-fill" width={(done / total) * 100} height="4" />
      </svg>
      <p>
        안건 {total}개 중 <strong>{done}개</strong> 끝났어요.
        {next && (
          <>
            {' '}
            다음은 <strong>‘{next}’</strong>
          </>
        )}
      </p>
    </div>
  )
}

/** 마감된 안건에 이의 남기기: 정한 시간 동안, 한 번, 익명으로 진행자에게 */
function Objection({ item, skew, onDone }: { item: Item; skew: number; onDone: () => unknown }) {
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useTick(!!item.objectUntil)
  const left = item.objectUntil ? Math.ceil((item.objectUntil - (Date.now() + skew)) / 1000) : 0
  if (item.objected) return <p className="tip">이 안건에 이의를 남겼어요. 진행자에게 전해졌어요.</p>
  if (item.objected === null || left <= 0) return null
  const send = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await api('/api/object', 'POST', { item: item.id, note })
      await onDone()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <details className="report object">
      <summary>결과에 이의가 있어요 ({clock(left)} 남음)</summary>
      <form className="join" onSubmit={send}>
        <p className="tip">누가 남겼는지는 진행자에게 보이지 않아요. 한 안건에 한 번 남길 수 있어요.</p>
        <label className="field">
          <span>이의 내용</span>
          <textarea className="input" rows={2} minLength={5} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} required />
        </label>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button className="btn" disabled={busy}>
          이의 남기기
        </button>
      </form>
    </details>
  )
}

/** 지금 할 일 한 칸: 기다리기 → 픽 카드 → 픽 완료 */
export function Current({ state, vote }: { state: Live; vote: (item: number, options: number[]) => Promise<void> }) {
  const open = state.items.find((i) => i.status === 'open')
  useOpenAlert(open && !open.mine ? open.id : undefined, open?.title)
  const nudged = useNudge(open, state.skew)
  if (state.room.closed)
    return (
      <section className="wait">
        <Stamp className="wait-stamp" />
        <h2>My Pick 이 모두 끝났어요</h2>
        <p>지난 안건에서 결과를 볼 수 있어요.</p>
        <button className="btn" onClick={() => api('/api/leave', 'POST').finally(() => (location.href = '/'))}>
          첫 화면으로
        </button>
      </section>
    )
  if (!open)
    return (
      <section className="wait" aria-live="polite">
        <BoxArt />
        <h2>다음 안건을 기다리고 있어요</h2>
        <Agenda state={state} />
        {state.nextOpenAt && <p className="wait-when">다음 안건은 {new Date(state.nextOpenAt).toLocaleString('ko-KR', { month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' })}에 열려요.</p>}
        <p>진행자가 안건을 열면 이 화면에 바로 나와요. 새로고침하지 않아도 돼요.</p>
      </section>
    )
  return (
    <section className="sheet" aria-labelledby="cur-title">
      <header className="sheet-head">
        <h2 id="cur-title">
          <Practice item={open} />
          {open.title}
        </h2>
        {open.note && <p className="sheet-note">{open.note}</p>}
        <TimeLeft item={open} skew={state.skew} />
        {nudged && !open.mine && (
          <p className="nudge" role="alert">
            진행자가 알려요. 아직 픽하지 않았어요. 곧 마감될 수 있어요.
          </p>
        )}
      </header>
      {open.mine ? (
        <div className="done" role="status">
          <Stamp className="done-stamp stamp-press" />
          <h3>픽했어요</h3>
          <p>
            지금까지 {open.voted}명이 픽했어요.{!open.revealed && ' 결과는 마감되면 나와요.'}
          </p>
          {open.revealed && <Result item={open} />}
        </div>
      ) : (
        <Ballot key={open.id} item={open} onVote={(ids) => vote(open.id, ids)} />
      )}
    </section>
  )
}

export function Past({ items, skew = 0, refresh }: { items: Item[]; skew?: number; refresh?: () => unknown }) {
  const closed = items.filter((i) => i.status === 'closed').reverse()
  if (!closed.length) return <p className="empty">마감된 안건이 생기면 여기에 결과가 나와요.</p>
  return (
    <>
      {closed.map((it) => (
        <article key={it.id} className="past">
          <h3>
            <Practice item={it} />
            {it.title}
          </h3>
          <Result item={it} />
          {it.objections > 0 && <p className="tip">이의 {it.objections}건이 접수됐어요.</p>}
          {refresh && <Objection item={it} skew={skew} onDone={refresh} />}
        </article>
      ))}
    </>
  )
}

const REASONS = ['부적절한 내용', '괴롭힘 · 따돌림', '사칭 · 속임', '기타']
/** 이 방 신고하기: 들어온 사람이 한 방에 한 번. 관리자에게 전해져요. */
export function ReportLink() {
  const [reason, setReason] = useState(REASONS[0])
  const [note, setNote] = useState('')
  const [state, setState] = useState<'idle' | 'busy' | 'sent'>('idle')
  const [error, setError] = useState('')
  const send = async (e: FormEvent) => {
    e.preventDefault()
    setState('busy')
    setError('')
    try {
      await api('/api/report', 'POST', { reason, note })
      setState('sent')
    } catch (e) {
      setError((e as Error).message)
      setState('idle')
    }
  }
  return (
    <details className="report">
      <summary>이 방 신고하기</summary>
      {state === 'sent' ? (
        <p role="status">신고를 보냈어요. 관리자가 확인할 거예요.</p>
      ) : (
        <form className="join" onSubmit={send}>
          <p className="tip">남을 속이거나 괴롭히는 내용이라면 알려 주세요. 누가 신고했는지는 진행자에게 보이지 않아요.</p>
          <label className="field">
            <span>까닭</span>
            <select className="input" value={reason} onChange={(e) => setReason(e.target.value)}>
              {REASONS.map((r) => (
                <option key={r}>{r}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>자세한 내용 (없어도 돼요)</span>
            <textarea className="input" rows={2} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <button className="btn" disabled={state === 'busy'}>
            신고 보내기
          </button>
        </form>
      )}
    </details>
  )
}

/** 불러오는 동안: 빈 화면 대신 자리만 잡은 틀을 보여 줘요 */
export const Loading = () => (
  <div className="loading" role="status" aria-label="불러오는 중">
    <span />
    <span />
    <span />
  </div>
)

/** 올리기 전에 사진을 알맞은 크기로 줄여요 (긴 쪽 512px). 큰 로고를 모든 휴대폰이 그대로 받지 않게요. */
export async function shrink(file: File, max = 512): Promise<Blob> {
  try {
    const img = await createImageBitmap(file)
    const scale = Math.min(1, max / Math.max(img.width, img.height))
    if (scale === 1 && file.size < 200_000) return file
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(img.width * scale)
    canvas.height = Math.round(img.height * scale)
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height)
    const out = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, 'image/png'))
    return out && out.size < file.size ? out : file
  } catch {
    return file // 줄이지 못하면 그대로 (서버가 크기 · 종류를 다시 봐요)
  }
}

/** 길을 잃었을 때: 까닭과 함께 첫 화면으로 가는 버튼 */
export function Lost({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <main className="lost">
      <Stamp className="lost-stamp" />
      <h1>{title}</h1>
      {children && <p>{children}</p>}
      <a className="btn btn-primary" href="/">
        첫 화면으로
      </a>
    </main>
  )
}

export const PRIVACY = '누가 무엇을 골랐는지는 어디에도 남지 않아요. 진행자도 볼 수 없어요.'
