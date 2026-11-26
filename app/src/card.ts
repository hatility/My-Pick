// 결과 그림: 마감된 주제의 결과를 그림 한 장(PNG)으로 만들어 내려받아요. 브라우저 안에서만 그리고, 서버로 보내지 않아요.
import type { Item } from './api'

const W = 1080
const PAD = 84

/** 너비에 맞춰 줄을 나눠요 (한글은 글자 단위로). max 줄을 넘으면 끝에 … */
function wrap(g: CanvasRenderingContext2D, text: string, width: number, max: number) {
  const lines: string[] = []
  let line = ''
  for (const ch of text) {
    if (g.measureText(line + ch).width > width && line) {
      lines.push(line)
      line = ch.trimStart()
    } else line += ch
  }
  if (line) lines.push(line)
  if (lines.length <= max) return lines
  const cut = lines.slice(0, max)
  while (g.measureText(cut[max - 1] + '…').width > width) cut[max - 1] = cut[max - 1].slice(0, -1)
  cut[max - 1] += '…'
  return cut
}

export async function resultCard(item: Item, room: string, org: string) {
  await document.fonts.ready
  const family = getComputedStyle(document.body).fontFamily
  const font = (weight: number, px: number) => `${weight} ${px}px ${family}`
  const probe = document.createElement('canvas').getContext('2d')!
  probe.font = font(800, 56)
  const title = wrap(probe, item.title, W - PAD * 2, 3)
  probe.font = font(700, 36)
  const rows = item.options.map((o) => ({ votes: o.votes ?? 0, lines: wrap(probe, o.label, W - PAD * 2 - 230, 2) }))
  const top = Math.max(0, ...rows.map((r) => r.votes))
  const verdict = item.outcome === 'pass' ? '통과' : item.outcome === 'fail' ? '통과 못 함' : ''
  const H = 250 + title.length * 72 + (verdict ? 86 : 0) + rows.reduce((h, r) => h + r.lines.length * 48 + 62, 0) + 190

  const c = document.createElement('canvas')
  c.width = W
  c.height = H
  const g = c.getContext('2d')!
  g.fillStyle = '#f1f3f8'
  g.fillRect(0, 0, W, H)
  g.fillStyle = '#ffffff'
  g.beginPath()
  g.roundRect(36, 36, W - 72, H - 72, 28)
  g.fill()
  g.textBaseline = 'alphabetic'

  let y = 136
  g.fillStyle = '#56607a'
  g.font = font(600, 30)
  g.fillText(wrap(g, `${org}, ${room}`, W - PAD * 2, 1)[0], PAD, y)
  y += 84
  g.fillStyle = '#14213d'
  g.font = font(800, 56)
  for (const l of title) {
    g.fillText(l, PAD, y)
    y += 72
  }
  if (verdict) {
    g.font = font(800, 40)
    g.fillStyle = item.outcome === 'pass' ? '#cf2a2a' : '#56607a'
    g.fillText(verdict, PAD, y + 16)
    y += 86
  }
  y += 10
  for (const r of rows) {
    const win = top > 0 && r.votes === top
    g.font = font(win ? 800 : 600, 36)
    g.fillStyle = '#14213d'
    r.lines.forEach((l, i) => g.fillText(l, PAD, y + i * 48))
    g.textAlign = 'right'
    g.font = font(800, 36)
    g.fillText(`${r.votes}명${item.voted > 0 ? `  ${Math.round((r.votes / item.voted) * 100)}%` : ''}`, W - PAD, y)
    g.textAlign = 'left'
    y += (r.lines.length - 1) * 48 + 22
    g.fillStyle = '#e6e9f1'
    g.beginPath()
    g.roundRect(PAD, y, W - PAD * 2, 16, 8)
    g.fill()
    if (r.votes > 0) {
      g.fillStyle = win ? '#cf2a2a' : '#56607a'
      g.beginPath()
      g.roundRect(PAD, y, Math.max(16, ((W - PAD * 2) * r.votes) / Math.max(1, top)), 16, 8)
      g.fill()
    }
    y += 88
  }
  g.fillStyle = '#56607a'
  g.font = font(500, 28)
  g.fillText(`${item.eligible !== null ? `들어온 ${item.eligible}명 중 ` : ''}${item.voted}명 픽${item.abstain ? `, 그중 건너뜀 ${item.abstain}명` : ''}`, PAD, y)
  y += 46
  if (item.closedAt) g.fillText(`${new Date(item.closedAt).toLocaleString('ko-KR', { dateStyle: 'long', timeStyle: 'short' })} 마감`, PAD, y)
  y += 58
  if (item.proof) {
    g.fillStyle = '#2b4a9e'
    g.font = font(800, 32)
    g.fillText(`결과 확인 코드  ${item.proof}`, PAD, y)
  }
  g.fillStyle = '#56607a'
  g.font = font(600, 26)
  g.textAlign = 'right'
  g.fillText('My Pick', W - PAD, y)

  const blob = await new Promise<Blob | null>((done) => c.toBlob(done, 'image/png'))
  if (!blob) return
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `mypick-결과-${item.proof ?? item.id}.png`
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 5000)
}
