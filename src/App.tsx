import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { Notebooks } from './screens/Notebooks'
import { Timeline } from './screens/Timeline'
import { EntryDetail } from './screens/EntryDetail'
import { Composer } from './screens/Composer'
import { Reflect } from './screens/Reflect'
import { Words } from './screens/Words'
import { Sentences } from './screens/Sentences'
import { Practice } from './screens/Practice'
import { Settings } from './screens/Settings'
import { Sandbox } from './screens/Sandbox'
import { WorkbookLayer } from './ui/WorkbookLayer'
import { Receipt } from './ui/Receipt'

/**
 * Routes. Technical plan §6.
 *
 * Only routes with a screen behind them are registered. Anything else redirects to the library rather
 * than landing on a placeholder, so the app never shows a page that does nothing.
 *
 * Two things are deliberately not routes. Extract is a modal over the entry, so it is `?extract=1` on
 * the entry route. An open workbook is `?workbook=<sessionId>` on whatever route is showing. Both then
 * get browser back for free, and back out of a workbook means minimize, which is the right intent.
 *
 * `<WorkbookLayer>` sits outside `<Routes>` on purpose. That is what lets the sheet appear over the
 * current screen without unmounting it, which is the entire mechanic in §7: minimize and the journal is
 * still exactly where it was, because it never went anywhere.
 *
 * `<Receipt>` sits out here for the same reason and one more. Inside `Shell` it would remount with the
 * screen, so a capture that navigated would take its own confirmation with it, and it would draw under
 * the sheet rather than over it.
 */
export const App = () => (
  <BrowserRouter>
    <Routes>
      <Route path="/" element={<Notebooks />} />
      <Route path="/n/:nb" element={<Timeline />} />
      <Route path="/n/:nb/e/:id" element={<EntryDetail />} />
      <Route path="/n/:nb/e/:id/edit" element={<Composer />} />
      <Route path="/n/:nb/e/:id/reflect" element={<Reflect />} />
      <Route path="/n/:nb/words" element={<Words />} />
      <Route path="/n/:nb/words/:id" element={<Words />} />
      <Route path="/n/:nb/sentences" element={<Sentences />} />
      <Route path="/n/:nb/sentences/:id" element={<Sentences />} />
      <Route path="/n/:nb/practice" element={<Practice />} />
      <Route path="/settings" element={<Settings />} />
      {/* Dev only. `Sandbox` is a redirect to the library in a production build. */}
      <Route path="/sandbox" element={<Sandbox />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
    <WorkbookLayer />
    <Receipt />
  </BrowserRouter>
)
