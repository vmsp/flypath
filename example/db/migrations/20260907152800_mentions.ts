import { createTable, migration } from "flypath/migrations";
import { bigint, primaryKey, timestamptz } from "flypath/schema";

export default migration([
  createTable(
    "mentions",
    {
      createdAt: timestamptz().notNull().defaultNow(),
      noteId: bigint()
        .references({ table: "notes", column: "id" }, { onDelete: "cascade" })
        .notNull(),
      userId: bigint()
        .references({ table: "users", column: "id" }, { onDelete: "cascade" })
        .notNull(),
    },
    (t) => [primaryKey().on(t.noteId, t.userId)],
  ),
]);
