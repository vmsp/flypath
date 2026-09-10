/**
 * Every environment variable flypath reads on a consumer's behalf, and the only
 * place that names one. Values are read at call time, because `.env` is loaded
 * by the CLI after this module is imported.
 */
export const ENV = {
  /** The application's public origin. Defaults `url`, and `mail.baseUrl`. */
  url: "FLYPATH_URL",

  /** Build id shared by one `flypath build` across every artefact it writes. */
  build: "FLYPATH_BUILD",

  /** Web worker count for `flypath start`. */
  cluster: "FLYPATH_CLUSTER",

  /** Web worker count, under the name Puma and Gunicorn gave it. */
  concurrency: "WEB_CONCURRENCY",

  /** Port the plain listener binds. */
  port: "PORT",

  /** Address the listeners bind. */
  host: "HOST",

  /** Port the TLS listener binds. */
  tlsPort: "TLS_PORT",

  /** Connection url for the default database. */
  database: "DATABASE_URL",

  /** Transport url for outgoing mail. */
  smtp: "SMTP_URL",

  /** Default sender for outgoing mail. */
  mailFrom: "MAIL_FROM",

  /** Android SDK location, in the order the Android tools look for it. */
  androidHome: "ANDROID_HOME",
  androidSdkRoot: "ANDROID_SDK_ROOT",

  /** JDK location for the Gradle build. */
  javaHome: "JAVA_HOME",

  /** Prefix for the release keystore, so CI need not write a file. */
  androidSigning: "FLYPATH_ANDROID_",
} as const;

function read(name: string): string | undefined {
  const value = process.env[name];
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

function number(name: string): number | undefined {
  const value = read(name);
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(
      `flypath: ${name} must be a non-negative number, got ${value}`,
    );
  }
  return Math.floor(parsed);
}

/** The public origin, with any trailing slash removed. */
export function appUrl(): string | undefined {
  return read(ENV.url)?.replace(/\/+$/, "");
}

/** The build id this process was handed, if `flypath build` set one. */
export function buildId(): string | undefined {
  return read(ENV.build);
}

/** Pins the build id so every artefact of one build agrees on it. */
export function setBuildId(id: string): void {
  process.env[ENV.build] = id;
}

/** Connection url for a named database; `default` reads `DATABASE_URL`. */
export function databaseUrl(name: string): string | undefined {
  if (name === "default") return read(ENV.database);
  const upper = name.replaceAll(/[^A-Za-z0-9]/g, "_").toUpperCase();
  return read(`${upper}_${ENV.database}`);
}

/** Transport url for outgoing mail. */
export function smtpUrl(): string | undefined {
  return read(ENV.smtp);
}

/** Default sender for outgoing mail. */
export function mailFrom(): string | undefined {
  return read(ENV.mailFrom);
}

/** Port for the plain listener. */
export function port(): number | undefined {
  return number(ENV.port);
}

/** Address the listeners bind. */
export function host(): string | undefined {
  return read(ENV.host);
}

/** Port for the TLS listener. */
export function tlsPort(): number | undefined {
  return number(ENV.tlsPort);
}

/** Requested web worker count, as written — `off` and `auto` are answers. */
export function cluster(): string | undefined {
  return read(ENV.cluster) ?? read(ENV.concurrency);
}

/** Android SDK location. */
export function androidHome(): string | undefined {
  return read(ENV.androidHome) ?? read(ENV.androidSdkRoot);
}

/** JDK location for the Gradle build. */
export function javaHome(): string | undefined {
  return read(ENV.javaHome);
}

/** One release-keystore field, e.g. `storeFile` reads `FLYPATH_ANDROID_STOREFILE`. */
export function androidSigning(key: string): string | undefined {
  return read(`${ENV.androidSigning}${key.toUpperCase()}`);
}
