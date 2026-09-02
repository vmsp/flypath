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
  BackHandler,
  Linking,
  StyleSheet,
  Text,
  View,
} from "react-native";

import type { Insets } from "../components/native/insets.ts";
import { InsetsContext } from "../components/native/insets.ts";
import { NavigatorContext } from "../components/native/navigator-context.ts";
import { StackHost } from "../components/native/navigator.tsx";
import { setNativeRouter } from "../components/native/router-store.ts";
import { setRouter } from "../router/dispatch.ts";
import { isExternal } from "../router/href.ts";
import { ROOT_CONTAINER } from "../router/manifest.ts";
import {
  LOCATION_HEADER,
  NAVIGATE_HEADER,
  parseCommand,
  parseLocation,
} from "../router/navigation.ts";
import type { ContainerRuntime } from "../router/scope.tsx";
import { ContainerRuntimeContext, ContainerScope } from "../router/scope.tsx";
import type { Mode } from "../router/types.ts";
import { findSourceMapURL, nativeConfig } from "./native-config.ts";
import { readInsets, watchInsets } from "./native-insets.ts";
import type { Fetched, Fetchers, Router } from "./native-router.ts";
import {
  activeBranch,
  applyPayload,
  focusedScreen,
  goBack,
  initialRouter,
  navigate,
  refresh as refreshRouter,
  relocate,
} from "./native-router.ts";
import type { RscPayload } from "./payload.ts";

async function flight(
  url: string,
  headers: Record<string, string>,
): Promise<Response> {
  const { serverUrl, platform } = nativeConfig();
  return fetch(`${serverUrl}${url}`, {
    headers: { "x-flypath-platform": platform, ...headers },
  });
}

function decode(response: Response): Promise<RscPayload> {
  return createFromFetch<RscPayload>(Promise.resolve(response), {
    findSourceMapURL,
  } as Parameters<typeof createFromFetch>[1]);
}

async function fetchScreen(url: string, container: string): Promise<Fetched> {
  const response = await flight(url, { "x-flypath-screen": container });
  const command = parseCommand(response.headers.get(NAVIGATE_HEADER));
  const location = parseLocation(response.headers.get(LOCATION_HEADER));

  if (response.status === 204) return { command, location };
  return { command, location, payload: await decode(response) };
}

async function fetchFragment(
  url: string,
  container: string,
): Promise<RscPayload> {
  const response = await flight(url, { "x-flypath-fragment": container });
  if (response.status === 204) {
    throw new Error(
      `flypath: the chrome of container "${container}" redirected while ` +
        "rendering; a fragment renders around a URL whose guards have " +
        "already passed, so following it would let the chrome navigate the app",
    );
  }
  return decode(response);
}

let settled: ((key: string, result: Fetched) => void) | undefined;

const pending: [string, Fetched][] = [];

const fetchers: Fetchers = {
  screen: fetchScreen,
  fragment: fetchFragment,
  settle: (key, result) => {
    if (settled) settled(key, result);
    else pending.push([key, result]);
  },
};

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
  const [router, setState] = useState<Router>(() =>
    initialRouter("/", fetchers),
  );
  const [insets, setInsets] = useState<Insets>(readInsets);

  const state = useRef(router);
  state.current = router;

  useEffect(() => watchInsets(setInsets), []);

  useEffect(() => {
    settled = (key, result) => {
      const command = result.command;
      if (command?.kind === "go" && isExternal(command.to)) {
        void Linking.openURL(command.to);
        return;
      }
      startTransition(() =>
        setState((current) => relocate(current, key, result, fetchers)),
      );
    };
    for (const [key, result] of pending.splice(0)) settled(key, result);
    return () => {
      settled = undefined;
    };
  }, []);

  const back = useCallback((): boolean => {
    const next = goBack(state.current);
    if (!next) return false;
    startTransition(() => setState(next));
    return true;
  }, []);

  const push = useCallback((href: string, replace: boolean) => {
    startTransition(() =>
      setState((current) => navigate(current, href, replace, fetchers)),
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

  const refresh = useCallback(() => {
    startTransition(() =>
      setState((current) => refreshRouter(current, fetchers)),
    );
  }, []);

  useEffect(() => {
    setRouter({ go, back: () => void back() });
    setNativeRouter({
      currentUrl: () => focusedScreen(state.current)?.url ?? "/",
      currentContainer: () =>
        focusedScreen(state.current)?.container ?? ROOT_CONTAINER,
      applyPayload: (payload) => {
        startTransition(() =>
          setState((current) => applyPayload(current, payload)),
        );
      },
    });
    return () => {
      setRouter(undefined);
      setNativeRouter(undefined);
    };
  }, [go, back]);

  useEffect(() => {
    const subscription = BackHandler.addEventListener(
      "hardwareBackPress",
      back,
    );
    return () => subscription.remove();
  }, [back]);

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
      if (data.type === "rsc-update") refresh();
    };
    return () => socket.close();
  }, [refresh]);

  const runtime = useMemo<ContainerRuntime>(
    () => ({ activeBranch: (id) => activeBranch(router, id) }),
    [router],
  );

  return (
    <InsetsContext.Provider value={insets}>
      <NavigatorContext.Provider value={router}>
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
