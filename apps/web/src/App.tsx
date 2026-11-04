import { Navigate, Route, Routes } from 'react-router-dom';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import Scanner from './pages/Scanner';
import Engine from './pages/Engine';
import Pay from './pages/Pay';
import Investigations from './pages/Investigations';
import Onboarding from './pages/Onboarding';
import Stores from './pages/Stores';
import Storefront from './pages/Storefront';
import Checkout from './pages/Checkout';
import AnalystConsole from './pages/AnalystConsole';
import Profile from './pages/Profile';
export default function App() {
  return <Routes>
    <Route element={<Layout />}>
      <Route index element={<Dashboard />} />
      <Route path="scanner" element={<Scanner />} />
      <Route path="engine" element={<Engine />} /><Route path="engine/:id" element={<Engine />} />
      <Route path="pay" element={<Pay />} /><Route path="pay/:id" element={<Pay />} />
      <Route path="investigations" element={<Investigations />} />
      <Route path="investigations/:id" element={<Investigations />} />
      <Route path="history" element={<Navigate to="/investigations" replace />} />
      <Route path="onboarding" element={<Onboarding />} />
      <Route path="stores" element={<Stores />} />
      <Route path="checkout/:id" element={<Checkout />} />
      <Route path="profile" element={<Profile />} />
    </Route>
    <Route path="/store/:id" element={<Storefront />} />
    <Route path="/analyst" element={<AnalystConsole />} />
    <Route path="*" element={<Navigate to="/" replace />} />
  </Routes>;
}
