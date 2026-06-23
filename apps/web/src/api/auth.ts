import { apiClient } from './client'
import type { ApiResponse, AuthUser } from '@/types/api'

export interface LoginPayload {
  email: string
  password: string
}

export interface RegisterPayload {
  firstName: string
  lastName: string
  email: string
  password: string
  organizationName: string
  organizationSlug: string
}

export interface AcceptInvitePayload {
  token: string
  firstName: string
  lastName: string
  password: string
}

interface AuthData {
  user: AuthUser
  accessToken: string
}

export async function login(payload: LoginPayload) {
  const { data } = await apiClient.post<ApiResponse<AuthData>>('/auth/login', payload)
  return data.data
}

export async function register(payload: RegisterPayload) {
  const { data } = await apiClient.post<ApiResponse<AuthData>>('/auth/register', payload)
  return data.data
}

export async function acceptInvite(payload: AcceptInvitePayload) {
  const { data } = await apiClient.post<ApiResponse<AuthData>>('/auth/accept-invite', payload)
  return data.data
}

export async function logout() {
  await apiClient.post('/auth/logout')
}

export async function refreshSession() {
  const { data } = await apiClient.post<ApiResponse<AuthData>>('/auth/refresh')
  return data.data
}

export async function getMe() {
  const { data } = await apiClient.get<ApiResponse<AuthUser>>('/users/me')
  return data.data
}
