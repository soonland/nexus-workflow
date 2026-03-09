'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function SubmitButton({ timesheetId }: { timesheetId: string }) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit() {
    setLoading(true)
    setError('')
    const res = await fetch(`/api/timesheets/${timesheetId}/submit`, { method: 'POST' })
    setLoading(false)
    if (!res.ok) {
      const data = await res.json()
      setError(data.error ?? 'Failed to submit')
    } else {
      router.refresh()
    }
  }

  return (
    <div>
      {error && <p className="text-red-600 text-sm mb-2">{error}</p>}
      <button
        onClick={handleSubmit}
        disabled={loading}
        className="w-full py-2 px-4 bg-indigo-600 text-white rounded-md text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
      >
        {loading ? 'Submitting...' : 'Submit for Approval'}
      </button>
    </div>
  )
}
