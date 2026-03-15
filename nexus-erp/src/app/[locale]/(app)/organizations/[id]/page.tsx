import { redirect, notFound } from 'next/navigation'
import Box from '@mui/material/Box'
import { auth } from '@/auth'
import { db } from '@/db/client'
import OrganizationForm from '@/components/OrganizationForm'
import AuditLogPanel from '@/components/AuditLogPanel'

const OrganizationDetailPage = async ({ params }: { params: Promise<{ id: string }> }) => {
  const session = await auth()
  if (!session) redirect('/dashboard')

  const { id } = await params

  const isManager = session.user.role === 'manager'

  const [org, allEmployees] = await Promise.all([
    db.organization.findUnique({
      where: { id },
      include: { owner: { select: { id: true, fullName: true, userId: true } } },
    }),
    isManager
      ? db.employee.findMany({
          select: { id: true, fullName: true },
          orderBy: { fullName: 'asc' },
        })
      : Promise.resolve([] as { id: string; fullName: true extends true ? string : never }[]),
  ])

  if (!org || org.status === 'archived') notFound()

  const isOwner = session.user.employeeId === org.ownerId

  // Non-managers get an empty list (field is read-only), but still need the
  // current owner in the list so the Autocomplete can display it.
  const employeesForForm = isManager
    ? allEmployees
    : org.owner
      ? [{ id: org.owner.id, fullName: org.owner.fullName }]
      : []

  return (
    <Box>
      <OrganizationForm
        mode="edit"
        orgId={id}
        defaultValues={{
          name: org.name,
          legalName: org.legalName,
          industry: org.industry,
          taxId: org.taxId,
          registrationNo: org.registrationNo,
          status: org.status,
          email: org.email,
          phone: org.phone,
          website: org.website,
          street: org.street,
          city: org.city,
          state: org.state,
          postalCode: org.postalCode,
          country: org.country,
          ownerId: org.ownerId,
        }}
        allEmployees={JSON.parse(JSON.stringify(employeesForForm))}
        isManager={isManager}
        isOwner={isOwner}
        workflowInstanceId={org.workflowInstanceId}
      />
      {isManager && <AuditLogPanel entityType="Organization" entityId={id} />}
    </Box>
  )
}
export default OrganizationDetailPage
