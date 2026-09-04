import { flypath } from "flypath/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    flypath({
      appName: "Flypath Example",
      build: 7,
      version: "2.1",
    }),
  ],
});
