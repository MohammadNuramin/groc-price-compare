import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        chaldal: "#7533CB",
        shwapno: "#E11D48",
        pandamart: "#D70F64",
      },
    },
  },
  plugins: [],
};

export default config;
