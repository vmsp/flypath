import { globals } from "../shared/globals.ts";

export type QueueOptions = {
  concurrency?: number;
  retries?: number;
  retryDelay?: number;
  backoff?: boolean;
  timeout?: number;
  notify?: boolean;
  pollInterval?: number;
};

export type JobsOptions = {
  queues?: Record<string, QueueOptions>;
  database?: string;
  retention?: number;
};

export type Queue = {
  name: string;
  concurrency: number;
  retries: number;
  retryDelay: number;
  backoff: boolean;
  timeout: number;
  notify: boolean;
  pollInterval: number;
};

const DEFAULTS: Omit<Queue, "name"> = {
  concurrency: 1,
  retries: 2,
  retryDelay: 0,
  backoff: false,
  timeout: 900,
  notify: true,
  pollInterval: 2,
};

const RETENTION = 604_800;

export function configureJobs(options: JobsOptions): void {
  const state = globals();
  const current = state.jobsConfig;
  state.jobsConfig = {
    ...current,
    ...options,
    queues: { ...current?.queues, ...options.queues },
  };
}

export function jobsDatabase(): string {
  return globals().jobsConfig?.database ?? "default";
}

export function retention(): number {
  return globals().jobsConfig?.retention ?? RETENTION;
}

export function queueNames(): readonly string[] {
  const declared = Object.keys(globals().jobsConfig?.queues ?? {});
  return [...new Set(["default", ...declared])];
}

export function queue(name: string): Queue {
  const declared = globals().jobsConfig?.queues?.[name];
  if (declared === undefined && name !== "default") {
    throw new Error(
      `There is no "${name}" queue; declare it in vite.config.ts ` +
        `under jobs.queues`,
    );
  }
  const resolved: Queue = { name, ...DEFAULTS };
  for (const [key, value] of Object.entries(declared ?? {})) {
    if (value === undefined) continue;
    (resolved as unknown as Record<string, unknown>)[key] = value;
  }
  return resolved;
}
