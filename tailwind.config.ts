import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#18212f",
        muted: "#667085",
        line: "#d9e1ea",
        paper: "#ffffff",
        wash: "#f4f7fb",
        blue: "#246bfe",
        good: "#08946f",
        warn: "#d99a00",
        bad: "#d04444"
      },
      boxShadow: {
        soft: "0 12px 32px rgba(24, 33, 47, 0.08)"
      }
    }
  },
  plugins: []
};

export default config;
