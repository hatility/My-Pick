// PC 화면 · 모바일 화면 · 큰 화면 · 관리자 화면이 같이 쓰는 조각
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Moon, Sun } from 'lucide-react'
import { BoxArt } from './art'
import { toast } from './ui'
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
    // 실시간 연결이 안 될 때(자리가 다 찼거나 막힌 망)는 4초마다 직접 읽어 화면이 멈추지 않게 해요. 연결돼 있을 때는 16초마다 한 번만 확인해요.
    let live = true
    let n = 0
    es.onopen = () => {
      live = true
      setOnline(true)
    }
    es.onerror = () => {
      live = false
      setOnline(false)
    }
    const t = setInterval(() => {
      if (!live || ++n % 4 === 0) refresh()
    }, 4000)
    return () => {
      es.close()
      clearInterval(t)
    }
  }, [url, refresh])
  return { state, ready, online, denied, refresh }
}

/** 참여자 화면의 상태 (PC · 모바일 공통) */
/**
 * 화면 꺼짐 막기: 방에 들어와 있는 동안 휴대폰 화면이 저절로 꺼지지 않게 해요 (다음 주제가 열린 것을 놓치지 않게).
 * 브라우저가 지원할 때만 (HTTPS 또는 localhost). 다른 앱에 다녀오면 풀리므로, 돌아올 때 다시 걸어요.
 */
export function useWakeLock(on: boolean) {
  useEffect(() => {
    if (!on || !('wakeLock' in navigator)) return
    let lock: WakeLockSentinel | null = null
    let stop = false
    const take = () => {
      if (stop || document.visibilityState !== 'visible' || (lock && !lock.released)) return
      navigator.wakeLock.request('screen').then(
        (l) => {
          if (stop) l.release().catch(() => {})
          else lock = l
        },
        () => {}, // 배터리 절약 모드 등으로 거절되면 그냥 둬요
      )
    }
    take()
    document.addEventListener('visibilitychange', take)
    return () => {
      stop = true
      document.removeEventListener('visibilitychange', take)
      lock?.release().catch(() => {})
    }
  }, [on])
}

/** 쉬운 말 모드(방 설정): 참여 화면의 글자를 키우고(html[data-easy]) 문장을 짧게 해요 */
export function useEasy(on: boolean | undefined) {
  // 그리는 그 순간에 맞춰 둬요 (효과에서만 바꾸면 첫 화면은 보통 문장으로 나와요)
  if (on) document.documentElement.dataset.easy = '1'
  else delete document.documentElement.dataset.easy
  useEffect(() => {
    return () => {
      delete document.documentElement.dataset.easy
    }
  }, [on])
}
/** 쉬운 말 모드면 뒤의 짧은 문장을 써요 */
export const ez = (normal: string, easy: string) => (document.documentElement.dataset.easy ? easy : normal)

/** 조용한 손들기: 진행자에게 ‘질문 있어요 · 더 설명해 주세요’를 익명으로 알려요. 진행자는 몇 명인지만 봐요. */
export function Hands({ state }: { state: Live }) {
  const [busy, setBusy] = useState(false)
  if (state.room.closed) return null
  const mine = state.myHand ?? null
  const raise = (kind: 'question' | 'more') => {
    setBusy(true)
    api('/api/hand', 'POST', { kind: mine === kind ? null : kind })
      .catch(() => {})
      .finally(() => setBusy(false))
  }
  return (
    <section className="hands" aria-label="조용한 손들기">
      <p>{ez('진행자에게 조용히 알려요. 누가 눌렀는지는 보이지 않아요.', '진행하는 분께 살짝 알려요. 누가 눌렀는지 몰라요.')}</p>
      <div className="hands-btns">
        <button type="button" className="hand-btn" aria-pressed={mine === 'question'} disabled={busy} onClick={() => raise('question')}>
          {ez('질문 있어요', '궁금해요')}
        </button>
        <button type="button" className="hand-btn" aria-pressed={mine === 'more'} disabled={busy} onClick={() => raise('more')}>
          {ez('더 설명해 주세요', '다시 말해 주세요')}
        </button>
      </div>
      {mine && (
        <p className="tip" role="status">
          {ez('알렸어요. 다시 누르면 내려요.', '알렸어요. 또 누르면 취소돼요.')}
        </p>
      )}
    </section>
  )
}

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

