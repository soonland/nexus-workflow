/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { PrismaClient } from '@prisma/client'
import { hash } from 'bcryptjs'

const db = new PrismaClient()

async function mkUser(
  email: string,
  fullName: string | null,
  role: 'employee' | 'manager',
  departmentId: string | null,
  hireDate: string,
  managerId: string | null,
) {
  const user = await db.user.create({
    data: {
      email,
      passwordHash: await hash('password123', 12),
      role,
      ...(fullName !== null && {
        employee: {
          create: {
            fullName,
            departmentId: departmentId ?? undefined,
            hireDate: new Date(hireDate),
            managerId: managerId ?? undefined,
          },
        },
      }),
    },
    include: { employee: true },
  })
  console.log(`  [${role}] ${email}${fullName ? ` — ${fullName}` : ''}`)
  return user
}

async function main() {
  console.log('Seeding nexus_erp...')

  // ── Wipe all data (FK-safe order) ──────────────────────────────────────────
  await db.employeeProfileUpdateRequest.deleteMany()
  await db.timesheetEntry.deleteMany()
  await db.timesheet.deleteMany()
  await db.organization.deleteMany()
  await db.groupMembership.deleteMany()
  await db.userPermission.deleteMany()
  await db.departmentPermission.deleteMany()
  await db.groupPermission.deleteMany()
  await db.employee.deleteMany()
  await db.user.deleteMany()
  await db.department.deleteMany()
  await db.group.deleteMany()
  await db.permission.deleteMany()
  console.log('  cleared existing data')

  // ── Permissions & Groups ───────────────────────────────────────────────────
  // CRUD permissions: all resource × action combos
  const resources = ['employees', 'timesheets', 'organizations', 'groups', 'departments']
  const crudActions = ['read', 'write', 'create', 'delete']
  const resourceLabels: Record<string, string> = { employees: 'Employees', timesheets: 'Timesheets', organizations: 'Organizations', groups: 'Groups', departments: 'Departments' }
  const actionLabels: Record<string, string> = { read: 'Read', write: 'Write', create: 'Create', delete: 'Delete' }

  for (const r of resources) {
    for (const a of crudActions) {
      await db.permission.create({ data: { key: `${r}:${a}`, label: `${resourceLabels[r]} — ${actionLabels[a]}`, type: 'crud' } })
    }
  }

  // Workflow permissions
  const workflowPerms = [
    { key: 'timesheets:hr-approve', label: 'Approve timesheets (HR)' },
    { key: 'employees:approve-profile-update', label: 'Review profile update requests' },
    { key: 'organizations:approve-status-change', label: 'Approve organization status changes' },
  ]
  for (const p of workflowPerms) {
    await db.permission.create({ data: { key: p.key, label: p.label, type: 'workflow' } })
  }
  console.log('  permissions: 20 CRUD + 3 workflow')

  const groupOrgApprovers = await db.group.create({
    data: {
      name: 'Org Status Approvers',
      description: 'Users who can approve organization status change requests',
      permissions: { create: { permissionKey: 'organizations:approve-status-change' } },
    },
  })
  console.log(`  group: ${groupOrgApprovers.name}`)

  // ── Departments ────────────────────────────────────────────────────────────
  const [
    deptEngineering,
    deptDesign,
    deptProduct,
    deptSales,
    deptMarketing,
    deptFinance,
    deptHR,
    deptOperations,
    deptCustomerSuccess,
  ] = await Promise.all([
    db.department.create({ data: { name: 'Engineering' } }),
    db.department.create({ data: { name: 'Design' } }),
    db.department.create({ data: { name: 'Product Management' } }),
    db.department.create({ data: { name: 'Sales' } }),
    db.department.create({ data: { name: 'Marketing' } }),
    db.department.create({ data: { name: 'Finance' } }),
    db.department.create({ data: { name: 'Human Resources' } }),
    db.department.create({ data: { name: 'Operations' } }),
    db.department.create({ data: { name: 'Customer Success' } }),
  ])
  console.log('  departments: Engineering, Design, Product, Sales, Marketing, Finance, HR, Operations, Customer Success')

  // ── Department-level permissions ────────────────────────────────────────────
  await db.departmentPermission.createMany({
    data: [
      { departmentId: deptHR.id, permissionKey: 'timesheets:hr-approve' },
      { departmentId: deptHR.id, permissionKey: 'employees:approve-profile-update' },
    ],
  })
  console.log('  HR dept permissions: timesheets:hr-approve, employees:approve-profile-update')

  // ── HR special user (no employee record) ──────────────────────────────────
  const _hrUser = await db.user.create({
    data: {
      email:        'hr@nexus.local',
      passwordHash: await hash('password123', 12),
      role:         'manager',
      permissions:  { create: { permissionKey: 'organizations:approve-status-change' } },
      groups:       { create: { groupId: groupOrgApprovers.id } },
    },
  })
  console.log(`  [manager/special] hr@nexus.local — no employee record (perm: organizations:approve-status-change)`)

  // ── Department Managers ────────────────────────────────────────────────────
  console.log('\n--- Managers ---')
  const mgrAlice   = await mkUser('manager@nexus.local',         'Alice Martin',     'manager', deptEngineering.id,    '2020-01-15', null)
  const mgrLaura   = await mkUser('laura.simmons@nexus.local',   'Laura Simmons',    'manager', deptDesign.id,         '2019-04-01', null)
  const mgrSam     = await mkUser('sam.hughes@nexus.local',      'Sam Hughes',       'manager', deptProduct.id,        '2018-09-10', null)
  const mgrXavier  = await mkUser('xavier.murphy@nexus.local',   'Xavier Murphy',    'manager', deptSales.id,          '2017-06-20', null)
  const mgrGeorgia = await mkUser('georgia.vance@nexus.local',   'Georgia Vance',    'manager', deptMarketing.id,      '2020-03-15', null)
  const mgrMark    = await mkUser('mark.brooks@nexus.local',     'Mark Brooks',      'manager', deptFinance.id,        '2016-11-01', null)
  const mgrNina    = await mkUser('nina.foster@nexus.local',     'Nina Foster',      'manager', deptHR.id,             '2019-07-22', null)
  const mgrAlex    = await mkUser('alex.garrett@nexus.local',    'Alex Garrett',     'manager', deptOperations.id,     '2018-02-14', null)
  const mgrJessica = await mkUser('jessica.hart@nexus.local',    'Jessica Hart',     'manager', deptCustomerSuccess.id,'2021-01-05', null)

  // ── Engineering Employees (10) ─────────────────────────────────────────────
  console.log('\n--- Engineering ---')
  const empBob    = await mkUser('bob@nexus.local',              'Bob Smith',        'employee', deptEngineering.id, '2021-03-01', mgrAlice.employee!.id)
  const empCarol  = await mkUser('carol@nexus.local',            'Carol Jones',      'employee', deptEngineering.id, '2022-06-15', mgrAlice.employee!.id)
  const empDave   = await mkUser('dave@nexus.local',             'Dave Lee',         'employee', deptEngineering.id, '2023-01-10', mgrAlice.employee!.id)
  await mkUser('emma.chen@nexus.local',              'Emma Chen',        'employee', deptEngineering.id, '2022-03-07', mgrAlice.employee!.id)
  await mkUser('frank.rivera@nexus.local',           'Frank Rivera',     'employee', deptEngineering.id, '2023-05-20', mgrAlice.employee!.id)
  await mkUser('grace.kim@nexus.local',              'Grace Kim',        'employee', deptEngineering.id, '2021-09-13', mgrAlice.employee!.id)
  await mkUser('henry.torres@nexus.local',           'Henry Torres',     'employee', deptEngineering.id, '2024-01-08', mgrAlice.employee!.id)
  await mkUser('isabella.wong@nexus.local',          'Isabella Wong',    'employee', deptEngineering.id, '2022-11-02', mgrAlice.employee!.id)
  await mkUser('james.patel@nexus.local',            'James Patel',      'employee', deptEngineering.id, '2023-08-25', mgrAlice.employee!.id)
  await mkUser('kevin.okafor@nexus.local',           'Kevin Okafor',     'employee', deptEngineering.id, '2024-04-14', mgrAlice.employee!.id)

  // ── Design Employees (5) ──────────────────────────────────────────────────
  console.log('\n--- Design ---')
  await mkUser('maya.anderson@nexus.local',          'Maya Anderson',    'employee', deptDesign.id, '2022-02-14', mgrLaura.employee!.id)
  await mkUser('noah.bennett@nexus.local',           'Noah Bennett',     'employee', deptDesign.id, '2023-03-22', mgrLaura.employee!.id)
  await mkUser('olivia.cruz@nexus.local',            'Olivia Cruz',      'employee', deptDesign.id, '2021-10-05', mgrLaura.employee!.id)
  await mkUser('patrick.dunn@nexus.local',           'Patrick Dunn',     'employee', deptDesign.id, '2024-02-19', mgrLaura.employee!.id)
  await mkUser('quinn.fisher@nexus.local',           'Quinn Fisher',     'employee', deptDesign.id, '2022-07-30', mgrLaura.employee!.id)

  // ── Product Employees (4) ─────────────────────────────────────────────────
  console.log('\n--- Product Management ---')
  await mkUser('tara.ingram@nexus.local',            'Tara Ingram',      'employee', deptProduct.id, '2022-04-11', mgrSam.employee!.id)
  await mkUser('uma.johnson@nexus.local',            'Uma Johnson',      'employee', deptProduct.id, '2023-06-03', mgrSam.employee!.id)
  await mkUser('victor.kaur@nexus.local',            'Victor Kaur',      'employee', deptProduct.id, '2021-12-17', mgrSam.employee!.id)
  await mkUser('wendy.liu@nexus.local',              'Wendy Liu',        'employee', deptProduct.id, '2024-01-28', mgrSam.employee!.id)

  // ── Sales Employees (7) ───────────────────────────────────────────────────
  console.log('\n--- Sales ---')
  await mkUser('yara.noel@nexus.local',              'Yara Noel',        'employee', deptSales.id, '2022-01-17', mgrXavier.employee!.id)
  await mkUser('zoe.ortiz@nexus.local',              'Zoe Ortiz',        'employee', deptSales.id, '2023-04-09', mgrXavier.employee!.id)
  await mkUser('aaron.parker@nexus.local',           'Aaron Parker',     'employee', deptSales.id, '2021-08-23', mgrXavier.employee!.id)
  await mkUser('beth.quinn@nexus.local',             'Beth Quinn',       'employee', deptSales.id, '2022-10-11', mgrXavier.employee!.id)
  await mkUser('chris.ross@nexus.local',             'Chris Ross',       'employee', deptSales.id, '2023-02-06', mgrXavier.employee!.id)
  await mkUser('diana.scott@nexus.local',            'Diana Scott',      'employee', deptSales.id, '2024-03-18', mgrXavier.employee!.id)
  await mkUser('eric.turner@nexus.local',            'Eric Turner',      'employee', deptSales.id, '2021-06-30', mgrXavier.employee!.id)

  // ── Marketing Employees (4) ───────────────────────────────────────────────
  console.log('\n--- Marketing ---')
  await mkUser('hannah.walsh@nexus.local',           'Hannah Walsh',     'employee', deptMarketing.id, '2022-05-16', mgrGeorgia.employee!.id)
  await mkUser('ian.xavier@nexus.local',             'Ian Xavier',       'employee', deptMarketing.id, '2023-07-24', mgrGeorgia.employee!.id)
  await mkUser('julia.yang@nexus.local',             'Julia Yang',       'employee', deptMarketing.id, '2021-11-08', mgrGeorgia.employee!.id)
  await mkUser('karl.zimmerman@nexus.local',         'Karl Zimmerman',   'employee', deptMarketing.id, '2024-05-02', mgrGeorgia.employee!.id)

  // ── Finance Employees (3) ─────────────────────────────────────────────────
  console.log('\n--- Finance ---')
  await mkUser('lisa.abbott@nexus.local',            'Lisa Abbott',      'employee', deptFinance.id, '2022-08-29', mgrMark.employee!.id)
  await mkUser('michael.barton@nexus.local',         'Michael Barton',   'employee', deptFinance.id, '2021-05-13', mgrMark.employee!.id)
  await mkUser('nadia.cole@nexus.local',             'Nadia Cole',       'employee', deptFinance.id, '2023-09-04', mgrMark.employee!.id)

  // ── HR Employees (3) ──────────────────────────────────────────────────────
  console.log('\n--- Human Resources ---')
  await mkUser('oscar.davis@nexus.local',            'Oscar Davis',      'employee', deptHR.id, '2022-12-01', mgrNina.employee!.id)
  await mkUser('pamela.evans@nexus.local',           'Pamela Evans',     'employee', deptHR.id, '2023-10-15', mgrNina.employee!.id)
  await mkUser('rick.ford@nexus.local',              'Rick Ford',        'employee', deptHR.id, '2021-04-26', mgrNina.employee!.id)

  // ── Operations Employees (4) ──────────────────────────────────────────────
  console.log('\n--- Operations ---')
  await mkUser('sophie.grant@nexus.local',           'Sophie Grant',     'employee', deptOperations.id, '2022-06-08', mgrAlex.employee!.id)
  await mkUser('tom.hill@nexus.local',               'Tom Hill',         'employee', deptOperations.id, '2023-11-21', mgrAlex.employee!.id)
  await mkUser('ursula.ibarra@nexus.local',          'Ursula Ibarra',    'employee', deptOperations.id, '2021-07-14', mgrAlex.employee!.id)
  await mkUser('wade.jackson@nexus.local',           'Wade Jackson',     'employee', deptOperations.id, '2024-06-03', mgrAlex.employee!.id)

  // ── Customer Success Employees (4) ────────────────────────────────────────
  console.log('\n--- Customer Success ---')
  await mkUser('xena.kelly@nexus.local',             'Xena Kelly',       'employee', deptCustomerSuccess.id, '2022-09-19', mgrJessica.employee!.id)
  await mkUser('yusuf.lane@nexus.local',             'Yusuf Lane',       'employee', deptCustomerSuccess.id, '2023-01-30', mgrJessica.employee!.id)
  await mkUser('zara.morgan@nexus.local',            'Zara Morgan',      'employee', deptCustomerSuccess.id, '2021-03-22', mgrJessica.employee!.id)
  await mkUser('adam.nguyen@nexus.local',            'Adam Nguyen',      'employee', deptCustomerSuccess.id, '2024-07-07', mgrJessica.employee!.id)

  // ── Timesheets ─────────────────────────────────────────────────────────────
  console.log('\n--- Timesheets ---')
  const timesheetDefs: Array<{
    emp: { id: string }
    email: string
    weekStart: string
    status: 'draft' | 'submitted' | 'approved' | 'rejected'
    entries: Array<{ date: string; hours: number; projectCode: string; description: string | null }>
  }> = [
    {
      emp: empBob.employee!, email: empBob.email,
      weekStart: '2026-03-02', status: 'draft',
      entries: [
        { date: '2026-03-02', hours: 8,   projectCode: 'ENG-101', description: 'Feature development' },
        { date: '2026-03-03', hours: 7.5, projectCode: 'ENG-102', description: 'Code review' },
        { date: '2026-03-04', hours: 8,   projectCode: 'ENG-101', description: 'Bug fixes' },
        { date: '2026-03-05', hours: 8.5, projectCode: 'ENG-103', description: 'Meetings & planning' },
        { date: '2026-03-06', hours: 8,   projectCode: 'ENG-101', description: 'Testing' },
      ],
    },
    {
      emp: empBob.employee!, email: empBob.email,
      weekStart: '2026-02-23', status: 'approved',
      entries: [
        { date: '2026-02-23', hours: 8,   projectCode: 'ENG-101', description: null },
        { date: '2026-02-24', hours: 7,   projectCode: 'ENG-102', description: 'Short day' },
        { date: '2026-02-25', hours: 8,   projectCode: 'ENG-101', description: null },
        { date: '2026-02-26', hours: 7.5, projectCode: 'ENG-103', description: null },
        { date: '2026-02-27', hours: 7.5, projectCode: 'ENG-101', description: null },
      ],
    },
    {
      emp: empCarol.employee!, email: empCarol.email,
      weekStart: '2026-03-02', status: 'submitted',
      entries: [
        { date: '2026-03-02', hours: 9,   projectCode: 'ENG-201', description: 'Sprint planning' },
        { date: '2026-03-03', hours: 8,   projectCode: 'ENG-201', description: 'Feature work' },
        { date: '2026-03-04', hours: 9,   projectCode: 'ENG-202', description: 'Client revisions' },
        { date: '2026-03-05', hours: 8,   projectCode: 'ENG-201', description: null },
        { date: '2026-03-06', hours: 8,   projectCode: 'ENG-203', description: 'Final touches' },
      ],
    },
    {
      emp: empCarol.employee!, email: empCarol.email,
      weekStart: '2026-02-23', status: 'rejected',
      entries: [
        { date: '2026-02-23', hours: 8, projectCode: 'ENG-201', description: null },
        { date: '2026-02-24', hours: 8, projectCode: 'ENG-201', description: null },
        { date: '2026-02-25', hours: 8, projectCode: 'ENG-202', description: null },
        { date: '2026-02-26', hours: 8, projectCode: 'ENG-201', description: null },
        { date: '2026-02-27', hours: 8, projectCode: 'ENG-201', description: null },
      ],
    },
    {
      emp: empDave.employee!, email: empDave.email,
      weekStart: '2026-03-02', status: 'draft',
      entries: [
        { date: '2026-03-02', hours: 7, projectCode: 'ENG-301', description: 'Architecture review' },
        { date: '2026-03-03', hours: 7, projectCode: 'ENG-301', description: null },
        { date: '2026-03-04', hours: 7, projectCode: 'ENG-302', description: null },
        { date: '2026-03-05', hours: 7, projectCode: 'ENG-301', description: null },
        { date: '2026-03-06', hours: 7, projectCode: 'ENG-303', description: 'Weekly review' },
      ],
    },
  ]

  for (const t of timesheetDefs) {
    const ts = await db.timesheet.create({
      data: {
        employeeId:  t.emp.id,
        weekStart:   new Date(t.weekStart),
        status:      t.status,
        submittedAt: t.status !== 'draft' ? new Date() : null,
        decidedAt:   (t.status === 'approved' || t.status === 'rejected') ? new Date() : null,
      },
    })
    await db.timesheetEntry.createMany({
      data: t.entries.map((e) => ({
        timesheetId: ts.id,
        date:        new Date(e.date),
        hours:       e.hours,
        projectCode: e.projectCode,
        description: e.description,
      })),
    })
    console.log(`  timesheet: ${t.email} week ${t.weekStart} [${t.status}]`)
  }

  // ── Organizations ──────────────────────────────────────────────────────────
  console.log('\n--- Organizations ---')
  const orgDefs = [
    { name: 'Nexus Corp',        legalName: 'Nexus Corporation Ltd.',  industry: 'Technology',    status: 'active'   as const, ownerId: mgrAlice.employee!.id },
    { name: 'Acme Supplies',     legalName: 'Acme Supplies Inc.',      industry: 'Manufacturing', status: 'active'   as const, ownerId: empBob.employee!.id },
    { name: 'Blue Sky Partners', legalName: null,                       industry: 'Consulting',    status: 'inactive' as const, ownerId: empCarol.employee!.id },
    { name: 'Stellar Designs',   legalName: 'Stellar Designs LLC',     industry: 'Design',        status: 'archived' as const, ownerId: empDave.employee!.id },
  ]
  for (const o of orgDefs) {
    await db.organization.create({ data: o })
    console.log(`  organization: ${o.name} [${o.status}]`)
  }

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('Done! All accounts use password: password123')
  console.log('')
  console.log('Special accounts:')
  console.log('  hr@nexus.local            — manager (perm: organizations:approve-status-change, no employee record)')
  console.log('')
  console.log('Department managers:')
  console.log('  manager@nexus.local       — Engineering (Alice Martin)')
  console.log('  laura.simmons@nexus.local — Design')
  console.log('  sam.hughes@nexus.local    — Product Management')
  console.log('  xavier.murphy@nexus.local — Sales')
  console.log('  georgia.vance@nexus.local — Marketing')
  console.log('  mark.brooks@nexus.local   — Finance')
  console.log('  nina.foster@nexus.local   — Human Resources')
  console.log('  alex.garrett@nexus.local  — Operations')
  console.log('  jessica.hart@nexus.local  — Customer Success')
  console.log('')
  console.log('Employees: bob, carol, dave + 41 more across all departments')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => db.$disconnect())
