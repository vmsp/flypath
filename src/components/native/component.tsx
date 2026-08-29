import type { ComponentType, ReactNode } from "react";
import { useMemo } from "react";
import type { HostComponent } from "react-native";
import * as NativeComponentRegistry from "react-native/Libraries/NativeComponent/NativeComponentRegistry";

import { nativeRegistry } from "../../runtime/native-bindings.ts";
import { nativeStyle } from "../../styles/native.ts";
import { ThemeContext } from "./context.ts";
import { IDLE_INTERACTION, useStyleEnv } from "./env.ts";
import type { Style } from "./resolve.ts";
import { resolveStyle, resolveTheme } from "./resolve.ts";

const DEV = process.env.NODE_ENV !== "production";

export type NativeComponentProps = {
  style?: unknown;
  children?: ReactNode;
  [key: string]: unknown;
};

export type NativeComponentEvent = {
  name: string;
  type: string;
  params: string[];
};

export type NativeComponentConfig = {
  name: string;
  label: string;
  props: string[];
  events: NativeComponentEvent[];
};

function viewConfig(config: NativeComponentConfig): {
  uiViewClassName: string;
  validAttributes: Record<string, boolean>;
  directEventTypes: Record<string, { registrationName: string }>;
} {
  return {
    uiViewClassName: config.name,
    validAttributes: Object.fromEntries(
      config.props.map((name) => [name, true]),
    ),
    directEventTypes: Object.fromEntries(
      config.events.map((event) => [
        event.type,
        { registrationName: event.name },
      ]),
    ),
  };
}

type NativeEventPayload = { nativeEvent: Record<string, unknown> };

function eventHandlers(
  config: NativeComponentConfig,
  props: NativeComponentProps,
): Record<string, (event: NativeEventPayload) => void> {
  const out: Record<string, (event: NativeEventPayload) => void> = {};
  for (const event of config.events) {
    const handler = props[event.name];
    if (typeof handler !== "function") continue;
    const callback = handler as (...args: unknown[]) => void;
    out[event.name] = (payload) => {
      callback(...event.params.map((name) => payload.nativeEvent[name]));
    };
  }
  return out;
}

export function nativeComponent(
  config: NativeComponentConfig,
): ComponentType<NativeComponentProps> {
  let host: HostComponent<NativeComponentProps> | undefined;

  const resolveHost = (): HostComponent<NativeComponentProps> => {
    if (host) return host;
    if (!nativeRegistry().components.includes(config.name)) {
      throw new Error(
        `flypath: <${config.label}> is not in this build of the app — ` +
          'run "pnpm ios" or "pnpm android"',
      );
    }
    const created = NativeComponentRegistry.get<NativeComponentProps>(
      config.name,
      () => viewConfig(config),
    );
    host = created;
    return created;
  };

  function Native(props: NativeComponentProps): ReactNode {
    const { style, children, ...rest } = props;
    if (children !== undefined && DEV) {
      throw new Error(
        `flypath: <${config.label}> does not accept children yet`,
      );
    }

    const Host = resolveHost();
    const normalized = useMemo(() => nativeStyle("div", style, DEV), [style]);
    const env = useStyleEnv(IDLE_INTERACTION);

    const theme = useMemo(
      () => resolveTheme(normalized?.theme, env) ?? env.theme,
      [env, normalized],
    );
    const resolved = useMemo(
      () => resolveStyle(normalized?.view, { ...env, theme }),
      [env, normalized, theme],
    );

    const handlers = eventHandlers(config, props);
    const node = <Host {...rest} {...handlers} style={resolved as Style} />;
    if (theme === env.theme) return node;
    return <ThemeContext.Provider value={theme}>{node}</ThemeContext.Provider>;
  }

  return Native;
}
