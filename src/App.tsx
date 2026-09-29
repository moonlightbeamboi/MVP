import { Route, Routes } from 'react-router-dom'
import TopBar from './components/TopBar'
import Home from './pages/Home'
import SensePage from './pages/SensePage'
import DashboardPage from './pages/DashboardPage'
import HowItWorks from './pages/HowItWorks'

export default function App() {
  return (
    <div className="flex min-h-screen flex-col">
      <TopBar />
      <main className="mx-auto w-full max-w-[1600px] flex-1 px-4 py-5">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/bus-unit" element={<SensePage />} />
          <Route path="/control-room" element={<DashboardPage />} />
          <Route path="/how-it-works" element={<HowItWorks />} />
          <Route path="*" element={<Home />} />
        </Routes>
      </main>
      <footer className="border-t border-slate-800/60 py-3 text-center text-[0.68rem] text-slate-600">
        UrbanEye — Smart India Hackathon 2026 prototype · “AI-Powered Mobile Urban Intelligence Platform Using Public Transport Fleet”
      </footer>
    </div>
  )
}