export const secondsLeft = (item: Item, skew: number) =>
  item.paused ? (item.pausedLeft === null ? null : Math.ceil(item.pausedLeft / 1000)) : item.closesAt ? Math.max(0, Math.ceil((item.closesAt - (Date.now() + skew)) / 1000)) : null
/** 남은 시간 글자: 1시간 안쪽은 4:59, 그보다 길면 ‘3시간 20분’ · ‘2일 5시간’ */
export const clock = (s: number) =>
  s >= 86_400 ? `${Math.floor(s / 86_400)}일 ${Math.floor((s % 86_400) / 3600)}시간` : s >= 3600 ? `${Math.floor(s / 3600)}시간 ${Math.floor((s % 3600) / 60)}분` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
/** 열려 있는 전체 길이(초). 예약 마감 · 시간 연장도 맞게 재요. */
export const spanOf = (item: Item) => (!item.paused && item.closesAt && item.openedAt ? (item.closesAt - item.openedAt) / 1000 : item.seconds)

export function TimeLeft({ item, skew }: { item: Item; skew: number }) {
  useTick(item.status === 'open' && !!item.closesAt && !item.paused)
  const left = secondsLeft(item, skew)
  if (item.paused)
    return (
      <p className="time time-paused" role="status">
        <strong>잠깐 멈췄어요</strong>
        {left !== null && <span>남은 시간 {clock(left)} 그대로</span>}
      </p>
    )
  if (left === null) return <p className="time time-none">제한 시간 없이 진행해요</p>
  const span = spanOf(item)
  const pct = span ? Math.min(100, (left / span) * 100) : 0
  return (
    <div className={`time${left <= 10 ? ' time-soon' : ''}`}>
      <span className="time-label">남은 시간</span>
      <span className="time-num">{clock(left)}</span>
      {/* 화면을 읽어 주는 프로그램에는 30초 · 10초 남았을 때만 알려요 (매초 읽으면 방해돼요) */}
      <span className="sr" role="status">
        {left === 30 || left === 10 ? `${left}초 남았어요` : ''}
      </span>
      <svg className="time-bar" viewBox="0 0 100 4" preserveAspectRatio="none" aria-hidden="true">
        <rect className="time-track" width="100" height="4" />
        <rect className="time-fill" width={pct} height="4" />
      </svg>
    </div>
  )
}

/** 픽 도장. 이 서비스의 얼굴이에요 (동그라미 안의 체크). */
export const Stamp = ({ className = '' }: { className?: string }) => (
  <svg className={`stamp ${className}`} viewBox="0 0 48 48" aria-hidden="true">
    <circle cx="24" cy="24" r="19" />
    <path d="M15 24.5l6.5 6.5L33.5 17.5" strokeLinejoin="round" />
  </svg>
)

