import { createFromFetch } from "@vitejs/plugin-rsc/react/browser";
import type { ReactNode } from "react";
import {
  Component,
  startTransition,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ActivityIndicator,
  AppState,
  BackHandler,
  Linking,
  StyleSheet,
  Text,
  View,
} from "react-native";

import type { Insets } from "../components/native/insets.ts";
import { InsetsContext } from "../components/native/insets.ts";
import type { NavigatorValue } from "../components/native/navigator-context.ts";
import { NavigatorContext } from "../components/native/navigator-context.ts";
import { StackHost } from "../components/native/navigator.tsx";
import { setNativeRouter } from "../components/native/router-store.ts";
import {
  CHROME_HEADER,
  FRAGMENT_HEADER,
  LOCATION_HEADER,
  NAVIGATE_HEADER,
  PLATFORM_HEADER,
  SCREEN_HEADER,
} from "../protocol/headers.ts";
import { setRouter } from "../router/dispatch.ts";
import { isExternal } from "../router/href.ts";
import { ROOT_CONTAINER } from "../router/manifest.ts";
import { parseCommand, parseLocation } from "../router/navigation.ts";
import type { ContainerRuntime } from "../router/scope.tsx";
import { ContainerRuntimeContext, ContainerScope } from "../router/scope.tsx";
import type { Mode } from "../router/types.ts";
import { findSourceMapURL, nativeConfig } from "./native-config.ts";
import type { Fetched } from "./native-content.ts";
import {
  apply,
  attach,
  bumpEpoch,
  currentEpoch,
  fail,
  seedPayload,
  staleTimeOf,
  sync,
} from "./native-content.ts";
import { readInsets, watchInsets } from "./native-insets.ts";
import type { Router } from "./native-router.ts";
import {
  activeBranch,
  entryOf,
  focusedScreen,
  goBack,
  initialRouter,
  navigate,
  popKeys,
  relocate,
  visible,
} from "./native-router.ts";
import type { RscPayload } from "./payload.ts";

async function flight(
  url: string,
  headers: Record<string, string>,
): Promise<Response> {
  const { serverUrl, platform } = nativeConfig();
  return fetch(`${serverUrl}${url}`, {
    headers: { [PLATFORM_HEADER]: platform, ...headers },
  });
}

function decode(response: Response): Promise<RscPayload> {
  return createFromFetch<RscPayload>(Promise.resolve(response), {
    findSourceMapURL,
  } as Parameters<typeof createFromFetch>[1]);
}

async function fetchScreen(
  url: string,
  container: string,
  chrome: readonly string[],
): Promise<Fetched> {
  const response = await flight(url, {
    [SCREEN_HEADER]: container,
    ...(chrome.length === 0 ? {} : { [CHROME_HEADER]: chrome.join(",") }),
  });
  const command = parseCommand(response.headers.get(NAVIGATE_HEADER));
  const location = parseLocation(response.headers.get(LOCATION_HEADER));

  if (response.status === 204) return { command, location };
  return { command, location, payload: await decode(response) };
}

async function fetchFragment(
  url: string,
  container: string,
): Promise<RscPayload> {
  const response = await flight(url, { [FRAGMENT_HEADER]: container });
  if (response.status === 204) {
    throw new Error(
      `flypath: the chrome of container "${container}" redirected while ` +
        "rendering; a fragment renders around a URL whose guards have " +
        "already passed, so following it would let the chrome navigate the app",
    );
  }
  return decode(response);
}

const NO_HISTORY =
  'flypath: navigate("back") ran while rendering a screen; there is no ' +
  "history to pop until the screen exists";

class RootBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  override state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error };
  }

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <View style={styles.center}>
        <Text style={styles.error}>{error.message}</Text>
      </View>
    );
  }
}

