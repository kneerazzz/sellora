import crypto from 'node:crypto'

export function sha256Hex(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex')
}

export function randomHex(bytes: number): string {
  return crypto.randomBytes(bytes).toString('hex')
}

export function randomBase64Url(bytes: number): string {
  return crypto.randomBytes(bytes).toString('base64url')
}
