import { css } from "flypath";

export const colors = css.vars({
  primary: { default: "red", "@media (prefers-color-scheme: dark)": "pink" },
  secondary: "blue",
});

export const dark = css.override(colors, { primary: "hotpink" });

export const spin = css.keyframes({
  from: { transform: "rotate(0deg)" },
  to: { transform: "rotate(360deg)" },
});
