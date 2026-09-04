import { href } from "flypath";

import { listPosts } from "./posts.ts";
import { requestId, visitor } from "./session.ts";
import { colors } from "./vars.css.ts";

export default async function Feed() {
  const posts = await listPosts();
  const user = visitor();

  return (
    <>
      <title>Home</title>
      <main
        style={{
          display: "flex",
          flexDirection: "column",
          flexGrow: 1,
          gap: 12,
          overflow: "auto",
          padding: 16,
        }}
      >
        <h1 style={{ color: colors.text, fontSize: 24 }}>Feed</h1>
        <span style={{ color: colors.muted, fontSize: 13 }}>
          {user ? `signed in as ${user.name}` : "signed out"} · {requestId()}
        </span>
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
              {post.likes ?? 0} likes
            </span>
          </a>
        ))}
      </main>
    </>
  );
}
