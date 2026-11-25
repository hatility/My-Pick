// 픽 화면 (PC). 들어오기 전에는 첫 화면, 들어온 뒤에는 왼쪽에 지금 안건 · 오른쪽에 지난 안건 결과.
import { HeroArt } from './art'
import { Current, HomeFoot, HostDoor, JoinForm, Loading, Offline, OrgMark, Past, PRIVACY, ReportLink, Stamp, ThemeToggle, TopBar, useVoter } from './parts'

export function Vote() {
  const v = useVoter()
  if (!v.ready) return <Loading />

  if (!v.state)
    return (
      <div className="home">
        <TopBar org={v.org}>
          <a className="top-link" href="/guide">
            안내
          </a>
          {v.org?.open && (
            <a className="top-link" href="/host">
              내 방 진행하기
            </a>
          )}
        </TopBar>
        <main className="hero">
          <div className="hero-copy">
            <h1>
              모두가 믿을 수 있는
              <br />
              My Pick
            </h1>
            <p className="hero-lead">방 번호만 넣으면 바로 참여해요. 가입도, 앱 설치도 필요 없어요.</p>
            <section className="hero-card" aria-labelledby="join-title">
              <h2 id="join-title">방 들어가기</h2>
              <JoinForm onJoined={v.refresh} />
            </section>
          </div>
          <HeroArt />
        </main>
        <ul className="promise">
          <li>
            <Stamp />
            <strong>아무도 모르게</strong>
            {PRIVACY}
          </li>
          <li>
            <Stamp />
            <strong>한 사람 한 번</strong>한 안건에 한 번만 픽할 수 있어요. 확정하면 바꿀 수 없어요.
          </li>
          <li>
            <Stamp />
            <strong>끊겨도 이어서</strong>
            새로고침하거나 창을 닫았다 열어도 이어서 할 수 있어요.
          </li>
        </ul>
        <div className="home-door">
          <HostDoor org={v.org} />
        </div>
        <HomeFoot org={v.org} />
      </div>
    )

  const s = v.state
  return (
    <div className="pc" data-tone={s.room.tone || undefined}>
      <header className="bar">
        <OrgMark org={s.org} />
        <div className="bar-room">
          <strong>
            {s.room.rehearsal && <span className="tag">리허설</span>}
            {s.room.title}
          </strong>
          <span>방 번호 {s.room.code}</span>
        </div>
        <span className="bar-count">지금 {s.present}명 접속</span>
        <ThemeToggle />
      </header>
      <Offline online={v.online} />
      <main className="pc-main">
        <div className="pc-cur">
          <Current state={s} vote={v.vote} />
          <p className="privacy">{PRIVACY}</p>
          <ReportLink />
        </div>
        <aside className="pc-side" aria-labelledby="past-title">
          <h2 id="past-title">지난 안건</h2>
          <Past items={s.items} skew={s.skew} refresh={v.refresh} />
        </aside>
      </main>
    </div>
  )
}
