import { cn } from '@/lib/utils'

export function Card({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'rounded-xl glass p-5 transition-colors duration-200 hover:border-white/15',
        className
      )}
    >
      {children}
    </div>
  )
}
