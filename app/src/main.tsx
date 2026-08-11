import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'
import { setMergedIds } from './lib/storage'
import mergedIds from './data/merged-ids.json'

// progress saved against word rows the pipeline has since merged away is folded
// into the surviving word on load
setMergedIds(mergedIds as Record<string, string>)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
