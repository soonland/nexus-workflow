'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function TaskDecisionForm({
  taskId,
  managerId,
}: {
  taskId: string
  managerId: string
}) {
  const router = useRouter()
  const [decision, setDecision] = useState<'approved' | 'rejected' | ''>('')
  const [rejectionReason, setRejectionReason] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!decision) return
    setLoading(true)
    setError('')
    const res = await fetch(`/api/tasks/${taskId}/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        managerId,
        decision,
        rejectionReason: decision === 'rejected' ? rejectionReason : undefined,
      }),
    })
    setLoading(false)
    if (!res.ok) {
      const data = await res.json()
      setError(data.error ?? 'Failed to submit decision')
    } else {
      router.push('/tasks')
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <h2 className="text-lg font-semibold">Your Decision</h2>
      {error && <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">{error}</div>}
      <div className="flex space-x-3">
        <button
          type="button"
          onClick={() => setDecision('approved')}
          className={`flex-1 py-2 px-4 rounded-md text-sm font-medium border ${
            decision === 'approved'
              ? 'bg-green-600 text-white border-green-600'
              : 'border-gray-300 text-gray-700 hover:bg-gray-50'
          }`}
        >
          Approve
        </button>
        <button
          type="button"
          onClick={() => setDecision('rejected')}
          className={`flex-1 py-2 px-4 rounded-md text-sm font-medium border ${
            decision === 'rejected'
              ? 'bg-red-600 text-white border-red-600'
              : 'border-gray-300 text-gray-700 hover:bg-gray-50'
          }`}
        >
          Reject
        </button>
      </div>
      {decision === 'rejected' && (
        <div>
          <label htmlFor="reason" className="block text-sm font-medium text-gray-700">
            Rejection Reason (optional)
          </label>
          <textarea
            id="reason"
            rows={3}
            value={rejectionReason}
            onChange={(e) => setRejectionReason(e.target.value)}
            className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
          />
        </div>
      )}
      <button
        type="submit"
        disabled={!decision || loading}
        className="w-full py-2 px-4 bg-indigo-600 text-white rounded-md text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
      >
        {loading ? 'Submitting...' : 'Submit Decision'}
      </button>
    </form>
  )
}
