import { href } from "flypath";

import { listPosts } from "./posts.ts";
import { colors } from "./vars.css.ts";

export default async function Feed() {
  const posts = await listPosts();

  return (
    <main
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 12,
        padding: 16,
      }}
    >
      <h1 style={{ color: colors.text, fontSize: 24 }}>Feed</h1>
      {posts.map((post) => (
        <a
          href={href("/p/:id", { id: post.id })}
          key={post.id}
          style={{
            borderColor: colors.border,
            borderRadius: 12,
            borderStyle: "solid",
            borderWidth: 1,
            color: colors.text,
            display: "flex",
            flexDirection: "column",
            gap: 6,
            padding: 14,
            textDecorationLine: "none",
          }}
        >
          <span style={{ color: colors.primary, fontWeight: "600" }}>
            @{post.author}
          </span>
          <span style={{ color: colors.text }}>{post.body}</span>
          <span style={{ color: colors.muted, fontSize: 13 }}>
            {post.likes} likes
          </span>
        </a>
      ))}
    </main>
  );
}
