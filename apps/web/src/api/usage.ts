import { apiClient } from './client'
import type { ApiResponse } from '@/types/api'

export interface UsageSummary {
  paused: boolean
  periodStart: string
  asOf: string
  maxUnits: number
  usedUnits: number
  remainingUnits: number
  maxConcurrent: number
  activeReservations: number
  unknownReservations: number
  unknownAttempts: number
  failedTraces: Array<{ id: string; operation: string; status: string; createdAt: string; errorCategory: string | null }>
  costlyTraces: Array<{ id: string; operation: string; status: string; createdAt: string; reservedUnits: number | null }>
  alerts: Array<{ id: string; kind: string; createdAt: string }>
  measurementNotice: string
}

export async function getUsageSummary() {
  const { data } = await apiClient.get<ApiResponse<UsageSummary>>('/usage/summary')
  return data.data
}

export async function setUsagePause(paused: boolean) {
  const { data } = await apiClient.put<ApiResponse<{ paused: boolean }>>('/usage/pause', { paused })
  return data.data
}
