import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { AuthFooterLink, AuthLayout } from '@/components/auth/AuthLayout'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { useAuth } from '@/context/AuthContext'
import { getErrorMessage } from '@/api/client'
import { validateInviteToken } from '@/api/team'

export function LoginPage() {
  const { login } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await login({ email, password })
    } catch (err) {
      setError(getErrorMessage(err, 'Login failed'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthLayout
      title="Welcome back"
      subtitle="Sign in to manage your Sellora workspace"
      footer={
        <>
          New organization? <AuthFooterLink to="/register">Create an account</AuthFooterLink>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
            {error}
          </div>
        )}
        <Input
          label="Email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <Input
          label="Password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        <Button type="submit" className="w-full" loading={loading}>
          Sign in
        </Button>
      </form>
    </AuthLayout>
  )
}

export function RegisterPage() {
  const { register } = useAuth()
  const [form, setForm] = useState({
    firstName: '',
    lastName: '',
    email: '',
    password: '',
    organizationName: '',
    organizationSlug: '',
  })
  const [slugTouched, setSlugTouched] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  function updateField(field: keyof typeof form, value: string) {
    setForm((prev) => {
      const next = { ...prev, [field]: value }
      if (field === 'organizationName' && !slugTouched) {
        next.organizationSlug = value
          .toLowerCase()
          .trim()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-+|-+$/g, '')
      }
      return next
    })
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await register(form)
    } catch (err) {
      setError(getErrorMessage(err, 'Registration failed'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthLayout
      title="Create your workspace"
      subtitle="Register as an admin to set up your organization"
      footer={
        <>
          Already have an account? <AuthFooterLink to="/login">Sign in</AuthFooterLink>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
            {error}
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Input
            label="First name"
            value={form.firstName}
            onChange={(e) => updateField('firstName', e.target.value)}
            required
          />
          <Input
            label="Last name"
            value={form.lastName}
            onChange={(e) => updateField('lastName', e.target.value)}
            required
          />
        </div>
        <Input
          label="Work email"
          type="email"
          value={form.email}
          onChange={(e) => updateField('email', e.target.value)}
          required
        />
        <Input
          label="Password"
          type="password"
          value={form.password}
          onChange={(e) => updateField('password', e.target.value)}
          required
          placeholder="Min 8 chars, upper, lower, number"
        />
        <Input
          label="Organization name"
          value={form.organizationName}
          onChange={(e) => updateField('organizationName', e.target.value)}
          required
        />
        <Input
          label="Organization slug"
          value={form.organizationSlug}
          onChange={(e) => {
            setSlugTouched(true)
            updateField('organizationSlug', e.target.value)
          }}
          required
          placeholder="acme-corp"
        />
        <Button type="submit" className="w-full" loading={loading}>
          Create account
        </Button>
      </form>
    </AuthLayout>
  )
}

export function AcceptInvitePage() {
  const { acceptInvite } = useAuth()
  const token = new URLSearchParams(window.location.search).get('token') ?? ''
  const [inviteInfo, setInviteInfo] = useState<{
    email: string
    organizationName: string
    role: string
  } | null>(null)
  const [loadError, setLoadError] = useState('')
  const [form, setForm] = useState({ firstName: '', lastName: '', password: '' })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!token) {
      setLoadError('Invalid invite link. Ask your admin for a new invitation.')
      return
    }

    validateInviteToken(token)
      .then((data) =>
        setInviteInfo({
          email: data.email,
          organizationName: data.organizationName,
          role: data.role,
        })
      )
      .catch((err) => setLoadError(getErrorMessage(err, 'Invite is invalid or expired')))
  }, [token])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await acceptInvite({ token, ...form })
    } catch (err) {
      setError(getErrorMessage(err, 'Could not accept invite'))
    } finally {
      setLoading(false)
    }
  }

  if (loadError) {
    return (
      <AuthLayout title="Invite unavailable" subtitle={loadError}>
        <Link to="/login" className="text-sm text-zinc-300 hover:text-white">
          Go to login
        </Link>
      </AuthLayout>
    )
  }

  if (!inviteInfo) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-700 border-t-zinc-200" />
      </div>
    )
  }

  return (
    <AuthLayout
      title={`Join ${inviteInfo.organizationName}`}
      subtitle={`You've been invited as ${inviteInfo.role}. Set up your account for ${inviteInfo.email}.`}
      footer={
        <>
          Already have an account? <AuthFooterLink to="/login">Sign in</AuthFooterLink>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
            {error}
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Input
            label="First name"
            value={form.firstName}
            onChange={(e) => setForm((p) => ({ ...p, firstName: e.target.value }))}
            required
          />
          <Input
            label="Last name"
            value={form.lastName}
            onChange={(e) => setForm((p) => ({ ...p, lastName: e.target.value }))}
            required
          />
        </div>
        <Input
          label="Password"
          type="password"
          value={form.password}
          onChange={(e) => setForm((p) => ({ ...p, password: e.target.value }))}
          required
        />
        <Button type="submit" className="w-full" loading={loading}>
          Accept invite
        </Button>
      </form>
    </AuthLayout>
  )
}
