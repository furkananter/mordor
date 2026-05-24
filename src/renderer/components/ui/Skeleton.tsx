import { CSSProperties } from "react";

export function Skeleton({
  width,
  height = 12,
  className = "",
  style
}: {
  width?: number | string;
  height?: number | string;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <span
      className={`skeleton inline-block ${className}`.trim()}
      style={{ width: width ?? "100%", height, ...style }}
      aria-hidden="true"
    />
  );
}

export function SkeletonTable({ rows = 12, columns = 5 }: { rows?: number; columns?: number }) {
  return (
    <div className="min-h-0 flex-1 overflow-hidden px-3 py-3">
      <div className="mb-2 flex items-center gap-3">
        {Array.from({ length: columns }, (_, index) => (
          <Skeleton key={index} height={14} width={120 + ((index * 23) % 80)} />
        ))}
      </div>
      <div className="grid gap-1.5">
        {Array.from({ length: rows }, (_, rowIndex) => (
          <div key={rowIndex} className="flex items-center gap-3 py-1">
            {Array.from({ length: columns }, (_, colIndex) => (
              <Skeleton
                key={colIndex}
                height={12}
                width={100 + ((rowIndex * 17 + colIndex * 41) % 90)}
                style={{ opacity: 1 - rowIndex * 0.04 }}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export function SkeletonList({ rows = 8 }: { rows?: number }) {
  return (
    <div className="grid gap-2 px-3 py-3">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="flex items-center gap-2">
          <Skeleton width={10} height={10} style={{ borderRadius: 999 }} />
          <Skeleton height={12} width={`${60 + ((index * 11) % 30)}%`} />
        </div>
      ))}
    </div>
  );
}
