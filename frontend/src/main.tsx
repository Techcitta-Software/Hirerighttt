import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './styles/hire-theme.css'
import './styles/hr-marketing-ui.css'
import './styles/system.css'
import App from './App.tsx'
import { loadRouteForFirstPaint } from './routeImports'

// Fetch the current page's code first and render once it is here: the page then paints in a single pass
// instead of showing an empty Suspense fallback that React holds on screen for at least 300ms.
void loadRouteForFirstPaint(window.location.pathname).then(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
})
