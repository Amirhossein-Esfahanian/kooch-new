import localFont from "next/font/local";

export const iranYekan = localFont({
  src: [
    {
      path: "../public/fonts/IRANYekanXVF.woff2",
      weight: "100 1000",
      style: "normal",
    },
  ],
  variable: "--font-iran-yekan",
  display: "swap",
});
