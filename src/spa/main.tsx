import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { HashRouter } from "react-router-dom";
import { Toaster } from "sonner";
import { ConfirmProvider } from "@/components/confirm-dialog";
import { GlobalJobsProvider } from "@/components/global-jobs-provider";
import App from "./App";
import { installLocalApi } from "./api";
import { installMediaBridge } from "./api/media";
import "./globals.css";
import "./spa.css";

window.__JUELIU_SPA__ = true;
installLocalApi();
installMediaBridge();

if (!__DESKTOP__ && import.meta.env.PROD) {
  void import("virtual:pwa-register").then(({ registerSW }) => {
    registerSW({ immediate: true });
  });
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <HashRouter>
      <ConfirmProvider>
        <GlobalJobsProvider>
          <App />
        </GlobalJobsProvider>
      </ConfirmProvider>
      <Toaster position="top-center" richColors closeButton />
    </HashRouter>
  </StrictMode>,
);
