// 큰 화면 (/screen/방번호?k=열쇠): 빔프로젝터 · TV 에 띄워 두고 모두가 같이 봐요.
//  - 안건이 없을 때: 들어오는 방법 (주소 · 방 번호 · QR)
//  - 픽 받는 중: 안건, 남은 시간, 몇 명이 픽했는지 (결과는 ‘실시간 공개’ 방일 때만)
//  - 마감 뒤: 결과
import { Maximize } from 'lucide-react'
import { api, type Item, type RoomState } from './api'
import { Qr } from './Qr'
import { clock, Loading, Lost, OrgMark, Result, secondsLeft, spanOf, Stamp, ThemeToggle, TimeLeft, useLive, useTick } from './parts'
import './screen.css'

const RING = 2 * Math.PI * 54
/** 남은 시간을 고리로. 줄어드는 만큼 고리가 풀려요. */
function BigTime({ item, skew }: { item: Item; skew: number }) {
  useTick(true) // 이 고리만 1초에 네 번 다시 그려요 (화면 전체는 그대로)
  const left = secondsLeft(item, skew)
  if (left === null) return null
  const span = spanOf(item)
  const part = span ? Math.min(1, left / span) : 0
  return (
    <div className={`sc-ring${left <= 10 ? ' sc-ring-soon' : ''}${left >= 3600 ? ' sc-ring-long' : ''}`}>
      <svg viewBox="0 0 120 120" aria-hidden="true">
        <circle className="sc-ring-track" cx="60" cy="60" r="54" />
        <circle className="sc-ring-fill" cx="60" cy="60" r="54" strokeDasharray={`${RING * part} ${RING}`} transform="rotate(-90 60 60)" />
      </svg>
      <span>{clock(left)}</span>
    </div>
  )
}

/** 픽 현황: 들어온 사람 한 명이 점 하나. 누가 했는지는 알 수 없게 앞에서부터 채워요. */
function Dots({ voted, total }: { voted: number; total: number }) {
  if (total === 0 || total > 240)
    return (
      <svg className="sc-bar-svg" viewBox="0 0 100 3" preserveAspectRatio="none" aria-hidden="true">
        <rect className="sc-track" width="100" height="3" />
        <rect className="sc-fill" width={total ? Math.min(100, (voted / total) * 100) : 0} height="3" />
      </svg>
    )
  return (
    <div className={`sc-dots${total > 80 ? ' sc-dots-many' : ''}`} aria-hidden="true">
      {Array.from({ length: total }, (_, i) => (
        <span key={i} className={i < voted ? 'on' : undefined} />
      ))}
    </div>
  )
}

