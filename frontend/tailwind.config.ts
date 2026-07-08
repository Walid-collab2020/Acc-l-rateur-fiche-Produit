import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        accent: {
          DEFAULT: "#A100FF",
          dark: "#7700CC",
          light: "#E5B3FF",
          muted: "#F3E0FF",
        },
        surface: "#F2F2F2",
        border: "#E0E0E0",
        secondary: "#6A6A6A",
        kelia: {
          blue: "#1F4E79",
          lightblue: "#BDD7EE",
          green: "#C6EFCE",
          red: "#FFC7CE",
          yellow: "#FFEB9C",
        },
      },
      fontFamily: {
        sans: ["Graphik", "Inter", "Helvetica Neue", "Arial", "sans-serif"],
      },
    },
  },
  plugins: [],
};
export default config;
