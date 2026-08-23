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

  scope["Headers"] = Headers;
  scope["Request"] = Request;
  scope["Response"] = Response;
  scope["fetch"] = (input: unknown, init?: Record<string, unknown>) =>
    (streamingFetch as (i: unknown, o: unknown) => Promise<unknown>)(input, {
      ...init,
      reactNative: { textStreaming: true },
    });
}
