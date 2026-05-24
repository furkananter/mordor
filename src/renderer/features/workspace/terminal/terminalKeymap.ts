import type { Terminal } from "@xterm/xterm";

export function attachMacKeymap(term: Terminal): void {
  term.attachCustomKeyEventHandler((event) => {
    if (event.type !== "keydown") return true;
    const meta = event.metaKey;
    const alt = event.altKey;
    const ctrl = event.ctrlKey;
    const key = event.key;

    if (meta && !alt && !ctrl) {
      if (key === "Backspace") { term.paste("\x15"); return false; }
      if (key === "Delete") { term.paste("\x0b"); return false; }
      if (key === "ArrowLeft") { term.paste("\x01"); return false; }
      if (key === "ArrowRight") { term.paste("\x05"); return false; }
      if (key === "k" || key === "K") { term.clear(); return false; }
      if (key === "c" || key === "C") {
        const sel = term.getSelection();
        if (sel) {
          void navigator.clipboard.writeText(sel);
          return false;
        }
        return true;
      }
      if (key === "v" || key === "V") {
        void navigator.clipboard.readText().then((text) => {
          if (text) term.paste(text);
        });
        return false;
      }
      if (key === "a" || key === "A") {
        term.selectAll();
        return false;
      }
    }

    if (alt && !meta && !ctrl) {
      if (key === "Backspace") { term.paste("\x17"); return false; }
      if (key === "Delete") { term.paste("\x1bd"); return false; }
      if (key === "ArrowLeft") { term.paste("\x1bb"); return false; }
      if (key === "ArrowRight") { term.paste("\x1bf"); return false; }
    }

    return true;
  });
}
