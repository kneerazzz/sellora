import { lazy, Suspense } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider } from '@/context/AuthContext'
import { AppLayout } from '@/components/layout/AppLayout'
import { GuestRoute, ProtectedRoute } from '@/components/ProtectedRoute'
import { useAuth } from '@/context/AuthContext'

const authPages = () => import('@/pages/auth/AuthPages')
const AcceptInvitePage = lazy(() => authPages().then(module => ({ default: module.AcceptInvitePage })))
const LoginPage = lazy(() => authPages().then(module => ({ default: module.LoginPage })))
const RegisterPage = lazy(() => authPages().then(module => ({ default: module.RegisterPage })))
const ApiKeysPage = lazy(() => import('@/pages/ApiKeysPage').then(module => ({ default: module.ApiKeysPage })))
const DashboardPage = lazy(() => import('@/pages/DashboardPage').then(module => ({ default: module.DashboardPage })))
const DraftPage = lazy(() => import('@/pages/DraftPage').then(module => ({ default: module.DraftPage })))
const DraftsPage = lazy(() => import('@/pages/DraftsPage').then(module => ({ default: module.DraftsPage })))
const ApprovedAnswersPage = lazy(() => import('@/pages/ApprovedAnswersPage').then(module => ({ default: module.ApprovedAnswersPage })))
const DocumentsPage = lazy(() => import('@/pages/DocumentsPage').then(module => ({ default: module.DocumentsPage })))
const TeamPage = lazy(() => import('@/pages/TeamPage').then(module => ({ default: module.TeamPage })))
const WorkflowRunsPage = lazy(() => import('@/pages/WorkflowRunsPage').then(module => ({ default: module.WorkflowRunsPage })))
const UsagePage = lazy(() => import('@/pages/UsagePage').then(module => ({ default: module.UsagePage })))
const SettingsPage = lazy(() => import('@/pages/SettingsPage').then(module => ({ default: module.SettingsPage })))
const QuestionnairesPage = lazy(() => import('@/pages/QuestionnairesPage').then(module => ({ default: module.QuestionnairesPage })))

function ManagerRoute({ children }: { children: React.ReactNode }) {
  const { user } = useAuth()
  return user?.role === 'ADMIN' || user?.role === 'MANAGER' ? children : <Navigate to="/settings" replace />
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Suspense fallback={<p role="status">Loading page…</p>}><Routes>
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
            <Route path="questionnaires" element={<QuestionnairesPage />} />
            <Route path="questionnaires/:id" element={<QuestionnairesPage />} />
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
        </Routes></Suspense>
      </AuthProvider>
    </BrowserRouter>
  )
}
