import React from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ThemeProvider } from './context/ThemeContext';
import { ToastProvider } from './context/ToastContext';
import LandingPage from './pages/LandingPage';
import AuthPage from './pages/AuthPage';
import DashboardPage from './pages/DashboardPage';
import NewScanPage from './pages/NewScanPage';
import ReportPage from './pages/ReportPage';
import HistoryPage from './pages/HistoryPage';
import ProfilePage from './pages/ProfilePage';
import LiveScanPage from './pages/LiveScanPage';
import Sidebar from './components/layout/Sidebar';
import Navbar from './components/layout/Navbar';
import AiAssistant from './components/AiAssistant';
import { ActiveScanProvider } from './context/ActiveScanContext';
import './styles/layout.css';

const PAGE_PATHS = {
  dashboard: '/dashboard',
  scan:      '/scan',
  history:   '/history',
  reports:   '/reports',
  profile:   '/profile',
};

function AppShell() {
  const location = useLocation();
  const navigate = useNavigate();
  const currentPage = location.pathname.split('/')[1] || 'dashboard';
  const onNavigate = (page) => navigate(PAGE_PATHS[page] || '/dashboard');

  return (
    <div className="app-shell">
      <Sidebar currentPage={currentPage} onNavigate={onNavigate} />
      <Navbar currentPage={currentPage} />
      <main className="main-content page-transition" key={location.pathname}>
        <Routes>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/auth" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<DashboardPage onNavigate={onNavigate} />} />
          <Route path="/scan" element={<NewScanPage />} />
          <Route path="/scan/live/:testId" element={<LiveScanPage onNavigate={onNavigate} />} />
          <Route path="/history" element={<HistoryPage onNavigate={onNavigate} />} />
          <Route path="/reports" element={<ReportPage onNavigate={onNavigate} />} />
          <Route path="/reports/:reportId" element={<ReportPage onNavigate={onNavigate} />} />
          <Route path="/report/:reportId" element={<ReportPage onNavigate={onNavigate} />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </main>
      <AiAssistant />
    </div>
  );
}

function Root() {
  const { user } = useAuth();
  const navigate = useNavigate();

  if (user) return <AppShell />;

  return (
    <Routes>
      <Route
        path="/"
        element={<LandingPage onGetStarted={() => navigate('/auth')} onSignIn={() => navigate('/auth')} />}
      />
      <Route path="/auth" element={<AuthPage onBack={() => navigate('/')} />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <ToastProvider>
        <AuthProvider>
          <ActiveScanProvider>
            <Root />
          </ActiveScanProvider>
        </AuthProvider>
      </ToastProvider>
    </ThemeProvider>
  );
}
