import type { Line } from '../types/network'

export const LineBadge = ({ line }: { line: Line }) => {
    return (
        <span
            className="inline-block min-w-[40px] rounded px-1.5 py-0.5 text-center text-xs font-semibold"
            style={{ backgroundColor: line.color, color: line.textColor }}
        >
            {line.name}
        </span>
    )
}
