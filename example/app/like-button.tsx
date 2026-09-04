"use client";

import { useState } from "react";

import { likePost } from "./actions.ts";
import { colors } from "./vars.css.ts";

export default function LikeButton({
  id,
  likes,
}: {
  id: number;
  likes: number;
}) {
  const [count, setCount] = useState(likes);

  return (
    <button
      onClick={() => {
        setCount(count + 1);
        likePost(id).then(setCount, () => setCount(count));
      }}
      style={{
        backgroundColor: colors.secondary,
        borderRadius: 8,
        color: "white",
        padding: 12,
      }}
    >
      ♥ {count} likes
    </button>
  );
}