export function Screen({ code }: { code: string }) {
  const k = new URLSearchParams(location.search).get('k') ?? ''
  const query = `room=${code}&k=${encodeURIComponent(k)}`
  const live = useLive(
    () => api<RoomState>(`/api/screen?${query}`),
    () => `/api/events?${query}`,
  )
  const s = live.state

  if (!live.ready) return <Loading />
  if (!s)
    return (
      <Lost title="큰 화면을 열 수 없어요">방이 지워졌거나 주소가 달라요. 진행 화면에서 ‘큰 화면 열기’를 다시 눌러 주세요.</Lost>
    )

  const origin = s.siteUrl || location.origin
  const open = s.items.find((i) => i.status === 'open')
  const last = [...s.items].reverse().find((i) => i.status === 'closed')
  const done = s.items.filter((i) => i.status === 'closed').length
  const mode = s.room.screenMode // 진행자가 고른 것: 자동 · 입장 안내 · 마지막 결과 · 공지

  return (
    <div className="sc" data-tone={s.room.tone || undefined}>
      <header className="sc-bar">
        <OrgMark org={s.org} />
        <strong className="sc-room">
          {s.room.rehearsal && <span className="tag">리허설</span>}
          {s.room.title}
        </strong>
        <span className="sc-count">
          {s.present}명 접속{!live.online && ' (다시 연결하는 중)'}
        </span>
        <button className="sc-full" aria-label="전체 화면" onClick={() => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen())}>
          <Maximize size={22} aria-hidden="true" />
        </button>
      </header>

      <main className="sc-main">
        {mode === 'notice' ? (
          <section className="sc-wait">
            <p className="sc-kicker">알려 드려요</p>
            <h1 className="sc-notice">{s.room.notice}</h1>
          </section>
        ) : open ? (
          <section className="sc-vote">
            <p className="sc-kicker">{open.practice ? '연습 픽' : `${done + 1}번째 안건`}, 픽 받는 중</p>
            <div className="sc-head">
              <BigTime item={open} skew={s.skew} />
              <div>
                <h1>{open.title}</h1>
                {open.note && <p className="sc-note">{open.note}</p>}
              </div>
            </div>
            <div className="sc-progress">
              <Dots voted={open.voted} total={s.joined} />
              <p>
                <strong>{open.voted}</strong> / {s.joined}명 픽함
              </p>
            </div>
            {open.revealed ? <Result item={open} /> : <p className="sc-hint">결과는 마감되면 여기에 나와요.</p>}
          </section>
        ) : last && mode !== 'join' && (s.room.locked || s.room.closed || done > 0) ? (
          <section className="sc-vote">
            <p className="sc-kicker">{s.room.closed ? 'My Pick 이 모두 끝났어요' : `${done}번째 안건 결과`}</p>
            <h1>{last.title}</h1>
            {last.practice && <p className="sc-note">연습이었어요.</p>}
            <Result item={last} />
          </section>
        ) : (
          <section className="sc-wait">
            <Stamp className="sc-stamp" />
            <h1>곧 My Pick 을 시작해요</h1>
            <p>오른쪽 안내대로 들어와 주세요.</p>
          </section>
        )}

        {!s.room.closed && (!s.room.locked || mode === 'join') && mode !== 'notice' && (
          <aside className="sc-join" aria-label="들어오는 방법">
            <Qr text={`${origin}/?room=${code}`} />
            <p className="sc-url">{origin.replace(/^https?:\/\//, '')}</p>
            <p className="sc-label">방 번호</p>
            <p className="sc-code">{code}</p>
            <p className="sc-joined">{s.joined}명 들어왔어요</p>
          </aside>
        )}
      </main>
    </div>
  )
}

/** 참관인 화면 (/observe/방번호?k=열쇠): 고르거나 조작할 수는 없고, 진행 상황 · 결과 · 이 방의 기록만 봐요. */
type Watched = RoomState & { intact: boolean; log: { at: number; action: string; by: string | null; detail: Record<string, unknown> }[] }
export function Observe({ code }: { code: string }) {
  const k = new URLSearchParams(location.search).get('k') ?? ''
  const query = `room=${code}&k=${encodeURIComponent(k)}`
  const live = useLive(
    () => api<RoomState>(`/api/observe?${query}`),
    () => `/api/events?${query}`,
  )
  const s = live.state as (Watched & { skew: number }) | null
  if (!live.ready) return <Loading />
  if (!s)
    return (
      <Lost title="참관인 화면을 열 수 없어요">방이 지워졌거나 주소가 달라요. 진행자에게 참관인 주소를 다시 받아 주세요.</Lost>
    )
  const open = s.items.find((i) => i.status === 'open')
  return (
    <div className="home watch" data-tone={s.room.tone || undefined}>
      <header className="top">
        <OrgMark org={s.org} />
        <nav className="top-nav">
          <strong>참관인 화면</strong>
          <ThemeToggle />
          <button className="icon-btn" aria-label="전체 화면" title="전체 화면" onClick={() => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen())}>
            <Maximize size={20} aria-hidden="true" />
          </button>
        </nav>
      </header>
      <main className="guide watch-main">
        <header className="guide-head">
          <h1>
            {s.room.rehearsal && <span className="tag">리허설</span>}
            {s.room.title}
          </h1>
          <ul className="watch-facts">
            <li>
              <strong>{s.room.code}</strong>방 번호
            </li>
            <li>
              <strong>{s.joined}</strong>들어온 사람
            </li>
            <li>
              <strong>{s.present}</strong>지금 접속
            </li>
            <li>
              <strong>
                {s.agenda.done} / {s.agenda.total}
              </strong>
              끝난 안건
            </li>
          </ul>
          <p className="tip">
            지켜보기만 하는 화면이에요. 고르거나 진행을 바꿀 수 없고, 누가 무엇을 골랐는지는 여기에서도 볼 수 없어요.{!live.online && ' (다시 연결하는 중)'}
          </p>
        </header>
        <section className="guide-sec watch-now">
          <h2>지금</h2>
          {open ? (
            <>
              <p className="watch-title">{open.title}</p>
              <TimeLeft item={open} skew={s.skew} />
              <Dots voted={open.voted} total={s.joined} />
              <p>
                <strong>{open.voted}</strong> / {s.joined}명 참여
              </p>
              {open.revealed ? <Result item={open} /> : <p className="tip">결과는 마감되면 여기에 나와요. 지금은 진행자도 볼 수 없어요.</p>}
            </>
          ) : (
            <p className="tip">
              {s.room.closed ? '모두 끝난 방이에요.' : '지금 열려 있는 안건이 없어요.'}
              {!s.room.closed && s.agenda.next ? ` 다음은 ‘${s.agenda.next}’.` : ''}
              {s.nextOpenAt ? ` ${new Date(s.nextOpenAt).toLocaleString('ko-KR', { month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' })}에 열려요.` : ''}
            </p>
          )}
        </section>
        {s.items.some((i) => i.status === 'closed') && (
          <section className="guide-sec watch-done">
            <h2>마감된 안건</h2>
            {s.items
              .filter((i) => i.status === 'closed')
              .reverse()
              .map((it) => (
                <article key={it.id} className="past">
                  <h3>{it.title}</h3>
                  <Result item={it} />
                  {it.objections > 0 && <p className="tip">이의 {it.objections}건이 접수됐어요.</p>}
                </article>
              ))}
          </section>
        )}
        <section className="guide-sec watch-side">
          <h2>이 방에서 진행자가 한 일</h2>
          <p className={`seal ${s.intact ? 'seal-ok' : 'seal-bad'}`}>
            <Stamp />
            {s.intact ? '기록이 처음부터 끝까지 이어져 있어요. 고치거나 뺀 흔적이 없어요.' : '기록이 중간에 어긋나 있어요. 저장 파일을 누가 직접 고쳤을 수 있어요.'}
          </p>
          <ul className="watch-log">
            {s.log.map((r, i) => (
              <li key={i}>
                <time dateTime={new Date(r.at).toISOString()}>{new Date(r.at).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit' })}</time>
                <strong>{r.action}</strong>
                <span>{[r.by, r.detail.제목, r.detail.이유, r.detail.방법].filter(Boolean).join(', ')}</span>
              </li>
            ))}
          </ul>
        </section>
      </main>
    </div>
  )
}
