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
          flexGrow: 1,
          gap: 12,
          overflow: "auto",
          padding: 16,
        }}
      >
        <h1 style={{ color: colors.text, fontSize: 24 }}>Explore</h1>
        <a
          href={href("/camera")}
          style={{
            backgroundColor: colors.primary,
            borderRadius: 10,
            color: "#fff",
            padding: 14,
            textAlign: "center",
            textDecorationLine: "none",
          }}
        >
          open the camera
        </a>
        <div
          style={{
            display: "flex",
            flexDirection: "row",
            gap: 8,
            overflowX: "auto",
            overflowY: "hidden",
          }}
        >
          {posts.map((post) => (
            <a
              href={href("/p/:id", { id: post.id })}
              key={post.id}
              style={{
                backgroundColor: colors.border,
                borderRadius: 10,
                color: colors.text,
                padding: 18,
                textAlign: "center",
                textDecorationLine: "none",
                width: 120,
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
