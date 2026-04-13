import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: {
          DEFAULT: "#F5ECD0",
          muted: "rgba(245, 236, 208, 0.62)",
          faint: "rgba(245, 236, 208, 0.38)",
        },
        bg: {
          base: "#0E0D08",
          surface: "#17150E",
          raised: "#1F1C12",
        },
        gold: {
          50:  "#FBF4DB",
          100: "#F2E5AE",
          200: "#E8D583",
          300: "#D8BB60",
          400: "#C9A34A",
          500: "#B28A36",
          600: "#8B6B28",
          700: "#5A4A28",
          800: "#3A2F18",
          900: "#2B2A18",
        },
        line: "rgba(201, 163, 74, 0.18)",
      },
      fontFamily: {
        sans: ["var(--font-inter)", "system-ui", "sans-serif"],
        display: ["var(--font-fraunces)", "serif"],
      },
      letterSpacing: {
        tightest: "-0.04em",
      },
    },
  },
  plugins: [],
};
export default config;
