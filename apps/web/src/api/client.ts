import axios, { type AxiosError, type InternalAxiosRequestConfig } from 'axios'
import type { ApiErrorBody, ApiResponse, AuthUser } from '@/types/api'

const API_URL = import.meta.env?.VITE_API_URL ?? '/api/v1'

let accessToken: string | null = null
interface RefreshedSession { user: AuthUser; accessToken: string }
let refreshPromise: Promise<RefreshedSession> | null = null

export function setAccessToken(token: string | null) {
  accessToken = token
}

export function getAccessToken() {
  return accessToken
}

export const apiClient = axios.create({
  baseURL: API_URL,
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
  },
})

apiClient.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  if (accessToken) {
    config.headers.Authorization = `Bearer ${accessToken}`
  }
  return config
})

/** Bootstrap and 401 retries share one rotation per browser context. */
export function refreshAccessSession(): Promise<RefreshedSession> {
  if (!refreshPromise) {
    refreshPromise = axios.post<ApiResponse<RefreshedSession>>(
      `${API_URL}/auth/refresh`, {}, { withCredentials: true }
    ).then(({ data }) => {
      setAccessToken(data.data.accessToken)
      return data.data
    }).finally(() => {
      refreshPromise = null
    })
  }
  return refreshPromise
}

apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError<ApiErrorBody>) => {
    const originalRequest = error.config as InternalAxiosRequestConfig & { _retry?: boolean }

    if (
      error.response?.status !== 401 ||
      !originalRequest ||
      originalRequest._retry ||
      originalRequest.url?.includes('/auth/refresh') ||
      originalRequest.url?.includes('/auth/login') ||
      originalRequest.url?.includes('/auth/register') ||
      originalRequest.url?.includes('/auth/accept-invite')
    ) {
      return Promise.reject(error)
    }

    originalRequest._retry = true

    try {
      const { accessToken: newToken } = await refreshAccessSession()
      if (!newToken) {
        setAccessToken(null)
        return Promise.reject(error)
      }

      originalRequest.headers.Authorization = `Bearer ${newToken}`
      return apiClient(originalRequest)
    } catch (refreshError) {
      setAccessToken(null)
      return Promise.reject(refreshError)
    }
  }
)

export function getErrorMessage(error: unknown, fallback = 'Something went wrong'): string {
  if (axios.isAxiosError<ApiErrorBody>(error)) {
    return error.response?.data?.message ?? error.message ?? fallback
  }
  if (error instanceof Error) return error.message
  return fallback
}
