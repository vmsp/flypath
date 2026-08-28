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
import { manifest } from "virtual:flypath/route-manifest";

import type { Insets } from "../components/native/insets.ts";
import { InsetsContext } from "../components/native/insets.ts";
import { NavigatorContext } from "../components/native/navigator-context.ts";
import { StackHost } from "../components/native/navigator.tsx";
import { setNativeRouter } from "../components/native/router-store.ts";
import { NavigationContext, registerBack } from "../router/client.ts";
import { matchManifest, ROOT_CONTAINER } from "../router/manifest.ts";
import { normalizePath, searchParamsOf } from "../router/path.ts";
import type { ContainerRuntime } from "../router/scope.tsx";
import { ContainerRuntimeContext, ContainerScope } from "../router/scope.tsx";
import type { Navigation } from "../router/types.ts";
import { findSourceMapURL, nativeConfig } from "./native-config.ts";
import { readInsets, watchInsets } from "./native-insets.ts";
import type { Fetchers, Router } from "./native-router.ts";
import {
  activeBranch,
  applyPayload,
  focusedScreen,
  goBack,
  initialRouter,
  navigate,
  refresh as refreshRouter,
} from "./native-router.ts";
import type { RscPayload } from "./payload.ts";

async function fetchPayload(
  url: string,
  headers: Record<string, string>,
): Promise<RscPayload> {
  const { serverUrl, platform } = nativeConfig();
  const response = await fetch(`${serverUrl}${url}`, {
    headers: { "x-flypath-platform": platform, ...headers },
  });

  const redirect = response.headers.get("x-flypath-redirect");
  if (redirect !== null) return fetchPayload(redirect, headers);

  return createFromFetch<RscPayload>(Promise.resolve(response), {
    findSourceMapURL,
  } as Parameters<typeof createFromFetch>[1]);
}

const fetchers: Fetchers = {
  screen: (url, container) =>
    fetchPayload(url, { "x-flypath-screen": container }),
  fragment: (url, container) =>
    fetchPayload(url, { "x-flypath-fragment": container }),
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
  const [router, setRouter] = useState<Router>(() =>
    initialRouter("/", fetchers),
  );
  const [insets, setInsets] = useState<Insets>(readInsets);

  const state = useRef(router);
  state.current = router;

  useEffect(() => watchInsets(setInsets), []);

  const back = useCallback((): boolean => {
    const next = goBack(state.current);
    if (!next) return false;
    startTransition(() => setRouter(next));
    return true;
  }, []);

  const push = useCallback((href: string, replace: boolean) => {
    startTransition(() =>
      setRouter((current) => navigate(current, href, replace, fetchers)),
    );
  }, []);

  const refresh = useCallback(() => {
    startTransition(() =>
      setRouter((current) => refreshRouter(current, fetchers)),
    );
  }, []);

  useEffect(() => {
    registerBack(() => void back());
    setNativeRouter({
      push: (href: string) => push(href, false),
      replace: (href: string) => push(href, true),
      back: () => void back(),
      refresh,
      currentUrl: () => focusedScreen(state.current)?.url ?? "/",
      currentContainer: () =>
        focusedScreen(state.current)?.container ?? ROOT_CONTAINER,
      applyPayload: (payload) => {
        startTransition(() =>
          setRouter((current) => applyPayload(current, payload)),
        );
      },
    });
    return () => {
      registerBack(undefined);
      setNativeRouter(undefined);
    };
  }, [push, back, refresh]);

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

  const url = focusedScreen(router)?.url ?? "/";
  const pathname = normalizePath(url);

  const navigation = useMemo<Navigation>(
    () => ({
      pathname,
      params: matchManifest(manifest, pathname)?.params ?? {},
      searchParams: searchParamsOf(new URL(url, "http://flypath.local")),
    }),
    [url, pathname],
  );

  return (
    <InsetsContext.Provider value={insets}>
      <NavigatorContext.Provider value={router}>
        <ContainerRuntimeContext.Provider value={runtime}>
          <NavigationContext.Provider value={navigation}>
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
          </NavigationContext.Provider>
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
