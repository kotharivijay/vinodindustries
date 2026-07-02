// Payroll/wages keeps native number-input steppers — day/attendance counts
// are nudged ±1 here, unlike the typed qty/rate fields elsewhere.
// The .keep-spinners exception lives in app/globals.css.
export default function PayrollLayout({ children }: { children: React.ReactNode }) {
  return <div className="keep-spinners">{children}</div>
}
