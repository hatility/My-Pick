// QR 을 SVG 길 하나로 (바깥 서비스 없이 이 기기에서 그려요). 큰 화면의 입장 QR 과 입장 코드 인쇄가 같이 써요.
import { useMemo } from 'react'
import qrcode from 'qrcode-generator'

export function Qr({ text, label = '입장 주소 QR' }: { text: string; label?: string }) {
  const { size, d } = useMemo(() => {
    const q = qrcode(0, 'M')
    q.addData(text)
    q.make()
    const n = q.getModuleCount()
    let d = ''
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) d += `M${c + 2} ${r + 2}h1v1h-1z`
    return { size: n + 4, d }
  }, [text])
  return (
    <svg className="qr" viewBox={`0 0 ${size} ${size}`} role="img" aria-label={label}>
      <rect width={size} height={size} fill="#fff" />
      <path d={d} fill="#14213d" />
    </svg>
  )
}
