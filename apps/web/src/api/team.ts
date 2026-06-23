import { apiClient } from './client'
import type { ApiResponse, Invite, InviteValidation, TeamMember } from '@/types/api'

export async function listInvites(params?: { page?: number; limit?: number; status?: string }) {
  const { data } = await apiClient.get<ApiResponse<Invite[]>>('/invites', { params })
  return { items: data.data, meta: data.meta }
}

export async function createInvite(payload: { email: string; role: 'MANAGER' | 'REP' }) {
  const { data } = await apiClient.post<ApiResponse<{ invite: Invite; inviteUrl: string }>>(
    '/invites',
    payload
  )
  return data.data
}

export async function revokeInvite(id: string) {
  const { data } = await apiClient.delete<ApiResponse<Invite>>(`/invites/${id}`)
  return data.data
}

export async function validateInviteToken(token: string) {
  const { data } = await apiClient.get<ApiResponse<InviteValidation>>(`/invites/validate/${token}`)
  return data.data
}

export async function listTeamMembers(params?: { page?: number; limit?: number; search?: string }) {
  const { data } = await apiClient.get<ApiResponse<TeamMember[]>>('/users', { params })
  return { items: data.data, meta: data.meta }
}
