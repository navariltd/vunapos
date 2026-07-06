import type { IncomingMessage } from "node:http";

import commonSiteConfig from "../../../sites/common_site_config.json" with { type: "json" };

const { webserver_port: webserverPort } = commonSiteConfig;

export default {
	"^/(app|api|assets|files|private|login)": {
		target: `http://127.0.0.1:${webserverPort}`,
		ws: true,
		router: (req: IncomingMessage) => {
			const siteName = req.headers.host?.split(":")[0] || "localhost";
			return `http://${siteName}:${webserverPort}`;
		},
	},
};
