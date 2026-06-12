import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        ink: "#19362f",
        moss: "#356859",
        cream: "#f7f3ea",
        sand: "#e8deca",
        coral: "#e8755f",
      },
      boxShadow: {
        soft: "0 18px 50px rgba(25, 54, 47, 0.10)",
      },
    },
  },
  plugins: [],
};

export default config;