/** 밝은 화면 ↔ 어두운 화면. 고른 것은 이 브라우저에 기억해요. */
/** 글자 크기 (참여자가 직접): 보통 → 크게 → 아주 크게. 이 브라우저에 기억해요. 쉬운 말 모드보다 이것이 앞서요. */
const TEXT = [['', '보통'], ['l', '크게'], ['xl', '아주 크게']] as const
export function TextSize() {
  const [at, setAt] = useState(() => Math.max(0, TEXT.findIndex(([k]) => k === (document.documentElement.dataset.text ?? ''))))
  const flip = () => {
    const next = (at + 1) % TEXT.length
    const [key, name] = TEXT[next]
    if (key) document.documentElement.dataset.text = key
    else delete document.documentElement.dataset.text
    try {
      localStorage.setItem('mypick-text', key)
    } catch {
      /* 기억 못 해도 괜찮아요 */
    }
    setAt(next)
    toast(`글자 크기: ${name}`)
  }
  return (
    <button type="button" className="icon-btn text-size" onClick={flip} aria-label={`글자 크기 바꾸기 (지금 ${TEXT[at][1]})`} title={`글자 크기: ${TEXT[at][1]}`}>
      가{at > 0 && <small aria-hidden="true">{'+'.repeat(at)}</small>}
    </button>
  )
}

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
      <a className="org-link" href="/" aria-label={`${org?.name ?? 'My Pick'}, 첫 화면으로`}>
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
/** 맨 아래 줄: 눈에 띄지 않게 작은 링크 한 줄 (비밀 보장은 ‘안내’ 안에 있어요) */
const FOOT: [string, string][] = [
  ['/about', '소개'],
  ['/guide', '가이드'],
  ['/verify', '결과 확인'],
  ['/feedback', '오류 제보'],
  ['/terms', '이용약관'],
  ['/privacy', '개인정보 처리방침'],
]
/** 맨 아래 칸 (PC · 안내 페이지): 흰 카드 하나에 My Pick 소개 · ‘하틸리티가 만든 상자’ 칩 · 바로가기. 하틸리티 메인 사이트 · 그려봄과 같은 짜임이에요.
    휴대폰에서는 링크만 몇 줄로 줄여요 (styles.css). compact 는 휴대폰 참여 화면용: 예전처럼 작은 링크 한 줄만 */
