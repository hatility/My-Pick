import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 개발 중에는 /api · /uploads 를 server.mjs (8788) 가 맡아요. npm run dev 가 둘을 함께 띄워요.
// changeOrigin: false — 받는 주소(Host)를 그대로 넘겨야 서버의 ‘다른 사이트 요청 막기’가 개발 중에도 맞게 동작해요
const api = { target: 'http://localhost:8788', changeOrigin: false }

export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/api': api, '/uploads': api } },
})
