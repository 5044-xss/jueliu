import { Navigate, Outlet, Route, Routes } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { AppShell } from "./AppShell";
import { ActivationPage } from "./pages/ActivationPage";
import { ProjectLayout } from "./pages/project/ProjectLayout";
import { capabilities } from "./platform/capabilities";
import { useLicense } from "./license/use-license";
import ProjectsPage from "./screens/ProjectsPage";
import SeriesPage from "./screens/SeriesPage";
import ProjectAssetsPage from "./screens/ProjectAssetsPage";
import StoryPage from "./screens/StoryPage";
import ScriptPage from "./screens/ScriptPage";
import AssetsPage from "./screens/AssetsPage";
import StoryboardPage from "./screens/StoryboardPage";
import ComposePage from "./screens/ComposePage";
import LibraryLayout from "./screens/LibraryLayout";
import LibraryAssetsPage from "./screens/LibraryAssetsPage";
import LibraryStylesPage from "./screens/LibraryStylesPage";
import LibrarySkillsPage from "./screens/LibrarySkillsPage";
import { SettingsPage } from "./pages/SettingsPage";

function LibraryShell() {
  return (
    <LibraryLayout>
      <Outlet />
    </LibraryLayout>
  );
}

function Splash() {
  return (
    <div className="flex h-dvh items-center justify-center gap-2 text-sm text-muted-foreground">
      <Loader2 className="size-4 animate-spin" />
      正在启动…
    </div>
  );
}

export default function App() {
  const license = useLicense();

  if (license.phase === "loading") return <Splash />;
  if (!license.allowed && !import.meta.env.DEV) return <ActivationPage />;

  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<Navigate to="/projects" replace />} />
        <Route path="projects" element={<ProjectsPage />} />
        <Route path="projects/:seriesId" element={<SeriesPage />} />
        <Route
          path="projects/:seriesId/assets"
          element={<ProjectAssetsPage />}
        />
        <Route path="projects/:seriesId/:episodeId" element={<ProjectLayout />}>
          <Route index element={<Navigate to="story" replace />} />
          <Route path="story" element={<StoryPage />} />
          <Route path="script" element={<ScriptPage />} />
          <Route path="assets" element={<AssetsPage />} />
          <Route path="storyboard" element={<StoryboardPage />} />
          {capabilities.compose && (
            <Route path="compose" element={<ComposePage />} />
          )}
        </Route>
        <Route path="library" element={<LibraryShell />}>
          <Route index element={<Navigate to="assets" replace />} />
          <Route path="assets" element={<LibraryAssetsPage />} />
          <Route path="styles" element={<LibraryStylesPage />} />
          <Route path="skills" element={<LibrarySkillsPage />} />
        </Route>
        <Route path="settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/projects" replace />} />
      </Route>
    </Routes>
  );
}
