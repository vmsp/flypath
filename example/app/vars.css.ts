import { css } from "flypath";

export const colors = css.vars({
  primary: { default: "red", "@media (prefers-color-scheme: dark)": "pink" },
  secondary: "blue",
  surface: {
    default: "white",
    "@media (prefers-color-scheme: dark)": "#111318",
  },
  text: {
    default: "#111318",
    "@media (prefers-color-scheme: dark)": "#f2f3f5",
  },
  muted: {
    default: "#5b6472",
    "@media (prefers-color-scheme: dark)": "#9aa4b2",
  },
  border: {
    default: "#e3e6ea",
    "@media (prefers-color-scheme: dark)": "#2a2f38",
  },
});

export const dark = css.override(colors, { primary: "hotpink" });

export const spin = css.keyframes({
  from: { transform: "rotate(0deg)" },
  to: { transform: "rotate(360deg)" },
});
