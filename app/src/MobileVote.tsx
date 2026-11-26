// 픽 화면 (/m — 휴대폰 · 태블릿). 한 줄로 쌓고, 누르는 곳을 크게, 버튼은 엄지가 닿는 아래쪽에.
import { useEffect, useState } from 'react'
import { Hand } from 'lucide-react'
import { HeroArt } from './art'
import { Agenda, Current, Hands, TextSize, useEasy, useWakeLock, HomeFoot, HostDoor, JoinForm, Loading, ViewSwitch, Offline, OrgMark, Past, PRIVACY, ReportLink, TopBar, useVoter } from './parts'
import './mobile.css'

export function MobileVote() {
  const v = useVoter()
  useEasy(v.state?.room.easy)
  useWakeLock(!!v.state && !v.state.room.closed) // 방에 들어와 있는 동안 화면이 꺼지지 않게
  // 한 손 모드: 큰 휴대폰에서 고를 것을 화면 아래쪽(엄지가 닿는 곳)에 모아요. 이 브라우저에 기억해요.
  const [reach, setReach] = useState(() => {
    try {
      return localStorage.getItem('mypick-reach') === '1'
    } catch {
      return false
    }
  })
  const flip = () => {
    try {
      localStorage.setItem('mypick-reach', reach ? '0' : '1')
    } catch {
      /* 기억 못 해도 괜찮아요 */
    }
    setReach(!reach)
  }
  const wide = matchMedia('(min-width: 700px)').matches // 태블릿(세로로 들어도): 두 칸으로
  // 한 손 모드 단추는 손 모양만 있어서 뜻을 알기 어려워요: 처음 한 번만 말풍선으로 알려 줘요
  const [handTip, setHandTip] = useState(false)
  const inRoom = !!v.state
  useEffect(() => {
    if (!inRoom || wide) return
    try {
      if (localStorage.getItem('mypick-hand-tip')) return
      localStorage.setItem('mypick-hand-tip', '1')
    } catch {
      return
    }
    setHandTip(true)
    const t = setTimeout(() => setHandTip(false), 7000)
    return () => clearTimeout(t)
  }, [inRoom, wide])
  if (!v.ready) return <Loading />

  if (!v.state)
    return (
      <div className="m m-home">
        <TopBar org={v.org}>
          <a className="top-link" href="/guide">
            가이드
          </a>
        </TopBar>
        <main className="m-join">
          <HeroArt />
          <h1>
            모두가 믿을 수 있는
            <br />
            My Pick
          </h1>
          <p className="m-lead">방 번호만 넣으면 바로 참여해요. 가입도, 앱 설치도 필요 없어요.</p>
          <section className="hero-card" aria-labelledby="join-title">
            <h2 id="join-title">방 들어가기</h2>
            <JoinForm onJoined={v.refresh} />
          </section>
          <p className="privacy">{PRIVACY}</p>
          <HostDoor org={v.org} />
          <ViewSwitch to="pc" />
        </main>
        <HomeFoot org={v.org} />
      </div>
    )

  const s = v.state
  const closed = s.items.filter((i) => i.status === 'closed').length
  return (
    <div className="m" data-tone={s.room.tone || undefined} data-reach={reach || undefined}>
      <header className="m-bar">
        <div className="m-bar-top">
          <OrgMark org={s.org} />
          <div className="m-tools">
            <TextSize />
            <button type="button" className="icon-btn" aria-pressed={reach} aria-label="한 손 모드" title="한 손 모드: 고를 것을 화면 아래쪽에 모아요" onClick={() => (flip(), setHandTip(false))}>
              <Hand size={20} aria-hidden="true" />
            </button>
            {handTip && (
              <p className="hand-tip" role="note" onClick={() => setHandTip(false)}>
                <strong>한 손 모드</strong> 손 모양을 누르면 고를 것이 엄지가 닿는 아래쪽으로 모여요
              </p>
            )}
          </div>
        </div>
        <div className="m-room">
          <strong>
            {s.room.rehearsal && <span className="tag">리허설</span>}
            {s.room.title}
          </strong>
          <span>
            방 번호 {s.room.code}, 지금 {s.present}명 접속
          </span>
        </div>
      </header>
      <Offline online={v.online} />
      {/* 주제가 막 마감돼 기다리는 중이면(휴대폰), 기다림 칸을 줄이고 방금 결과를 바로 아래에 보여요 */}
      <main className="m-main" data-after={(closed > 0 && !s.room.closed && !s.items.some((i) => i.status === 'open')) || undefined}>
        <Current state={s} vote={v.vote} />
        <Hands state={s} />
        {/* 옆 칸(태블릿) · 아래(휴대폰): 이 방이 어디까지 왔는지, 지난 결과, 안내 */}
        <aside className="m-side">
          <section className="m-info" aria-labelledby="m-info-title" data-quiet={!s.items.some((i) => i.status === 'open') || undefined}>
            <h2 id="m-info-title">지금 이 방은</h2>
            {s.items.some((i) => i.status === 'open') && <Agenda state={s} />}
            <dl>
              <div>
                <dt>방 번호</dt>
                <dd>{s.room.code}</dd>
              </div>
              <div>
                <dt>들어온 사람</dt>
                <dd>{s.joined}명</dd>
              </div>
              <div>
                <dt>지금 접속</dt>
                <dd>{s.present}명</dd>
              </div>
            </dl>
            {closed === 0 && <p className="tip">주제가 마감되면 결과가 여기에 쌓여요.</p>}
          </section>
          {closed > 0 && (
            <details className="m-past" open={wide || s.room.closed || !s.items.some((i) => i.status === 'open')}>
              <summary>지난 주제 {closed}개</summary>
              <Past items={s.items} skew={s.skew} refresh={v.refresh} />
            </details>
          )}
          <p className="privacy">{PRIVACY}</p>
          <ReportLink />
          <p className="view-switch">
            <a href="/guide#join" target="_blank" rel="noopener">
              가이드
            </a>
          </p>
          <ViewSwitch to="pc" />
        </aside>
      </main>
    </div>
  )
}
