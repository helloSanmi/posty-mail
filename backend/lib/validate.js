import { z } from 'zod';

export function validate(schema, source = 'body') {
  return (req, res, next) => {
    const result = schema.safeParse(req[source]);

    if (!result.success) {
      const issue = result.error.issues[0];
      const path = issue.path.join('.') || source;
      res.status(400).json({ error: `${path}: ${issue.message}` });
      return;
    }

    req[source] = result.data;
    next();
  };
}

export { z };
