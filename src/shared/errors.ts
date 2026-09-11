export type FlypathErrorOptions = {
  hint?: string;
  details?: readonly string[];
  cause?: unknown;
  brief?: boolean;
};

export class FlypathError extends Error {
  readonly hint: string | undefined;

  readonly details: readonly string[];

  readonly brief: boolean;

  constructor(message: string, options: FlypathErrorOptions = {}) {
    super(
      message,
      options.cause === undefined ? undefined : { cause: options.cause },
    );
    this.name = "FlypathError";
    this.hint = options.hint;
    this.details = options.details ?? [];
    this.brief = options.brief ?? false;
  }
}
