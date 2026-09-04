import { navigate, params } from "flypath";

import BackLink from "./back-link.tsx";
import LikeButton from "./like-button.tsx";
import PostParams from "./post-params.tsx";
import { getPost } from "./posts.ts";
import { colors } from "./vars.css.ts";

export default async function PostPage() {
  const id = Number(params("id"));
  const post = await getPost(id);
  if (!post) navigate("not-found");

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
        <LikeButton id={post.id} likes={post.likes ?? 0} />
        <PostParams />
      </article>
    </>
  );
}
