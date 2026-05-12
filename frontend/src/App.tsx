import { Route, Routes } from "react-router-dom";
import { Shell } from "./components/Shell";
import { HomePage } from "./pages/HomePage";
import { ArchivePage } from "./pages/ArchivePage";
import { PostPage } from "./pages/PostPage";

export default function App() {
  return (
    <Routes>
      <Route element={<Shell />}>
        <Route index element={<HomePage />} />
        <Route path="/archive" element={<ArchivePage />} />
        <Route path="/posts/:slug" element={<PostPage />} />
      </Route>
    </Routes>
  );
}