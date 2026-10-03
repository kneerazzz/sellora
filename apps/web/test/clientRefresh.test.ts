import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import axios, { AxiosError, AxiosHeaders, type InternalAxiosRequestConfig } from 'axios'
import { apiClient, getAccessToken, setAccessToken } from '../src/api/client'
import { refreshSession } from '../src/api/auth'

const session = { user: { id: 'offline-user' }, accessToken: 'offline-access-token' }
const response = (config: InternalAxiosRequestConfig, data: unknown, status = 200) => ({
  config, data, status, statusText: String(status), headers: new AxiosHeaders(),
})

describe('actual dashboard refresh paths with offline Axios adapters', { concurrency: false }, () => {
  it('shares bootstrap, repeated bootstrap and concurrent 401 retries in one rotation', async () => {
    const defaultAdapter = axios.defaults.adapter
    const apiAdapter = apiClient.defaults.adapter
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    let rotations = 0
    let initialRequests = 0
    let retriedRequests = 0
    axios.defaults.adapter = async config => {
      rotations++
      assert.equal(config.url, '/api/v1/auth/refresh')
      assert.equal(config.withCredentials, true)
      await gate
      return response(config, { data: session })
    }
    apiClient.defaults.adapter = async config => {
      if (config.headers.Authorization !== `Bearer ${session.accessToken}`) {
        initialRequests++
        throw new AxiosError('Expired access token', 'ERR_BAD_REQUEST', config, undefined, response(config, {}, 401))
      }
      retriedRequests++
      return response(config, { data: 'authorized' })
    }
    try {
      setAccessToken('expired-offline-token')
      const bootstrap = refreshSession()
      const repeatedBootstrap = refreshSession()
      const requests = [apiClient.get('/users/me'), apiClient.get('/documents')]
      for (let attempt = 0; attempt < 100 && initialRequests < 2; attempt++) {
        await new Promise<void>(resolve => setImmediate(resolve))
      }
      assert.equal(initialRequests, 2)
      assert.equal(rotations, 1)
      release()
      const results = await Promise.all([bootstrap, repeatedBootstrap, ...requests])
      assert.deepEqual(results[0], session)
      assert.deepEqual(results[1], session)
      assert.equal(retriedRequests, 2)
      assert.equal(getAccessToken(), session.accessToken)
    } finally {
      release()
      axios.defaults.adapter = defaultAdapter
      apiClient.defaults.adapter = apiAdapter
      setAccessToken(null)
    }
  })

  it('propagates refresh failure, clears the access token and permits a later retry', async () => {
    const defaultAdapter = axios.defaults.adapter
    const apiAdapter = apiClient.defaults.adapter
    let rotations = 0
    axios.defaults.adapter = async config => {
      rotations++
      if (rotations === 1) throw new AxiosError('Already rotated', 'ERR_BAD_REQUEST', config, undefined, response(config, {}, 401))
      return response(config, { data: session })
    }
    apiClient.defaults.adapter = async config => {
      throw new AxiosError('Expired access token', 'ERR_BAD_REQUEST', config, undefined, response(config, {}, 401))
    }
    try {
      setAccessToken('expired-offline-token')
      await assert.rejects(apiClient.get('/users/me'))
      assert.equal(getAccessToken(), null)
      assert.equal(rotations, 1)
      assert.deepEqual(await refreshSession(), session)
      assert.equal(rotations, 2)
    } finally {
      axios.defaults.adapter = defaultAdapter
      apiClient.defaults.adapter = apiAdapter
      setAccessToken(null)
    }
  })
})
