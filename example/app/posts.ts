import { db, transaction } from "flypath";
import { count } from "flypath/sql";

export type Post = {
  id: number;
  author: string;
  body: string;
  likes: number | null;
};

const likeCounts = () =>
  db()
    .from("likes")
    .groupBy("postId")
    .aggregate(count().as("likes"))
    .as("counts");

const feed = () =>
  db()
    .from("posts")
    .join("users", "users.id", "posts.authorId")
    .leftJoin(likeCounts(), "counts.postId", "posts.id")
    .select("posts.id", "users.handle as author", "posts.body", "counts.likes");

export async function listPosts(): Promise<Post[]> {
  return feed().orderBy("id", "desc").limit(50);
}

export async function getPost(id: number): Promise<Post | undefined> {
  return db()
    .from("posts")
    .join("users", "users.id", "posts.authorId")
    .leftJoin(likeCounts(), "counts.postId", "posts.id")
    .where("posts.id", "=", id)
    .select("posts.id", "users.handle as author", "posts.body", "counts.likes")
    .first();
}

export async function addLike(postId: number, userId: number): Promise<number> {
  return transaction(async () => {
    await db()
      .into("likes")
      .insert({ postId, userId })
      .onConflict(["postId", "userId"])
      .doNothing();

    const [row] = await db()
      .from("likes")
      .where("postId", "=", postId)
      .aggregate(count().as("likes"));

    return row?.likes ?? 0;
  });
}
