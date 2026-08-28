import { notFound, useParams } from "flypath";

import { getPost } from "./posts.ts";
import { colors } from "./vars.css.ts";

export default async function PostPage() {
  const { id } = useParams<"/p/:id">();
  const post = await getPost(id);
  if (!post) notFound();

  return (
    <article
      style={{
        backgroundColor: colors.surface,
        display: "flex",
        flexDirection: "column",
        flexGrow: 1,
        gap: 12,
        padding: 20,
      }}
    >
      <a href="/" style={{ color: colors.primary }}>
        ← back to feed
      </a>
      <h1 style={{ color: colors.text, fontSize: 22 }}>@{post.author}</h1>
      <p style={{ color: colors.text, fontSize: 18 }}>{post.body}</p>
      <span style={{ color: colors.muted }}>{post.likes} likes</span>
    </article>
  );
}
