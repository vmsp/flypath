import { href } from "flypath";

import { listPosts } from "./posts.ts";
import { colors } from "./vars.css.ts";

export default async function About() {
  const posts = await listPosts();

  return (
    <>
      <title>About</title>
      <main
        style={{
          display: "flex",
          flexDirection: "column",
          flexGrow: 1,
          gap: 12,
          overflow: "auto",
          padding: 24,
        }}
      >
        <h1 style={{ color: colors.text, fontSize: 24 }}>About</h1>
        <p style={{ color: colors.muted }}>
          A small feed built with flypath. This page reads nothing about you, so
          it is rendered once during the build and served as a file.
        </p>
        <p style={{ color: colors.muted }}>
          There were {posts.length} posts when this page was built.
        </p>
        <a href={href("/")} style={{ color: colors.primary }}>
          go to the feed
        </a>
      </main>
    </>
  );
}
