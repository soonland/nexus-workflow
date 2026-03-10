import { PrismaClient } from '@prisma/client'
import { hash } from 'bcryptjs'

const db = new PrismaClient()

async function main() {
  console.log('Seeding nexus_erp...')

  // ── Wipe all data (FK-safe order) ──────────────────────────────────────────
  await db.employeeProfileUpdateRequest.deleteMany()
  await db.timesheet.deleteMany()
  await db.employee.deleteMany()
  await db.user.deleteMany()
  await db.department.deleteMany()
  console.log('  cleared existing data')

  // ── Departments ────────────────────────────────────────────────────────────
  const deptEngineering = await db.department.create({ data: { name: 'Engineering' } })
  const deptDesign      = await db.department.create({ data: { name: 'Design' } })
  console.log('  departments: Engineering, Design')

  // ── Manager ────────────────────────────────────────────────────────────────
  const managerUser = await db.user.create({
    data: {
      email:        'manager@nexus.local',
      passwordHash: await hash('password123', 12),
      role:         'manager',
      employee: {
        create: {
          fullName:     'Alice Martin',
          departmentId: deptEngineering.id,
          hireDate:     new Date('2020-01-15'),
        },
      },
    },
    include: { employee: true },
  })
  console.log(`  manager: ${managerUser.email} (employeeId: ${managerUser.employee!.id})`)

  // ── Employees ──────────────────────────────────────────────────────────────
  const employeeDefs = [
    { email: 'bob@nexus.local',   fullName: 'Bob Smith',   departmentId: deptEngineering.id, hireDate: '2021-03-01' },
    { email: 'carol@nexus.local', fullName: 'Carol Jones', departmentId: deptEngineering.id, hireDate: '2022-06-15' },
    { email: 'dave@nexus.local',  fullName: 'Dave Lee',    departmentId: deptDesign.id,      hireDate: '2023-01-10' },
  ]

  const createdEmployees = []
  for (const e of employeeDefs) {
    const user = await db.user.create({
      data: {
        email:        e.email,
        passwordHash: await hash('password123', 12),
        role:         'employee',
        employee: {
          create: {
            fullName:     e.fullName,
            departmentId: e.departmentId,
            hireDate:     new Date(e.hireDate),
            managerId:    managerUser.employee!.id,
          },
        },
      },
      include: { employee: true },
    })
    console.log(`  employee: ${user.email} (employeeId: ${user.employee!.id})`)
    createdEmployees.push(user)
  }

  // ── Timesheets ─────────────────────────────────────────────────────────────
  const timesheetData = [
    { userIdx: 0, weekStart: '2026-03-02', totalHours: 40, notes: 'Normal week',      status: 'draft'     as const },
    { userIdx: 0, weekStart: '2026-02-23', totalHours: 38, notes: 'Short week',       status: 'approved'  as const },
    { userIdx: 1, weekStart: '2026-03-02', totalHours: 42, notes: 'Overtime project', status: 'submitted' as const },
    { userIdx: 1, weekStart: '2026-02-23', totalHours: 40, notes: null,               status: 'rejected'  as const },
    { userIdx: 2, weekStart: '2026-03-02', totalHours: 35, notes: 'Design sprint',    status: 'draft'     as const },
  ]

  for (const t of timesheetData) {
    const emp = createdEmployees[t.userIdx]!.employee!
    await db.timesheet.create({
      data: {
        employeeId:  emp.id,
        weekStart:   new Date(t.weekStart),
        totalHours:  t.totalHours,
        notes:       t.notes ?? undefined,
        status:      t.status,
        submittedAt: t.status !== 'draft' ? new Date() : null,
        decidedAt:   (t.status === 'approved' || t.status === 'rejected') ? new Date() : null,
      },
    })
    console.log(`  timesheet: ${createdEmployees[t.userIdx]!.email} week ${t.weekStart} [${t.status}]`)
  }

  console.log('\nDone! Credentials: password123 for all accounts.')
  console.log('  manager@nexus.local  — manager role')
  console.log('  bob@nexus.local      — employee (has draft + approved timesheet)')
  console.log('  carol@nexus.local    — employee (has submitted + rejected timesheet)')
  console.log('  dave@nexus.local     — employee (has draft timesheet)')
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => db.$disconnect())
