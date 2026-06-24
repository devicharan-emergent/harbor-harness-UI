import "@/App.css";
import { createBrowserRouter, RouterProvider, Outlet } from "react-router-dom";
import { Toaster } from "@/components/ui/sonner";
import { CapabilitiesProvider } from "@/hooks/useCapabilities";
import { EnvProvider } from "@/components/layout/EnvSwitcher";
import { AuthProvider } from "@/contexts/AuthContext";
import ProtectedRoute from "@/components/auth/ProtectedRoute";
import AppShell from "@/components/layout/AppShell";
import AgentList from "@/pages/AgentList";
import AgentEditor from "@/pages/AgentEditor";
import CompareView from "@/pages/CompareView";
import VersionHistory from "@/pages/VersionHistory";
import ChatWizard from "@/pages/ChatWizard";
import EvalRuns from "@/pages/EvalRuns";
import JobDetail from "@/pages/JobDetail";
import DatasetsPage from "@/pages/DatasetsPage";
import JudgeConfigPage from "@/pages/JudgeConfigPage";
import SchedulesList from "@/pages/SchedulesList";
import ScheduleEditor from "@/pages/ScheduleEditor";
import ScheduleDetail from "@/pages/ScheduleDetail";
import CortexAgents from "@/pages/CortexAgents";
import Login from "@/pages/Login";
import AuthCallback from "@/pages/AuthCallback";

// AuthProvider must live inside the Router so child routes can read the URL,
// so we wrap via a layout route rather than around the RouterProvider.
function AuthBoundary() {
  return (
    <AuthProvider>
      <Outlet />
    </AuthProvider>
  );
}

const router = createBrowserRouter([
  {
    element: <AuthBoundary />,
    children: [
      // Public routes
      { path: "/login", element: <Login /> },
      { path: "/auth/callback", element: <AuthCallback /> },

      // Protected app shell
      {
        element: (
          <ProtectedRoute>
            <AppShell />
          </ProtectedRoute>
        ),
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
          { path: "/judge-config", element: <JudgeConfigPage /> },
          { path: "/schedules", element: <SchedulesList /> },
          { path: "/schedules/new", element: <ScheduleEditor /> },
          { path: "/schedules/:id", element: <ScheduleDetail /> },
          { path: "/schedules/:id/edit", element: <ScheduleEditor /> },
          { path: "/cortex/agents", element: <CortexAgents /> },
        ],
      },
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
