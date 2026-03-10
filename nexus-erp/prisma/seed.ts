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
    { userIdx: 0, weekStart: '2026-03-02', status: 'draft'     as const, entries: [{ date: '2026-03-02', hours: 8, projectCode: 'ENG-101', description: 'Feature development' }, { date: '2026-03-03', hours: 7.5, projectCode: 'ENG-102', description: 'Code review' }, { date: '2026-03-04', hours: 8, projectCode: 'ENG-101', description: 'Bug fixes' }, { date: '2026-03-05', hours: 8.5, projectCode: 'ENG-103', description: 'Meetings & planning' }, { date: '2026-03-06', hours: 8, projectCode: 'ENG-101', description: 'Testing' }] },
    { userIdx: 0, weekStart: '2026-02-23', status: 'approved'  as const, entries: [{ date: '2026-02-23', hours: 8, projectCode: 'ENG-101', description: null }, { date: '2026-02-24', hours: 7, projectCode: 'ENG-102', description: 'Short day' }, { date: '2026-02-25', hours: 8, projectCode: 'ENG-101', description: null }, { date: '2026-02-26', hours: 7.5, projectCode: 'ENG-103', description: null }, { date: '2026-02-27', hours: 7.5, projectCode: 'ENG-101', description: null }] },
    { userIdx: 1, weekStart: '2026-03-02', status: 'submitted' as const, entries: [{ date: '2026-03-02', hours: 9, projectCode: 'DES-201', description: 'Sprint planning' }, { date: '2026-03-03', hours: 8, projectCode: 'DES-201', description: 'Design work' }, { date: '2026-03-04', hours: 9, projectCode: 'DES-202', description: 'Client revisions' }, { date: '2026-03-05', hours: 8, projectCode: 'DES-201', description: null }, { date: '2026-03-06', hours: 8, projectCode: 'DES-203', description: 'Final touches' }] },
    { userIdx: 1, weekStart: '2026-02-23', status: 'rejected'  as const, entries: [{ date: '2026-02-23', hours: 8, projectCode: 'DES-201', description: null }, { date: '2026-02-24', hours: 8, projectCode: 'DES-201', description: null }, { date: '2026-02-25', hours: 8, projectCode: 'DES-202', description: null }, { date: '2026-02-26', hours: 8, projectCode: 'DES-201', description: null }, { date: '2026-02-27', hours: 8, projectCode: 'DES-201', description: null }] },
    { userIdx: 2, weekStart: '2026-03-02', status: 'draft'     as const, entries: [{ date: '2026-03-02', hours: 7, projectCode: 'UI-301', description: 'Design sprint kickoff' }, { date: '2026-03-03', hours: 7, projectCode: 'UI-301', description: null }, { date: '2026-03-04', hours: 7, projectCode: 'UI-302', description: null }, { date: '2026-03-05', hours: 7, projectCode: 'UI-301', description: null }, { date: '2026-03-06', hours: 7, projectCode: 'UI-303', description: 'Weekly review' }] },
  ]

  for (const t of timesheetData) {
    const emp = createdEmployees[t.userIdx]!.employee!
    const ts = await db.timesheet.create({
      data: {
        employeeId:  emp.id,
        weekStart:   new Date(t.weekStart),
        status:      t.status,
        submittedAt: t.status !== 'draft' ? new Date() : null,
        decidedAt:   (t.status === 'approved' || t.status === 'rejected') ? new Date() : null,
      },
    })
    await db.timesheetEntry.createMany({
      data: t.entries.map((e) => ({
        timesheetId: ts.id,
        date: new Date(e.date),
        hours: e.hours,
        projectCode: e.projectCode,
        description: e.description,
      })),
    })
    console.log(`  timesheet: ${createdEmployees[t.userIdx]!.email} week ${t.weekStart} [${t.status}] (${t.entries.length} entries)`)
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
