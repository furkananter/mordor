import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

const root = document.getElementById("root");

if (root) {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>
  );
}

// Surface the perf-zone toggle in the console so users hitting lag in a
// packaged build can flip on the React profiler from devtools without having
// to dig the localStorage key out of source. The hint costs one console line
// at boot and pays for itself the first time the user files a perf bug.
if (typeof localStorage !== "undefined" && localStorage.getItem("mordor:perf") !== "1") {
  // eslint-disable-next-line no-console
  console.info(
    "%c[mordor] feeling laggy? run: localStorage.setItem('mordor:perf','1'); location.reload();",
    "color:#c8633a"
  );
}
