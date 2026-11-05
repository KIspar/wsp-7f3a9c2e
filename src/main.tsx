import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";
import { Toaster } from "sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { StudioProvider } from "@/lib/studio";
import App from "./App";
import "./styles.css";
import "./studio-layout.css";

const client = new QueryClient({ defaultOptions: { queries: { refetchOnWindowFocus: true } } });
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode><QueryClientProvider client={client}><TooltipProvider delayDuration={450}><BrowserRouter><StudioProvider><App /></StudioProvider></BrowserRouter><Toaster position="top-center" richColors closeButton /></TooltipProvider></QueryClientProvider></React.StrictMode>,
);
