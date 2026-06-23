import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider } from '@/context/AuthContext'
import { AppLayout } from '@/components/layout/AppLayout'
import { GuestRoute, ProtectedRoute } from '@/components/ProtectedRoute'
import { AcceptInvitePage, LoginPage, RegisterPage } from '@/pages/auth/AuthPages'
import { ApiKeysPage } from '@/pages/ApiKeysPage'
import { DashboardPage } from '@/pages/DashboardPage'
import { DocumentsPage } from '@/pages/DocumentsPage'
import { TeamPage } from '@/pages/TeamPage'
import { WorkflowRunsPage } from '@/pages/WorkflowRunsPage'

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
            <Route path="documents" element={<DocumentsPage />} />
            <Route path="api-keys" element={<ApiKeysPage />} />
            <Route path="workflow-runs" element={<WorkflowRunsPage />} />
            <Route path="team" element={<TeamPage />} />
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}
