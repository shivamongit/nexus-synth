import { copyFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

const root = dirname(fileURLToPath(import.meta.url))

function copyBasicPitchModel(): Plugin {
  const copy = () => {
    const dest = resolve(root, 'public/basic-pitch')
    const src = resolve(root, 'node_modules/@spotify/basic-pitch/model')
    mkdirSync(dest, { recursive: true })
    copyFileSync(resolve(src, 'model.json'), resolve(dest, 'model.json'))
    copyFileSync(resolve(src, 'group1-shard1of1.bin'), resolve(dest, 'group1-shard1of1.bin'))
  }
  return {
    name: 'copy-basic-pitch-model',
    buildStart: copy,
    configureServer: copy,
  }
}

export default defineConfig({
  plugins: [react(), copyBasicPitchModel()],
  optimizeDeps: {
    include: ['@tensorflow/tfjs', '@spotify/basic-pitch'],
  },
  server: {
    port: 5173,
    host: true,
    allowedHosts: true,
  },
  preview: {
    port: Number(process.env.PORT) || 4173,
    host: true,
    allowedHosts: true,
  },
})
