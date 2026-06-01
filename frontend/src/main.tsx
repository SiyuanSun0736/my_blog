import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { UIProvider } from "./components/ui";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <UIProvider>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </UIProvider>,
);