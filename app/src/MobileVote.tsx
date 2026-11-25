// 픽 화면 (/m — 휴대폰 · 태블릿). 한 줄로 쌓고, 누르는 곳을 크게, 버튼은 엄지가 닿는 아래쪽에.
import { useState } from 'react'
import { Hand } from 'lucide-react'
import { HeroArt } from './art'
import { Current, HomeFoot, HostDoor, JoinForm, Loading, Offline, OrgMark, Past, PRIVACY, ReportLink, TopBar, useVoter } from './parts'
import './mobile.css'

export function MobileVote() {
  const v = useVoter()
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
  const wide = matchMedia('(min-width: 900px)').matches // 태블릿: 두 칸으로
  if (!v.ready) return <Loading />

  if (!v.state)
    return (
      <div className="m m-home">
        <TopBar org={v.org}>
          <a className="top-link" href="/guide">
            안내
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
          <button type="button" className="icon-btn" aria-pressed={reach} aria-label="한 손 모드" title="한 손 모드: 고를 것을 화면 아래쪽에 모아요" onClick={flip}>
            <Hand size={20} aria-hidden="true" />
          </button>
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
      <main className="m-main">
        <Current state={s} vote={v.vote} />
        <p className="privacy">{PRIVACY}</p>
        <ReportLink />
        {closed > 0 && (
          <details className="m-past" open={wide || s.room.closed || !s.items.some((i) => i.status === 'open')}>
            <summary>지난 안건 {closed}개</summary>
            <Past items={s.items} skew={s.skew} refresh={v.refresh} />
          </details>
        )}
      </main>
    </div>
  )
}
