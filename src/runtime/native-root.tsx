import { createFromFetch } from "@vitejs/plugin-rsc/react/browser";
import type { ReactNode } from "react";
import {
  Component,
  startTransition,
  Suspense,
  use,
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
import { setNativeRouter } from "../components/native/router-store.ts";
import type {
  ScreenState,
  StackState,
} from "../components/native/stack-context.ts";
import { StackContext } from "../components/native/stack-context.ts";
import { NavigationContext } from "../router/client.ts";
import { boundaryOf, matchManifest } from "../router/manifest.ts";
import { normalizePath, searchParamsOf } from "../router/path.ts";
import type { Navigation } from "../router/types.ts";
import { findSourceMapURL, nativeConfig } from "./native-config.ts";
import { readInsets, watchInsets } from "./native-insets.ts";
import type { RscPayload } from "./payload.ts";

type Stacks = Record<string, readonly ScreenState[]>;

const TABS = boundaryOf(manifest, manifest.navigator)?.tabs ?? [];
const SCREEN_BOUNDARY = manifest.navigator;
const ROOT_STACK = TABS[0]?.key ?? SCREEN_BOUNDARY;

let counter = 0;

function nextKey(): string {
  counter += 1;
  return `screen-${counter}`;
}

async function fetchPayload(
  url: string,
  boundary: string,
): Promise<RscPayload> {
  const { serverUrl, platform } = nativeConfig();
  const response = await fetch(`${serverUrl}${url}`, {
    headers: {
      "x-flypath-platform": platform,
      "x-flypath-screen": boundary,
    },
  });

  const redirect = response.headers.get("x-flypath-redirect");
  if (redirect !== null) return fetchPayload(redirect, boundary);

  return createFromFetch<RscPayload>(Promise.resolve(response), {
    findSourceMapURL,
  } as Parameters<typeof createFromFetch>[1]);
}

function makeScreen(url: string): ScreenState {
  const matched = matchManifest(manifest, normalizePath(url));
  return {
    key: nextKey(),
    url,
    safeArea: matched?.route.options.safeArea,
    presentation: matched?.route.options.presentation ?? "push",
    payload: fetchPayload(url, SCREEN_BOUNDARY),
  };
}

function stackKeyFor(url: string, activeTab: string): string {
  const matched = matchManifest(manifest, normalizePath(url));
  return matched?.route.tab ?? activeTab;
}

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

function Chrome({ payload }: { payload: Promise<RscPayload> }): ReactNode {
  return use(payload).root;
}

export default function Root(): ReactNode {
  const [chrome, setChrome] = useState(() => fetchPayload("/", "chrome"));
  const [activeTab, setActiveTab] = useState(ROOT_STACK);
  const [stacks, setStacks] = useState<Stacks>(() => ({
    [ROOT_STACK]: [makeScreen(TABS[0]?.path ?? "/")],
  }));
  const [insets, setInsets] = useState<Insets>(readInsets);

  const state = useRef({ activeTab, stacks });
  state.current = { activeTab, stacks };

  useEffect(() => watchInsets(setInsets), []);

  const ensure = useCallback((key: string, current: Stacks): Stacks => {
    if (current[key]) return current;
    const tab = TABS.find((entry) => entry.key === key);
    return { ...current, [key]: [makeScreen(tab?.path ?? "/")] };
  }, []);

  const push = useCallback(
    (href: string, replace: boolean) => {
      const key = stackKeyFor(href, state.current.activeTab);
      startTransition(() => {
        if (key !== state.current.activeTab) setActiveTab(key);
        setStacks((current) => {
          const next = ensure(key, current);
          const stack = next[key] ?? [];
          const kept = replace ? stack.slice(0, -1) : stack;
          return { ...next, [key]: [...kept, makeScreen(href)] };
        });
      });
    },
    [ensure],
  );

  const back = useCallback((): boolean => {
    const { activeTab: key, stacks: current } = state.current;
    const stack = current[key] ?? [];
    if (stack.length > 1) {
      startTransition(() =>
        setStacks((value) => ({ ...value, [key]: stack.slice(0, -1) })),
      );
      return true;
    }
    if (key !== ROOT_STACK) {
      startTransition(() => setActiveTab(ROOT_STACK));
      return true;
    }
    return false;
  }, []);

  const switchTab = useCallback(
    (key: string) => {
      startTransition(() => {
        if (state.current.activeTab === key) {
          setStacks((current) => {
            const stack = current[key] ?? [];
            return stack.length > 1
              ? { ...current, [key]: stack.slice(0, 1) }
              : current;
          });
          return;
        }
        setActiveTab(key);
        setStacks((current) => ensure(key, current));
      });
    },
    [ensure],
  );

  const refresh = useCallback(() => {
    startTransition(() => {
      setChrome(fetchPayload("/", "chrome"));
      setStacks((current) => {
        const next: Stacks = {};
        for (const [key, stack] of Object.entries(current)) {
          next[key] = stack.map((entry) => ({
            ...entry,
            payload: fetchPayload(entry.url, SCREEN_BOUNDARY),
          }));
        }
        return next;
      });
    });
  }, []);

  useEffect(() => {
    setNativeRouter({
      push: (href: string) => push(href, false),
      replace: (href: string) => push(href, true),
      back: () => void back(),
      refresh,
      switchTab,
      currentUrl: () => {
        const { activeTab: key, stacks: current } = state.current;
        return (current[key] ?? []).at(-1)?.url ?? "/";
      },
      applyPayload: (payload) => {
        const { activeTab: key } = state.current;
        startTransition(() =>
          setStacks((current) => {
            const stack = current[key] ?? [];
            const top = stack.at(-1);
            if (!top) return current;
            return {
              ...current,
              [key]: [...stack.slice(0, -1), { ...top, payload }],
            };
          }),
        );
      },
    });
    return () => setNativeRouter(undefined);
  }, [push, back, refresh, switchTab]);

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

  const stackState = useMemo<StackState>(
    () => ({ stacks, activeTab, tabs: TABS }),
    [stacks, activeTab],
  );

  const top = (stacks[activeTab] ?? []).at(-1);
  const url = top?.url ?? "/";
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
      <StackContext.Provider value={stackState}>
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
                <Chrome payload={chrome} />
              </Suspense>
            </RootBoundary>
          </View>
        </NavigationContext.Provider>
      </StackContext.Provider>
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
