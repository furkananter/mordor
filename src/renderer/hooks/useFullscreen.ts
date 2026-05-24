import { useEffect, useState } from "react";

export function useFullscreen(): boolean {
  const [fullscreen, setFullscreen] = useState(false);
  useEffect(() => {
    const unsubscribe = window.cassandraDesk.onFullscreenChange?.(setFullscreen);
    return unsubscribe;
  }, []);
  return fullscreen;
}
