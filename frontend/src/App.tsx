import { Suspense, lazy } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { Shell } from "./components/Shell";

const HomePage = lazy(() => import("./pages/HomePage").then((module) => ({ default: module.HomePage })));
const ArchivePage = lazy(() =>
  import("./pages/ArchivePage").then((module) => ({ default: module.ArchivePage })),
);
const PostPage = lazy(() => import("./pages/PostPage").then((module) => ({ default: module.PostPage })));
const WritePage = lazy(() => import("./pages/WritePage").then((module) => ({ default: module.WritePage })));

export default function App() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[50vh] items-center justify-center text-sm text-[var(--muted)]">
          页面加载中...
        </div>
      }
    >
      <Routes>
        <Route element={<Shell />}>
          <Route index element={<HomePage />} />
          <Route path="/archive" element={<ArchivePage />} />
          <Route path="/posts/:slug" element={<PostPage />} />
          <Route path="/admin" element={<WritePage />} />
          <Route path="/write" element={<Navigate to="/admin" replace />} />
        </Route>
      </Routes>
    </Suspense>
  );
}