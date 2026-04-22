import "@/App.css";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import { Toaster } from "@/components/ui/sonner";
import { CapabilitiesProvider } from "@/hooks/useCapabilities";
import { EnvProvider } from "@/components/layout/EnvSwitcher";
import AppShell from "@/components/layout/AppShell";
import AgentList from "@/pages/AgentList";
import AgentEditor from "@/pages/AgentEditor";
import CompareView from "@/pages/CompareView";
import VersionHistory from "@/pages/VersionHistory";
import ChatWizard from "@/pages/ChatWizard";
import EvalRuns from "@/pages/EvalRuns";
import JobDetail from "@/pages/JobDetail";
import DatasetsPage from "@/pages/DatasetsPage";
import SchedulesList from "@/pages/SchedulesList";
import ScheduleEditor from "@/pages/ScheduleEditor";
import ScheduleDetail from "@/pages/ScheduleDetail";

const router = createBrowserRouter([
  {
    element: <AppShell />,
    children: [
      { path: "/", element: <AgentList /> },
      { path: "/agents/new", element: <AgentEditor /> },
      { path: "/agents/:id/edit", element: <AgentEditor /> },
      { path: "/agents/:id/clone", element: <AgentEditor isClone /> },
      { path: "/compare", element: <CompareView /> },
      { path: "/agents/:id/history", element: <VersionHistory /> },
      { path: "/wizard", element: <ChatWizard /> },
      { path: "/evals", element: <EvalRuns /> },
      { path: "/evals/:id", element: <JobDetail /> },
      { path: "/datasets", element: <DatasetsPage /> },
      { path: "/schedules", element: <SchedulesList /> },
      { path: "/schedules/new", element: <ScheduleEditor /> },
      { path: "/schedules/:id", element: <ScheduleDetail /> },
      { path: "/schedules/:id/edit", element: <ScheduleEditor /> },
    ],
  },
]);

function App() {
  return (
    <EnvProvider>
    <CapabilitiesProvider>
      <RouterProvider router={router} />
      <Toaster richColors position="bottom-right" />
    </CapabilitiesProvider>
    </EnvProvider>
  );
}

export default App;
