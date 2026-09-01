import type {
  ParamsReader,
  QueryReader,
  RouteInfo,
  SearchParams,
} from "./types.ts";

type Read = () => RouteInfo;

function firstOf(info: RouteInfo): SearchParams {
  const out: SearchParams = {};
  for (const [key, values] of Object.entries(info.search)) {
    const value = values[0];
    if (value !== undefined) out[key] = value;
  }
  return out;
}

export function makeParams(read: Read): ParamsReader {
  return ((name?: string) => {
    const info = read();
    if (name === undefined) return { ...firstOf(info), ...info.params };
    const value = info.params[name];
    if (value === undefined) {
      throw new Error(
        `flypath: params("${name}") is not a param of "${info.pathname}"`,
      );
    }
    return value;
  }) as ParamsReader;
}

export function makeQuery(read: Read): QueryReader {
  const query = (name?: string): string | undefined | SearchParams => {
    const info = read();
    return name === undefined ? firstOf(info) : info.search[name]?.[0];
  };

  return Object.assign(query, {
    all: (name: string): readonly string[] => read().search[name] ?? [],
  }) as QueryReader;
}
