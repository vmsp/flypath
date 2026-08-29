import { notFound, useParams } from "flypath";

import BackLink from "./back-link.tsx";
import { getPost } from "./posts.ts";
import { colors } from "./vars.css.ts";

export default async function PostPage() {
  const { id } = useParams<"/p/:id">();
  const post = await getPost(id);
  if (!post) notFound();

  return (
    <>
      <title>{`@${post.author}`}</title>
      <article
        style={{
          backgroundColor: colors.surface,
          display: "flex",
          flexDirection: "column",
          flexGrow: 1,
          gap: 12,
          overflow: "auto",
          padding: 20,
        }}
      >
        <BackLink>← back</BackLink>
        <h1 style={{ color: colors.text, fontSize: 22 }}>@{post.author}</h1>
        <p style={{ color: colors.text, fontSize: 18 }}>{post.body}</p>
        <span style={{ color: colors.muted }}>{post.likes} likes</span>
      </article>
    </>
  );
}
