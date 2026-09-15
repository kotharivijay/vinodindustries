import { redirect } from 'next/navigation'

// Attendance module is DISABLED (Sep 2026, per Vijay). Every /attendance/*
// page bounces to the dashboard and the sidebar links are removed. Data
// (AttendanceUpload / AttendancePunchDay / AttendanceEmployee) and the API
// routes are untouched, so deleting this file re-enables the module as it was.
export default function AttendanceDisabledLayout() {
  redirect('/dashboard')
}
