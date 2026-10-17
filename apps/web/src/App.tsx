import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider } from '@/context/AuthContext'
import { AppLayout } from '@/components/layout/AppLayout'
import { GuestRoute, ProtectedRoute } from '@/components/ProtectedRoute'
import { AcceptInvitePage, LoginPage, RegisterPage } from '@/pages/auth/AuthPages'
import { ApiKeysPage } from '@/pages/ApiKeysPage'
import { DashboardPage } from '@/pages/DashboardPage'
import { DraftPage } from '@/pages/DraftPage'
import { DraftsPage } from '@/pages/DraftsPage'
import { ApprovedAnswersPage } from '@/pages/ApprovedAnswersPage'
import { DocumentsPage } from '@/pages/DocumentsPage'
import { TeamPage } from '@/pages/TeamPage'
import { WorkflowRunsPage } from '@/pages/WorkflowRunsPage'
import { UsagePage } from '@/pages/UsagePage'
import { SettingsPage } from '@/pages/SettingsPage'
import { useAuth } from '@/context/AuthContext'

function ManagerRoute({ children }: { children: React.ReactNode }) {
  const { user } = useAuth()
  return user?.role === 'ADMIN' || user?.role === 'MANAGER' ? children : <Navigate to="/settings" replace />
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route
            path="/login"
            element={
              <GuestRoute>
                <LoginPage />
              </GuestRoute>
            }
          />
          <Route
            path="/register"
            element={
              <GuestRoute>
                <RegisterPage />
              </GuestRoute>
            }
          />
          <Route path="/accept-invite" element={<AcceptInvitePage />} />

          <Route
            element={
              <ProtectedRoute>
                <AppLayout />
              </ProtectedRoute>
            }
          >
            <Route index element={<DashboardPage />} />
            <Route path="draft" element={<DraftsPage />} />
            <Route path="draft/:id" element={<DraftPage />} />
            <Route path="approved-answers" element={<ApprovedAnswersPage />} />
            <Route path="documents" element={<DocumentsPage />} />
            <Route path="workflow-runs" element={<WorkflowRunsPage />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="settings/team" element={<TeamPage />} />
            <Route path="settings/api-keys" element={<ManagerRoute><ApiKeysPage /></ManagerRoute>} />
            <Route path="settings/usage" element={<ManagerRoute><UsagePage /></ManagerRoute>} />
            <Route path="api-keys" element={<Navigate to="/settings/api-keys" replace />} />
            <Route path="usage" element={<Navigate to="/settings/usage" replace />} />
            <Route path="team" element={<Navigate to="/settings/team" replace />} />
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}
