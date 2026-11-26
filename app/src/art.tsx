// 그림. 모두 SVG 이고 색 · 움직임은 styles.css 의 .art-* 가 정해요 (어두운 화면에서도 같이 바뀌어요).

/** 첫 화면: 픽 카드 한 장이 픽 상자에 꽂혀 있고, 열릴 때 도장이 한 번 찍혀요. */
export function HeroArt() {
  const rows = [102, 154, 206]
  return (
    <svg className="art" viewBox="0 0 480 440" role="img" aria-label="도장을 찍은 픽 카드가 픽 상자에 들어가는 그림">
      <ellipse className="art-shadow" cx="240" cy="412" rx="196" ry="14" />
      <rect className="art-box-back" x="74" y="234" width="332" height="40" rx="12" />
      <g className="art-paper" transform="rotate(-7 240 160)">
        <rect className="art-sheet" x="128" y="28" width="224" height="262" rx="10" />
        <rect className="art-ink" x="148" y="50" width="118" height="13" rx="6.5" />
        <rect className="art-faint" x="148" y="72" width="72" height="8" rx="4" />
        {rows.map((y, i) => (
          <g key={y}>
            <rect className="art-ink" x="128" y={y - 8} width="224" height="2" />
            <rect className={i === 1 ? 'art-ink' : 'art-faint'} x="148" y={y + 13} width={[92, 110, 78][i]} height="11" rx="5.5" />
          </g>
        ))}
        <rect className="art-ink" x="128" y="250" width="224" height="2" />
        <rect className="art-ink" x="296" y="94" width="2" height="156" />
        <rect className="art-tint" x="130" y="148" width="220" height="50" />
        <rect className="art-ink" x="148" y="167" width="110" height="11" rx="5.5" />
        <rect className="art-ink" x="296" y="148" width="2" height="50" />
        <g className="art-stamp">
          <circle cx="324" cy="173" r="17" />
          <path d="M316 173.5l5.8 5.8L332.5 167.2" strokeLinejoin="round" />
        </g>
      </g>
      <rect className="art-box" x="56" y="254" width="368" height="150" rx="22" />
      <rect className="art-slot" x="146" y="264" width="188" height="10" rx="5" />
      <g className="art-seal">
        <circle cx="240" cy="338" r="30" />
        <path d="M225.8 338.8l10.2 10.2L255 327.7" strokeLinejoin="round" />
      </g>
    </svg>
  )
}

/** 기다리는 동안: 작은 픽 상자에 용지가 천천히 들어가요. */
export function BoxArt() {
  return (
    <svg className="art art-small" viewBox="0 0 160 130" aria-hidden="true">
      <rect className="art-box-back" x="26" y="52" width="108" height="16" rx="6" />
      <g className="art-drop">
        <rect className="art-sheet" x="54" y="6" width="52" height="62" rx="5" />
        <rect className="art-ink" x="62" y="16" width="28" height="5" rx="2.5" />
        <rect className="art-faint" x="62" y="28" width="36" height="4" rx="2" />
        <rect className="art-faint" x="62" y="38" width="24" height="4" rx="2" />
      </g>
      <rect className="art-box" x="18" y="60" width="124" height="62" rx="12" />
      <rect className="art-slot" x="48" y="65" width="64" height="5" rx="2.5" />
      <g className="art-seal">
        <circle cx="80" cy="96" r="13" />
        <path d="M73.8 96.3l4.5 4.5L86.5 91.6" strokeLinejoin="round" />
      </g>
    </svg>
  )
}
