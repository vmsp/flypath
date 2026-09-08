import { addColumn, migration, sql } from "flypath/migrations";
import { text } from "flypath/schema";

export default migration([
  addColumn("users", "email", text()),
  sql({
    up: `
      update users set "email" = "handle" || '@example.com' where "email" is null;
      alter table users alter column "email" set not null;
      alter table users add constraint users_email_key unique ("email");
    `,
    down: `
      alter table users drop constraint users_email_key;
      alter table users alter column "email" drop not null;
    `,
  }),
]);
