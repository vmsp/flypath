import { href } from "flypath";

import { listPosts } from "./posts.ts";
import { colors } from "./vars.css.ts";

export default async function Explore() {
  const posts = await listPosts();

  return (
    <>
      <title>Explore</title>
      <main
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 12,
          padding: 16,
        }}
      >
        <h1 style={{ color: colors.text, fontSize: 24 }}>Explore</h1>
        <div style={{ display: "flex", flexDirection: "row", gap: 8 }}>
          {posts.map((post) => (
            <a
              href={href("/p/:id", { id: post.id })}
              key={post.id}
              style={{
                backgroundColor: colors.border,
                borderRadius: 10,
                color: colors.text,
                flexGrow: 1,
                padding: 18,
                textAlign: "center",
                textDecorationLine: "none",
              }}
            >
              #{post.id}
            </a>
          ))}
        </div>
      </main>
    </>
  );
}
