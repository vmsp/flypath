import { migration, sql } from "flypath/migrations";

export default migration([
  sql({
    up: `
      insert into users ("handle", "name") values
        ('ada', 'Ada Lovelace'),
        ('grace', 'Grace Hopper'),
        ('alan', 'Alan Turing'),
        ('barbara', 'Barbara McClintock');

      insert into posts ("authorId", "body")
      select "id", "body" from (values
        ('ada', 'The Analytical Engine weaves algebraic patterns.'),
        ('grace', 'A ship in port is safe, but that is not what ships are built for.'),
        ('alan', 'We can only see a short distance ahead.'),
        ('barbara', 'You have to have a feeling for the organism.')
      ) as seed ("handle", "body")
      join users using ("handle");

      insert into likes ("postId", "userId")
      select p."id", u."id" from posts p cross join users u where u."handle" = 'ada';
    `,
    down: `
      delete from likes;
      delete from posts;
      delete from users;
    `,
  }),
]);
