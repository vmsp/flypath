// TODO: This package has been dead for 5+ years. Perhaps we can implement our
// own?
import {
  fetch as streamingFetch,
  Headers,
  Request,
  Response,
} from "react-native-fetch-api";
import { TextDecoder, TextEncoder } from "text-encoding";
import {
  ReadableStream,
  TransformStream,
  WritableStream,
} from "web-streams-polyfill";

type Mutable = Record<string, unknown>;

type Entry = [string, string];

class FlypathFormData {
  #entries: Entry[] = [];

  append(name: string, value: unknown): void {
    this.#entries.push([String(name), String(value)]);
  }

  set(name: string, value: unknown): void {
    const key = String(name);
    const next = this.#entries.filter(([entry]) => entry !== key);
    next.push([key, String(value)]);
    this.#entries = next;
  }

  get(name: string): string | null {
    const key = String(name);
    for (const [entry, value] of this.#entries) {
      if (entry === key) return value;
    }
    return null;
  }

  getAll(name: string): string[] {
    const key = String(name);
    return this.#entries
      .filter(([entry]) => entry === key)
      .map(([, value]) => value);
  }

  has(name: string): boolean {
    const key = String(name);
    return this.#entries.some(([entry]) => entry === key);
  }

  delete(name: string): void {
    const key = String(name);
    this.#entries = this.#entries.filter(([entry]) => entry !== key);
  }

  forEach(
    callback: (value: string, name: string, form: FlypathFormData) => void,
    thisArg?: unknown,
  ): void {
    for (const [name, value] of [...this.#entries]) {
      callback.call(thisArg, value, name, this);
    }
  }

  *entries(): IterableIterator<Entry> {
    yield* [...this.#entries];
  }

  *keys(): IterableIterator<string> {
    for (const [name] of [...this.#entries]) yield name;
  }

  *values(): IterableIterator<string> {
    for (const [, value] of [...this.#entries]) yield value;
  }

  [Symbol.iterator](): IterableIterator<Entry> {
    return this.entries();
  }

  get [Symbol.toStringTag](): string {
    return "FormData";
  }
}

function escapeFieldName(name: string): string {
  return name
    .replaceAll("\r\n", "%0D%0A")
    .replaceAll("\r", "%0D")
    .replaceAll("\n", "%0A")
    .replaceAll('"', "%22");
}

function serializeMultipart(form: FlypathFormData): {
  body: string;
  contentType: string;
} {
  const boundary = `----flypath${Math.random().toString(16).slice(2)}${Date.now().toString(16)}`;
  let body = "";
  for (const [name, value] of form.entries()) {
    body += `--${boundary}\r\n`;
    body += `Content-Disposition: form-data; name="${escapeFieldName(name)}"\r\n\r\n`;
    body += `${value}\r\n`;
  }
  body += `--${boundary}--\r\n`;
  return { body, contentType: `multipart/form-data; boundary=${boundary}` };
}

type FetchInit = Record<string, unknown> & {
  body?: unknown;
  headers?: unknown;
};

function headerObject(headers: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!headers) return out;
  if (Array.isArray(headers)) {
    for (const [key, value] of headers as Array<[string, string]>) {
      out[key] = value;
    }
    return out;
  }
  const iterable = headers as {
    forEach?: (callback: (value: string, key: string) => void) => void;
  };
  if (typeof iterable.forEach === "function") {
    iterable.forEach((value, key) => {
      out[key] = value;
    });
    return out;
  }
  return { ...(headers as Record<string, string>) };
}

function withMultipart(init: FetchInit | undefined): FetchInit | undefined {
  if (!init || !(init.body instanceof FlypathFormData)) return init;
  const { body, contentType } = serializeMultipart(init.body);
  return {
    ...init,
    body,
    headers: { ...headerObject(init.headers), "content-type": contentType },
  };
}

export function installFlightPolyfills(): void {
  const scope = globalThis as unknown as Mutable;

  if (typeof scope["ReadableStream"] !== "function") {
    scope["ReadableStream"] = ReadableStream;
    scope["WritableStream"] = WritableStream;
    scope["TransformStream"] = TransformStream;
  }
  if (typeof scope["TextEncoder"] !== "function") {
    scope["TextEncoder"] = TextEncoder;
  }
  if (typeof scope["TextDecoder"] !== "function") {
    scope["TextDecoder"] = TextDecoder;
  }

  scope["FormData"] = FlypathFormData;
  scope["Headers"] = Headers;
  scope["Request"] = Request;
  scope["Response"] = Response;
  scope["fetch"] = (input: unknown, init?: FetchInit) =>
    (streamingFetch as (i: unknown, o: unknown) => Promise<unknown>)(input, {
      ...withMultipart(init),
      reactNative: { textStreaming: true },
    });
}
