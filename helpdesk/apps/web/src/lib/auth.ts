import { queryOptions, useQuery } from '@tanstack/react-query'
import { isStaff } from '@helpdesk/shared'
import { api, ApiError } from './api'
import type { Me, Meta } from './types'

export const meQuery = queryOptions({
  queryKey: ['me'],
  queryFn: async (): Promise<Me | null> => {
    try {
      const res = await api<{ user: Me }>('/api/auth/me')
      return res.user
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return null
      throw err
    }
  },
  staleTime: 60_000,
})

export function useMe(): Me {
  const { data } = useQuery(meQuery)
  // Routes under the app layout only render after the guard has loaded the user.
  return data as Me
}

export function useIsStaff(): boolean {
  return isStaff(useMe()?.role)
}

export const metaQuery = queryOptions({
  queryKey: ['meta'],
  queryFn: () => api<Meta>('/api/meta'),
  staleTime: 5 * 60_000,
})

export function homePath(me: Me): string {
  return isStaff(me.role) ? '/queue' : '/tickets'
}
