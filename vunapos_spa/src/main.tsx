import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import "./styles/globals.css";
import { App } from "./app/App";
import { registerServiceWorker } from "./registerServiceWorker";
import { initPosNavigation } from "./lib/stores/navigationStore";
import { initSystemThemeListener } from "./lib/stores/themeStore";

createRoot(document.getElementById("root")!).render(
	<StrictMode>
		<App />
	</StrictMode>,
);

registerServiceWorker();
initPosNavigation();
initSystemThemeListener();