export default function Root(): ReactNode {
  const [router, setState] = useState<Router>(() => ({
    ...initialRouter("/"),
    epoch: currentEpoch(),
  }));
  const [insets, setInsets] = useState<Insets>(readInsets);

  const state = useRef(router);
  state.current = router;

  const away = useRef(0);

  useEffect(() => watchInsets(setInsets), []);

  useEffect(() => {
    const detach = attach({
      screen: fetchScreen,
      fragment: fetchFragment,
      dev: nativeConfig().dev,
      router: () => state.current,
      settle: (key, result) => {
        const command = result.command;
        if (command?.kind === "go" && isExternal(command.to)) {
          void Linking.openURL(command.to);
          return;
        }
        if (command?.kind === "back") {
          fail(key, new Error(NO_HISTORY));
          return;
        }
        startTransition(() =>
          setState((current) => relocate(current, key, result)),
        );
      },
    });
    return detach;
  }, []);

  useEffect(() => {
    sync(router);
  }, [router]);

  const back = useCallback((): boolean => {
    const next = goBack(state.current);
    if (!next) return false;
    startTransition(() => setState(next));
    return true;
  }, []);

  const push = useCallback((href: string, replace: boolean) => {
    startTransition(() =>
      setState((current) => navigate(current, href, replace)),
    );
  }, []);

  const go = useCallback(
    (href: string, mode: Mode) => {
      if (isExternal(href)) {
        void Linking.openURL(href);
        return;
      }
      push(href, mode === "replace");
    },
    [push],
  );

  const invalidate = useCallback((force: boolean): number => {
    const epoch = bumpEpoch(force);
    startTransition(() => setState((current) => ({ ...current, epoch })));
    return epoch;
  }, []);

  useEffect(() => {
    const detachRouter = setRouter({
      go,
      back: () => void back(),
      revalidate: (mode) => {
        if (mode === "none") return;
        const epoch = invalidate(false);
        apply({
          epoch,
          mode,
          key: undefined,
          url: undefined,
          payload: undefined,
        });
      },
    });
    const detachNative = setNativeRouter({
      currentUrl: () => focusedScreen(state.current)?.url ?? "/",
      currentContainer: () =>
        focusedScreen(state.current)?.container ?? ROOT_CONTAINER,
      currentKey: () => focusedScreen(state.current)?.key,
      chromeIds: () => visible(state.current).chrome,
      popped: (keys) => {
        startTransition(() => setState((current) => popKeys(current, keys)));
      },
      commit: ({ key, mode, payload, command, location }) => {
        if (mode === "none") return;
        const epoch = bumpEpoch(false);
        if (command && payload && location) {
          seedPayload(location, payload, epoch);
        }
        apply({
          epoch,
          mode,
          key: command ? undefined : key,
          url: command ? undefined : entryOf(state.current, key)?.url,
          payload,
        });
        startTransition(() => setState((current) => ({ ...current, epoch })));
      },
    });
    return () => {
      detachRouter();
      detachNative();
    };
  }, [go, back, invalidate]);

  useEffect(() => {
    const subscription = BackHandler.addEventListener(
      "hardwareBackPress",
      back,
    );
    return () => subscription.remove();
  }, [back]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (status) => {
      if (status !== "active") {
        away.current = Date.now();
        return;
      }
      if (away.current === 0) return;
      const idle = Date.now() - away.current;
      away.current = 0;
      const url = focusedScreen(state.current)?.url ?? "/";
      if (idle < staleTimeOf(url)) return;
      invalidate(false);
    });
    return () => subscription.remove();
  }, [invalidate]);

  useEffect(() => {
    const open = (url: string | null | undefined) => {
      if (url === null || url === undefined) return;
      const path = url.replace(/^[a-z][a-z\d+.-]*:\/\/[^/]*/i, "");
      if (path === "" || path === "/") return;
      push(path, false);
    };
    void Linking.getInitialURL().then(open);
    const subscription = Linking.addEventListener("url", (event) =>
      open(event.url),
    );
    return () => subscription.remove();
  }, [push]);

  useEffect(() => {
    const { dev, serverUrl } = nativeConfig();
    if (!dev) return;
    const socket = new WebSocket(`${serverUrl.replace(/^http/, "ws")}/flypath`);
    socket.onmessage = (event: { data: unknown }) => {
      const data = JSON.parse(String(event.data)) as { type?: string };
      if (data.type === "rsc-update") invalidate(true);
    };
    return () => socket.close();
  }, [invalidate]);

  const value = useMemo<NavigatorValue>(
    () => ({ tree: router.tree, epoch: router.epoch }),
    [router],
  );

  const runtime = useMemo<ContainerRuntime>(
    () => ({ activeBranch: (id) => activeBranch(router, id) }),
    [router],
  );

  return (
    <InsetsContext.Provider value={insets}>
      <NavigatorContext.Provider value={value}>
        <ContainerRuntimeContext.Provider value={runtime}>
          <View style={styles.container}>
            <RootBoundary>
              <Suspense
                fallback={
                  <View style={styles.center}>
                    <ActivityIndicator />
                  </View>
                }
              >
                <ContainerScope id={ROOT_CONTAINER}>
                  <StackHost id={ROOT_CONTAINER} />
                </ContainerScope>
              </Suspense>
            </RootBoundary>
          </View>
        </ContainerRuntimeContext.Provider>
      </NavigatorContext.Provider>
    </InsetsContext.Provider>
  );
}

const styles = StyleSheet.create({
  center: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
  },
  container: {
    flex: 1,
  },
  error: {
    color: "#b00020",
    fontSize: 14,
  },
});
