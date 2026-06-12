import type { PaginatedResult } from '../types/pagination.types'

export function getPaginationParams(query: {
  page?: number
  limit?: number
}) {
  const page = query.page ?? 1
  const limit = query.limit ?? 20

  return {
    page,
    limit,
    skip: (page - 1) * limit,
  }
}

export function buildPaginatedResult<T>(params: {
  items: T[]
  total: number
  page: number
  limit: number
}): PaginatedResult<T> {
  const totalPages = Math.ceil(params.total / params.limit)

  return {
    items: params.items,
    total: params.total,
    page: params.page,
    limit: params.limit,
    totalPages,
    hasNextPage: params.page < totalPages,
    hasPrevPage: params.page > 1,
  }
}
