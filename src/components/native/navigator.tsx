"use client";

import type { Context, ReactNode } from "react";
import {
  Activity,
  Component,
  createContext,
  Suspense,
  use,
  useCallback,
  useContext,
} from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { manifest } from "virtual:flypath/route-manifest";

import { containerById } from "../../router/manifest.ts";
import { ContainerScope } from "../../router/scope.tsx";
import { useContent } from "./content.ts";
import { edgesOf, insetPadding, useInsets } from "./insets.ts";
import type { Content, Entry, ScreenEntry } from "./navigator-context.ts";
import { chromeKey, useNavigator } from "./navigator-context.ts";
import { nativeRouter } from "./router-store.ts";
import type { PoppedEvent } from "./screens.ts";
import { ScreenStackView, ScreenView } from "./screens.ts";

const EMPTY: readonly Entry[] = [];

const ActiveContext: Context<boolean> = createContext<boolean>(true);

class ScreenBoundary extends Component<
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

function Payload({ content }: { content: Content }): ReactNode {
  if (content.status === "error") throw content.error;
  return content.status === "ready" ? content.node : use(content.promise).root;
}

function Loading(): ReactNode {
  return (
    <View style={styles.center}>
      <ActivityIndicator />
    </View>
  );
}

function Host({ id }: { id: string }): ReactNode {
  return containerById(manifest, id)?.kind === "branches" ? (
    <BranchesHost id={id} />
  ) : (
    <StackHost id={id} />
  );
}

function Container({ id }: { id: string }): ReactNode {
  const content = useContent(chromeKey(id));

  if (containerById(manifest, id)?.chrome !== true) {
    return (
      <ContainerScope id={id}>
        <Host id={id} />
      </ContainerScope>
    );
  }

  return (
    <ScreenBoundary>
      <Suspense fallback={<Loading />}>
        <Payload content={content} />
      </Suspense>
    </ScreenBoundary>
  );
}

type ScreenProps = {
  entry: ScreenEntry;
  frozen: boolean;
  covered: boolean;
};

function Screen({ entry, frozen, covered }: ScreenProps): ReactNode {
  const content = useContent(entry.key);
  const insets = useInsets();

  return (
    <ScreenView
      accessibilityElementsHidden={covered}
      gesture={entry.gesture}
      importantForAccessibility={covered ? "no-hide-descendants" : "auto"}
      presentation={entry.presentation}
      screenKey={entry.key}
      style={[styles.screen, insetPadding(insets, edgesOf(entry.safeArea))]}
      transition={entry.transition}
    >
      <Activity mode={frozen ? "hidden" : "visible"}>
        <ScreenBoundary>
          <Suspense fallback={<Loading />}>
            <Payload content={content} />
          </Suspense>
        </ScreenBoundary>
      </Activity>
    </ScreenView>
  );
}

export function StackHost({ id }: { id: string }): ReactNode {
  const { tree } = useNavigator();
  const active = useContext(ActiveContext);
  const state = tree[id];
  const entries = state?.kind === "stack" ? state.entries : EMPTY;
  const top = entries.length - 1;

  const onPopped = useCallback((event: PoppedEvent) => {
    const keys = event.nativeEvent.keys;
    if (keys && keys.length > 0) nativeRouter()?.popped(keys);
  }, []);

  return (
    <ScreenStackView active={active} onPopped={onPopped} style={styles.stack}>
      {entries.map((entry, depth) =>
        entry.kind === "screen" ? (
          <Screen
            covered={depth !== top}
            entry={entry}
            frozen={!active || depth <= top - 2}
            key={entry.key}
          />
        ) : (
          <ScreenView
            accessibilityElementsHidden={depth !== top}
            gesture={false}
            importantForAccessibility={
              depth === top ? "auto" : "no-hide-descendants"
            }
            key={entry.key}
            presentation="push"
            screenKey={entry.key}
            style={styles.screen}
            transition="platform"
          >
            <ActiveContext.Provider value={active && depth === top}>
              <Container id={entry.id} />
            </ActiveContext.Provider>
          </ScreenView>
        ),
      )}
    </ScreenStackView>
  );
}

export function BranchesHost({ id }: { id: string }): ReactNode {
  const { tree } = useNavigator();
  const active = useContext(ActiveContext);
  const state = tree[id];
  const branches = containerById(manifest, id)?.branches ?? [];
  const current = state?.kind === "branches" ? state.active : branches[0];

  return (
    <View style={styles.stack}>
      {branches
        .filter((branch) => tree[branch] !== undefined)
        .map((branch) => {
          const shown = branch === current;
          return (
            <View
              accessibilityElementsHidden={!shown}
              importantForAccessibility={shown ? "auto" : "no-hide-descendants"}
              key={branch}
              pointerEvents={shown ? "auto" : "none"}
              style={[styles.stack, shown ? null : styles.hidden]}
            >
              <ActiveContext.Provider value={active && shown}>
                <Activity mode={active && shown ? "visible" : "hidden"}>
                  <Container id={branch} />
                </Activity>
              </ActiveContext.Provider>
            </View>
          );
        })}
    </View>
  );
}

const styles = StyleSheet.create({
  center: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
  },
  error: {
    color: "#b00020",
    fontSize: 14,
  },
  hidden: {
    display: "none",
  },
  screen: {
    backgroundColor: "white",
    bottom: 0,
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
  },
  stack: {
    flex: 1,
  },
});
