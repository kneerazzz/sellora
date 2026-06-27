import { render } from 'preact'
import { ChatWidget } from './ChatWidget'
import { setConfig, type CopilotConfig } from './api'
import './styles.css'

const ROOT_ID = 'sellora-copilot-root'

function mount() {
  let el = document.getElementById(ROOT_ID)
  if (!el) {
    el = document.createElement('div')
    el.id = ROOT_ID
    document.body.appendChild(el)
  }
  render(<ChatWidget />, el)
}

function init(options: CopilotConfig) {
  if (!options?.apiKey) {
    console.error('[Sellora Copilot] apiKey is required')
    return
  }

  setConfig({
    apiUrl: options.apiUrl ?? import.meta.env.VITE_API_URL ?? 'http://localhost:4000/api/v1',
    apiKey: options.apiKey,
    position: options.position ?? 'bottom-right',
  })

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount)
  } else {
    mount()
  }
}

function destroy() {
  const el = document.getElementById(ROOT_ID)
  if (el) {
    render(null, el)
    el.remove()
  }
}

declare global {
  interface Window {
    SelloraCopilot: { init: typeof init; destroy: typeof destroy }
  }
}

window.SelloraCopilot = { init, destroy }

export { init, destroy }

/* local dev */
if (import.meta.env.DEV) {
  const key = import.meta.env.VITE_API_KEY
  if (key) init({ apiKey: key })
  else console.warn('[Sellora Copilot] Add VITE_API_KEY to .env for dev')
}
