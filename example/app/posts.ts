export type Post = {
  id: string;
  author: string;
  body: string;
  likes: number;
};

const POSTS: Post[] = [
  {
    id: "1",
    author: "ada",
    body: "The Analytical Engine weaves algebraic patterns.",
    likes: 128,
  },
  {
    id: "2",
    author: "grace",
    body: "A ship in port is safe, but that is not what ships are built for.",
    likes: 94,
  },
  {
    id: "3",
    author: "alan",
    body: "We can only see a short distance ahead.",
    likes: 61,
  },
  {
    id: "4",
    author: "barbara",
    body: "You have to have a feeling for the organism.",
    likes: 43,
  },
];

export async function listPosts(): Promise<Post[]> {
  return POSTS;
}

export async function getPost(id: string): Promise<Post | undefined> {
  return POSTS.find((post) => post.id === id);
}

export function addLike(id: string): number {
  const post = POSTS.find((entry) => entry.id === id);
  if (!post) return 0;
  post.likes += 1;
  return post.likes;
}
