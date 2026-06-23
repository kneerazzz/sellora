import { useCallback, useEffect, useRef, useState } from 'react'
import { Upload } from 'lucide-react'
import { listDocuments, uploadDocumentFile } from '@/api/documents'
import { getErrorMessage } from '@/api/client'
import type { Document } from '@/types/api'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import {
  documentStatusLabel,
  documentStatusStyles,
  mapDocumentStatus,
} from '@/lib/documentStatus'
import { formatBytes, formatDate } from '@/lib/utils'

export function DocumentsPage() {
  const [documents, setDocuments] = useState<Document[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const { items } = await listDocuments({ limit: 50 })
      setDocuments(items)
      setError('')
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  async function handleUpload(file: File) {
    setUploading(true)
    setError('')
    try {
      await uploadDocumentFile(file)
      await load()
    } catch (err) {
      setError(getErrorMessage(err, 'Upload failed'))
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-white">Documents</h1>
          <p className="mt-1 text-sm text-zinc-400">
            Upload PDF and DOCX files for RAG-powered answers.
          </p>
        </div>
        <div>
          <input
            ref={fileRef}
            type="file"
            accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) handleUpload(file)
              e.target.value = ''
            }}
          />
          <Button
            loading={uploading}
            onClick={() => fileRef.current?.click()}
            className="gap-2"
          >
            <Upload className="h-4 w-4" />
            Upload document
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      <Card className="overflow-hidden !p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-white/10 text-xs uppercase tracking-wide text-zinc-500">
                <th className="px-5 py-3 font-medium">Name</th>
                <th className="px-5 py-3 font-medium">Type</th>
                <th className="px-5 py-3 font-medium">Size</th>
                <th className="px-5 py-3 font-medium">Status</th>
                <th className="px-5 py-3 font-medium">Chunks</th>
                <th className="px-5 py-3 font-medium">Uploaded</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-5 py-10 text-center text-zinc-500">
                    Loading documents…
                  </td>
                </tr>
              ) : documents.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-5 py-10 text-center text-zinc-500">
                    No documents yet. Upload your first file to get started.
                  </td>
                </tr>
              ) : (
                documents.map((doc) => {
                  const uiStatus = mapDocumentStatus(doc.status)
                  return (
                    <tr
                      key={doc.id}
                      className="border-b border-white/5 transition-colors hover:bg-white/[0.02]"
                    >
                      <td className="px-5 py-4">
                        <p className="font-medium text-zinc-100">{doc.displayName}</p>
                        <p className="text-xs text-zinc-500">{doc.filename}</p>
                      </td>
                      <td className="px-5 py-4 text-zinc-400">{doc.fileType}</td>
                      <td className="px-5 py-4 text-zinc-400">{formatBytes(doc.sizeBytes)}</td>
                      <td className="px-5 py-4">
                        <Badge className={documentStatusStyles[uiStatus]}>
                          {documentStatusLabel[uiStatus]}
                        </Badge>
                      </td>
                      <td className="px-5 py-4 text-zinc-400">{doc.totalChunks ?? '—'}</td>
                      <td className="px-5 py-4 text-zinc-400">{formatDate(doc.createdAt)}</td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}
