import PerformanceView from './PerformanceView'

export default async function PerformancePage({ params }: { params: Promise<{ name: string }> }) {
  const { name } = await params
  return <PerformanceView name={decodeURIComponent(name)} />
}
