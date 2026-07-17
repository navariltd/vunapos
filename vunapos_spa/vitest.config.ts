import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		environment: "node",
		setupFiles: ["./src/lib/__tests__/setup.ts"],
		include: ["src/**/*.test.ts"],
	},
});
