import Link from 'next/link'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export default async function PayrollOverviewPage() {
  const [staffCount, contractorCount, salaried, contractor, unassigned, totalSalary] = await Promise.all([
    prisma.staff.count({ where: { isActive: true } }),
    prisma.contractor.count({ where: { isActive: true } }),
    prisma.staff.count({ where: { isActive: true, paymentMode: 'SALARIED' } }),
    prisma.staff.count({ where: { isActive: true, paymentMode: 'CONTRACTOR_LINKED' } }),
    prisma.staff.count({ where: { isActive: true, staffContractors: { none: {} } } }),
    prisma.staff.aggregate({ where: { isActive: true }, _sum: { monthlyBaseSalary: true } }),
  ])
  const monthlyBudget = totalSalary._sum.monthlyBaseSalary || 0

  return (
    <div className="max-w-5xl mx-auto animate-fade-in">
      <h1 className="text-xl md:text-2xl font-bold mb-4">Payroll · Overview</h1>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <div className="stat-card"><p className="text-xs text-gray-500 mb-0.5">Active staff</p><p className="text-2xl font-bold">{staffCount}</p></div>
        <div className="stat-card"><p className="text-xs text-gray-500 mb-0.5">Contractors</p><p className="text-2xl font-bold">{contractorCount}</p></div>
        <div className="stat-card"><p className="text-xs text-gray-500 mb-0.5">Salaried staff</p><p className="text-2xl font-bold text-blue-600">{salaried}</p></div>
        <div className="stat-card"><p className="text-xs text-gray-500 mb-0.5">Contractor-linked</p><p className="text-2xl font-bold text-emerald-600">{contractor}</p></div>
      </div>

      <div className="card p-4 mb-4">
        <p className="text-xs text-gray-500 mb-1">Total monthly salary budget (active staff)</p>
        <p className="text-3xl font-bold">₹{monthlyBudget.toLocaleString('en-IN')}</p>
        {unassigned > 0 && (
          <p className="text-xs text-amber-600 mt-2">
            ⚠ {unassigned} active staff have no contractor assigned. Use the Staff Register to tag them.
          </p>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
        <Link href="/payroll/wages" className="card p-4 hover:shadow-lg transition-shadow border-2 border-indigo-200 dark:border-indigo-800">
          <h3 className="text-base font-semibold mb-1">Wages Calculator →</h3>
          <p className="text-xs text-gray-500">Monthly wage entry with Days-First / Salary-First, 0.5-day stepper, contractor grouping.</p>
        </Link>
        <Link href="/payroll/register" className="card p-4 hover:shadow-lg transition-shadow">
          <h3 className="text-base font-semibold mb-1">Salary Register →</h3>
          <p className="text-xs text-gray-500">Monthly register with auto STATUS (new / salary inc / deleted), Reg badge, and Salary + PF CSV export.</p>
        </Link>
        <Link href="/payroll/staff" className="card p-4 hover:shadow-lg transition-shadow">
          <h3 className="text-base font-semibold mb-1">Staff Register →</h3>
          <p className="text-xs text-gray-500">Add / edit staff, paste-import from Excel, tag contractor, set Tally ledger.</p>
        </Link>
        <Link href="/payroll/contractors" className="card p-4 hover:shadow-lg transition-shadow">
          <h3 className="text-base font-semibold mb-1">Contractors →</h3>
          <p className="text-xs text-gray-500">Manage the foremen under whom staff are grouped for monthly wage calc.</p>
        </Link>
      </div>

      <div className="mt-6 card p-4 border-l-4 border-amber-500 bg-amber-50/30 dark:bg-amber-900/10">
        <h3 className="text-sm font-semibold mb-1">Next up — Tally integration (Phase 3)</h3>
        <p className="text-xs text-gray-600 dark:text-gray-400">
          Sync staff advance closing balance from Tally, preview the wages journal (Dr Wages Expense / Cr Staff Ledger), and push to Tally as a single journal voucher per month.
        </p>
      </div>
    </div>
  )
}
