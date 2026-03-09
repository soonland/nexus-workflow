'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function NewTimesheetPage() {
  const router = useRouter()
  const [form, setForm] = useState({ weekStart: '', totalHours: '', notes: '' })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  function update(field: string) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm((f) => ({ ...f, [field]: e.target.value }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    const res = await fetch('/api/timesheets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        weekStart: form.weekStart,
        totalHours: parseFloat(form.totalHours),
        notes: form.notes || undefined,
      }),
    })
    setLoading(false)
    if (!res.ok) {
      const data = await res.json()
      setError(data.error ?? 'Failed to create timesheet')
    } else {
      const { timesheet } = await res.json()
      router.push(`/timesheets/${timesheet.id}`)
    }
  }

  return (
    <div className="max-w-lg">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">New Timesheet</h1>
      <div className="bg-white rounded-lg shadow p-6">
        <form className="space-y-4" onSubmit={handleSubmit}>
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">{error}</div>
          )}
          <div>
            <label htmlFor="weekStart" className="block text-sm font-medium text-gray-700">
              Week Start Date
            </label>
            <input
              id="weekStart"
              type="date"
              required
              value={form.weekStart}
              onChange={update('weekStart')}
              className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
            />
          </div>
          <div>
            <label htmlFor="totalHours" className="block text-sm font-medium text-gray-700">
              Total Hours
            </label>
            <input
              id="totalHours"
              type="number"
              min="0"
              max="168"
              step="0.5"
              required
              value={form.totalHours}
              onChange={update('totalHours')}
              className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
            />
          </div>
          <div>
            <label htmlFor="notes" className="block text-sm font-medium text-gray-700">
              Notes (optional)
            </label>
            <textarea
              id="notes"
              rows={3}
              value={form.notes}
              onChange={update('notes')}
              className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
            />
          </div>
          <div className="flex space-x-3">
            <button
              type="submit"
              disabled={loading}
              className="flex-1 py-2 px-4 bg-indigo-600 text-white rounded-md text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
            >
              {loading ? 'Creating...' : 'Create Timesheet'}
            </button>
            <button
              type="button"
              onClick={() => router.back()}
              className="py-2 px-4 border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
