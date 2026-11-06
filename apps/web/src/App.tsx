import { Navigate, Route, Routes, useParams } from 'react-router-dom';
import Layout from './components/Layout';
import Home from './pages/Home';
import Check from './pages/Check';
import Engine from './pages/Engine';
import Pay from './pages/Pay';
import Investigations from './pages/Investigations';
import Onboarding from './pages/Onboarding';
import Stores from './pages/Stores';
import Storefront from './pages/Storefront';
import Checkout from './pages/Checkout';
import AnalystConsole from './pages/AnalystConsole';
import Profile from './pages/Profile';
/** The old case-list address with an id now goes straight to the case page. */
function CaseRedirect() {
  const { id } = useParams();
  return <Navigate to={`/engine/${id ?? ''}`} replace />;
}
export default function App() {
  return <Routes>
    <Route element={<Layout />}>
      <Route index element={<Home />} />
      <Route path="check" element={<Check />} />
      <Route path="scanner" element={<Navigate to="/check" replace />} />
      <Route path="engine" element={<Engine />} /><Route path="engine/:id" element={<Engine />} />
      <Route path="pay" element={<Pay />} /><Route path="pay/:id" element={<Pay />} />
      <Route path="investigations" element={<Investigations />} />
      <Route path="investigations/:id" element={<CaseRedirect />} />
      <Route path="history" element={<Navigate to="/investigations" replace />} />
      <Route path="onboarding" element={<Onboarding />} />
      <Route path="stores" element={<Stores />} />
      <Route path="checkout/:id" element={<Checkout />} />
      <Route path="profile" element={<Profile />} />
      <Route path="analyst" element={<AnalystConsole />} />
    </Route>
    <Route path="/store/:id" element={<Storefront />} />
    <Route path="*" element={<Navigate to="/" replace />} />
  </Routes>;
}