const FOOT_COLS: [string, [string, string, string][]][] = [
  // ‘방 만들기’ 는 첫 화면의 띠와 겹쳐서 넣지 않아요
  ['함께하기', [['/', '방 들어가기', 'M5 12h14M13 6l6 6-6 6'], ['/host', '내가 만든 방 진행하기', 'M4 5h16v11H4zM9 20h6M12 16v4'], ['/verify', '결과 확인', 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6zM8.5 12l2.5 2.5 4.5-5']]],
  ['알아보기', [['/about', '소개', 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v6M12 7.5v.5'], ['/guide', '가이드', 'M4 4h12l4 4v12H4zM8 12h8M8 16h5'], ['/feedback', '오류 제보', 'M3 6h18v12H3zM3 7l9 6 9-6']]],
]
export function HomeFoot({ org, compact = false }: { org: Org | null; compact?: boolean }) {
  if (compact)
    return (
      <footer className="foot">
        <nav aria-label="더 알아보기">
          <ul className="foot-links">
            {FOOT.map(([href, name]) => (
              <li key={href}>
                {/* 개인정보 처리방침은 눈에 잘 띄게 (개인정보 보호법이 바라는 대로) */}
                <a href={href} className={href === '/privacy' ? 'foot-strong' : undefined}>
                  {name}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <p className="foot-note">
          My Pick · 누구나 고쳐 쓸 수 있는 자유 소프트웨어 (AGPL-3.0)
          {org?.source && (
            <>
              {' '}
              <a href={org.source} rel="noopener">
                소스 코드
              </a>
            </>
          )}
        </p>
      </footer>
    )
  return (
    <footer className="foot-big">
      <div className="foot-card">
        <div className="foot-grid">
          <div className="foot-brand">
            <a className="foot-mark" href="/" aria-label="My Pick 처음으로">
              <Stamp />
              <b>My Pick</b>
            </a>
            <p>방 번호 하나로 모여 함께 고르고, 결과를 같이 봐요. 누가 무엇을 골랐는지는 어디에도 남지 않아요.</p>
            <a className="foot-made" href="https://github.com/hatility" rel="noopener">
              <img src="/hatility.png" alt="" width={32} height={32} loading="lazy" />
              <span>
                <b>하틸리티가 만든 상자</b>
                <small>하남시청소년수련관 Team HATILITY</small>
              </span>
            </a>
          </div>
          {FOOT_COLS.map(([title, links]) => (
            <nav key={title} aria-label={title}>
              <h2>{title}</h2>
              <ul>
                {links.map(([href, name, d]) => (
                  <li key={href}>
                    <a href={href}>
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d={d} />
                      </svg>
                      {name}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>
        <p className="foot-copy">
          <span>
            © 2026 hatility · 만든 사람 이명균 · 자유 소프트웨어 (AGPL-3.0)
            {org?.source && (
              <>
                {' '}
                <a href={org.source} rel="noopener">
                  소스 코드
                </a>
              </>
            )}
          </span>
          <span className="foot-small">
            <a href="/terms">이용약관</a>
            <a href="/privacy" className="foot-strong">
              개인정보 처리방침
            </a>
          </span>
        </p>
      </div>
    </footer>
  )
}

/** 새 주제가 열리면 알려요: 진동(되는 기기만) · 짧은 소리 · 창 제목. 처음 들어왔을 때 이미 열려 있던 것은 울리지 않아요. */
function useOpenAlert(id: number | undefined, title: string | undefined) {
  const last = useRef<number | undefined | null>(null)
  useEffect(() => {
    if (last.current !== null && id && id !== last.current) {
      if (navigator.userActivation?.hasBeenActive ?? true) navigator.vibrate?.([200, 100, 200])
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

/** 통과를 따질 기준 인원의 이름 */
export const BASIS = { voted: '픽한 사람', valid: '실제로 고른 사람', joined: '들어온 사람 전체' } as const

/** 진행자의 독려 알림: 아직 픽하지 않은 사람에게만, 방금(30초 안) 온 것만 보여 줘요 */
function useNudge(item: Item | undefined, skew: number) {
  const [on, setOn] = useState(false)
  const at = item && !item.mine ? item.nudgeAt : null
  useEffect(() => {
    if (!at || Date.now() + skew - at > 30_000) return setOn(false)
    setOn(true)
    if (navigator.userActivation?.hasBeenActive ?? true) navigator.vibrate?.([120, 80, 120])
    const t = setTimeout(() => setOn(false), 30_000)
    return () => clearTimeout(t)
  }, [at])
  return on
}

/** 글이 길면 글자를 줄일 수 있게 길이를 알려 줘요 (CSS 의 [data-len]) */
export const lenOf = (t: string) => (t.length > 60 ? 'xl' : t.length > 28 ? 'l' : undefined)

/** 주제 설명: 길면 두 줄만 보이고 ‘설명 더 보기’로 펼쳐요 (선택지가 아래로 밀리지 않게) */
export function Note({ text }: { text: string }) {
  const [all, setAll] = useState(false)
  const long = text.length > 80
  return (
    <div className="sheet-note">
      <p className={long && !all ? 'clamp-2' : undefined}>{text}</p>
      {long && (
        <button type="button" className="link-btn" aria-expanded={all} onClick={() => setAll(!all)}>
          {all ? '설명 접기' : '설명 더 보기'}
        </button>
      )}
    </div>
  )
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

/** 관리 · 방장 화면 머리줄의 표시: 기관 로고 대신 서비스 표시만 짧게 (기관 이름 · 로고는 맨 아래 줄에) */
export const AppMark = () => (
  <span className="app-mark">
    <Stamp className="org-stamp" />
    <b>My Pick</b>
  </span>
)
/** 관리 · 방장 화면의 맨 아래 줄: 어느 기관의 화면인지 조용히 */
export function AdFoot({ org, label }: { org: Org | null; label: string }) {
  return (
    <footer className="ad-foot">
      {org?.logo && <img className="ad-foot-logo" src={org.logo} alt="" />}
      {org?.name && <span className="ad-foot-org">{org.name}</span>}
      <span>My Pick {label}</span>
    </footer>
  )
}

export function Offline({ online, host = false }: { online: boolean; host?: boolean }) {
  if (online) return null
  return (
    <p className="offline" role="status">
      연결이 끊겼어요. 다시 연결하고 있어요.{host ? ' 화면의 숫자는 다시 연결되면 맞춰져요.' : ' 이미 한 픽은 그대로 남아 있어요.'}
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
        <p>가입 없이 방을 만들고, 주제를 하나씩 열어 함께 정해요.</p>
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
export function Ballot({ item, paused = false, onVote }: { item: Item; paused?: boolean; onVote: (ids: number[]) => Promise<void> }) {
  const [picked, setPicked] = useState<number[]>([])
  const [confirm, setConfirm] = useState<number[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const single = item.maxPick === 1
  useEffect(() => {
    if (paused) setConfirm(null) // 확인하는 사이 멈추면 확인 창을 닫아요
  }, [paused])
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
      <fieldset className="ballot-rows" disabled={busy || !!confirm || paused}>
        <legend className="ballot-hint">{paused ? ez('잠깐 멈춘 동안에는 고를 수 없어요', '잠깐 기다려요') : single ? ez('하나를 누르고, 아래 ‘픽하기’를 눌러 주세요', '하나를 골라요') : `${item.maxPick}개까지 고를 수 있어요 (${picked.length}/${item.maxPick})`}</legend>
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
            {confirm.length ? ez(`‘${names}’ 고를까요?`, `‘${names}’ 맞나요?`) : ez('아무것도 고르지 않고 건너뛸까요?', '안 고르고 넘어갈까요?')}
          </p>
          <p className="confirm-note">{ez('확정하면 바꿀 수 없어요.', '한 번 정하면 못 바꿔요.')}</p>
          <div className="actions">
            <button type="button" className="btn" onClick={() => setConfirm(null)} disabled={busy}>
              {ez('다시 고르기', '다시 고를래요')}
            </button>
            <button type="button" className="btn btn-primary" onClick={send} disabled={busy} autoFocus>
              {busy ? '보내는 중' : confirm.length ? ez('픽 확정', '네, 정했어요') : ez('건너뛰기 확정', '네, 넘어가요')}
            </button>
          </div>
        </div>
      ) : (
        <div className="actions">
          <button type="button" className="btn btn-quiet" disabled={paused} onClick={() => setConfirm([])}>
            {ez('건너뛰기', '안 고를래요')}
          </button>
          <button type="button" className="btn btn-primary btn-big" disabled={!picked.length || paused} onClick={() => setConfirm(picked)}>
            {ez('픽하기', '이걸로 할래요')}
          </button>
        </div>
      )}
    </div>
  )
}

/** 결과 막대. 마감된 주제에서 가장 많이 받은 선택지에는 도장이 찍혀요. */
export function Result({ item }: { item: Item }) {
  const votes = item.options.map((o) => o.votes ?? 0)
  const max = Math.max(1, ...votes)
  const top = item.status === 'closed' ? Math.max(0, ...votes) : 0
  const tied = top > 0 && votes.filter((v) => v === top).length > 1
  // 이 기기가 마감 때 처음 본 확인 코드를 기억해 뒀다가, 나중에 달라지면 알려요 (각자의 기기가 증거가 돼요)
  // 어느 주제의 코드인지 함께 들고 있어요. 같은 자리에 다른 주제가 나올 때(큰 화면 · 리모컨) 앞 주제의 코드와 견주면 안 되니까요.
  const [seen, setSeen] = useState<{ id: number; code: string } | null>(null)
  useEffect(() => {
    setSeen(null)
    if (!item.proof) return
    try {
      const key = `mypick-proof-${item.id}`
      const kept = localStorage.getItem(key)
      if (kept) setSeen({ id: item.id, code: kept })
      else localStorage.setItem(key, item.proof)
    } catch {
      /* 기억 못 해도 괜찮아요 */
    }
  }, [item.id, item.proof])
  const first = seen?.id === item.id ? seen.code : null
  return (
    <div className="result" data-many={item.options.length > 12 ? 3 : item.options.length > 5 ? 2 : undefined}>
      {item.outcome && (
        <p className={`verdict verdict-${item.outcome}`}>
          <strong>{item.outcome === 'pass' ? '통과' : '통과 못 함'}</strong>
          <span>
            ‘{item.options[0]?.label}’이 {BASIS[item.basis]}의 {item.rule === 'majority' ? '절반을 넘으면' : '3분의 2 이상이면'} 통과
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
                {win && <span className="sr">가장 많이 받음: </span>}
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
        {item.abstain ? `, 그중 건너뜀 ${item.abstain}명` : ''}
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

/** 기다리는 동안: 어디까지 왔는지와 다음 주제 */
export function Agenda({ state }: { state: Live }) {
  const { total, done, next } = state.agenda
  if (!total) return null
  return (
    <div className="agenda">
      <svg viewBox="0 0 100 4" preserveAspectRatio="none" aria-hidden="true">
        <rect className="time-track" width="100" height="4" />
        <rect className="agenda-fill" width={(done / total) * 100} height="4" />
      </svg>
      <p>
        주제 {total}개 중 <strong>{done}개</strong> 끝났어요.
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

/** 마감된 주제에 확인 요청 보내기: 정한 시간 동안, 한 번, 익명으로 진행자에게 */
function Objection({ item, skew, onDone }: { item: Item; skew: number; onDone: () => unknown }) {
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useTick(!!item.objectUntil)
  const left = item.objectUntil ? Math.ceil((item.objectUntil - (Date.now() + skew)) / 1000) : 0
  if (item.objected) return <p className="tip">이 주제에 확인 요청을 보냈어요. 진행자에게 전해졌어요.</p>
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
      <summary>결과가 이상하면 확인 요청하기 ({clock(left)} 남음)</summary>
      <form className="join" onSubmit={send}>
        <p className="tip">누가 남겼는지는 진행자에게 보이지 않아요. 한 주제에 한 번 남길 수 있어요.</p>
        <label className="field">
          <span>확인할 내용</span>
          <textarea className="input" rows={2} minLength={5} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} required />
        </label>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button className="btn" disabled={busy}>
          확인 요청 보내기
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
        <Final items={state.items} />
        <button className="btn" onClick={() => api('/api/leave', 'POST').finally(() => (location.href = '/'))}>
          첫 화면으로
        </button>
      </section>
    )
  const allDone = state.agenda.total > 0 && !state.agenda.next && state.agenda.done >= state.agenda.total
  if (!open)
    return (
      <section className="wait" aria-live="polite">
        <BoxArt />
        <h2>{allDone ? ez('준비된 주제는 모두 끝났어요', '다 끝났어요') : ez('다음 주제를 기다리고 있어요', '잠깐 기다려요')}</h2>
        <Agenda state={state} />
        {state.nextOpenAt && <p className="wait-when">다음 주제는 {new Date(state.nextOpenAt).toLocaleString('ko-KR', { month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' })}에 열려요.</p>}
        <p>{allDone ? ez('진행자가 주제를 더 열면 이 화면에 바로 나와요. 지난 결과는 아래에서 볼 수 있어요.', '더 있으면 여기에 나와요.') : ez('이대로 기다리면 돼요. 진행자가 주제를 열면 이 화면에 바로 나와요.', '곧 고를 것이 나와요.')}</p>
      </section>
    )
  return (
    <section className="sheet" aria-labelledby="cur-title">
      <header className="sheet-head">
        <h2 id="cur-title" data-len={lenOf(open.title)}>
          <Practice item={open} />
          {open.title}
        </h2>
        {open.note && <Note key={open.id} text={open.note} />}
        <TimeLeft item={open} skew={state.skew} />
        {open.paused && !open.mine && <p className="paused-note">{ez('진행자가 설명하는 동안 잠깐 멈췄어요. 다시 시작하면 고를 수 있어요.', '잠깐 쉬어요. 곧 다시 골라요.')}</p>}
        {nudged && !open.mine && (
          <p className="nudge" role="alert">
            진행자가 알려요. 아직 픽하지 않았어요. 곧 마감될 수 있어요.
          </p>
        )}
      </header>
      {open.mine ? (
        <div className="done" role="status">
          <Stamp className="done-stamp stamp-press" />
          <h3>{ez('픽했어요', '골랐어요!')}</h3>
          <p>
            {ez(`지금까지 ${open.voted}명이 픽했어요.`, `${open.voted}명이 골랐어요.`)}{!open.revealed && ez(' 이대로 기다리면 마감 뒤 결과가 나와요.', ' 조금 뒤에 결과가 나와요.')}
          </p>
          {open.revealed && <Result item={open} />}
        </div>
      ) : (
        <Ballot key={open.id} item={open} paused={open.paused} onVote={(ids) => vote(open.id, ids)} />
      )}
    </section>
  )
}

export function Past({ items, skew = 0, refresh }: { items: Item[]; skew?: number; refresh?: () => unknown }) {
  const closed = items.filter((i) => i.status === 'closed').reverse()
  if (!closed.length) return <p className="empty">마감된 주제가 생기면 여기에 결과가 나와요.</p>
  return (
    <>
      {closed.map((it) => (
        <article key={it.id} className="past">
          <h3>
            <Practice item={it} />
            {it.title}
          </h3>
          <Result item={it} />
          {it.objections > 0 && <p className="tip">확인 요청 {it.objections}건이 들어왔어요.</p>}
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

/** 방이 끝난 뒤: 모든 주제의 최종 결과를 한눈에 (연습은 빼요) */
export function Final({ items }: { items: Item[] }) {
  const done = items.filter((i) => i.status === 'closed' && !i.practice)
  if (!done.length) return null
  return (
    <section className="final" aria-labelledby="final-title" data-many={done.length > 10 ? 3 : done.length > 4 ? 2 : undefined}>
      <h2 id="final-title">최종 결과</h2>
      <ol>
        {done.map((it) => {
          const top = Math.max(0, ...it.options.map((o) => o.votes ?? 0))
          const win = it.options.filter((o) => top > 0 && o.votes === top).map((o) => o.label)
          return (
            <li key={it.id}>
              <span>{it.title}</span>
              <strong>{it.outcome ? (it.outcome === 'pass' ? '통과' : '통과 못 함') : win.length ? win.join(', ') : '고른 사람 없음'}</strong>
              <small>
                참여한 {it.voted}명 중 {it.outcome ? `${it.options[0]?.label} ${it.options[0]?.votes ?? 0}명` : win.length ? `${top}명이 골랐어요${win.length > 1 ? ' (동점)' : ''}` : '고른 사람이 없어요'}
              </small>
            </li>
          )
        })}
      </ol>
    </section>
  )
}

/** 화면 바꿔 보기: 태블릿 · 휴대폰에서 PC 화면으로, 또는 그 반대로. 고른 것은 이 브라우저에 기억해요. */
export const ViewSwitch = ({ to }: { to: 'pc' | 'auto' }) => (
  <p className="view-switch">
    <a href={to === 'pc' ? '/?view=pc' : '/m?view=auto'}>{to === 'pc' ? 'PC 화면으로 보기' : '휴대폰 · 태블릿 화면으로 보기'}</a>
  </p>
)

export const PRIVACY = '누가 무엇을 골랐는지는 어디에도 남지 않아요. 진행자도 볼 수 없어요.'
