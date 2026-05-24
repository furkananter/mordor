import { useCallback, useState } from "react";

type Axis = "x" | "y";

interface DragHandle {
  resizing: boolean;
  onMouseDown(event: React.MouseEvent): void;
}

export function useDragHandle(axis: Axis, onMove: (clientCoord: number) => void, options: { disabled?: boolean } = {}): DragHandle {
  const [resizing, setResizing] = useState(false);

  const onMouseDown = useCallback(
    (event: React.MouseEvent) => {
      event.preventDefault();
      if (options.disabled) return;
      setResizing(true);
      const move = (e: MouseEvent) => onMove(axis === "x" ? e.clientX : e.clientY);
      const up = () => {
        setResizing(false);
        window.removeEventListener("mousemove", move);
        window.removeEventListener("mouseup", up);
      };
      window.addEventListener("mousemove", move);
      window.addEventListener("mouseup", up);
    },
    [axis, onMove, options.disabled]
  );

  return { resizing, onMouseDown };
}
