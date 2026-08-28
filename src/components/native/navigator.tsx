"use client";

import type { ReactNode } from "react";
import { Component, Suspense, use, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Platform,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { manifest } from "virtual:flypath/route-manifest";

import { containerById } from "../../router/manifest.ts";
import { ContainerScope } from "../../router/scope.tsx";
import type { RscPayload } from "../../runtime/payload.ts";
import { edgesOf, insetPadding, useInsets } from "./insets.ts";
import type { Entry, ScreenEntry } from "./navigator-context.ts";
import { useNavigator } from "./navigator-context.ts";

const EMPTY: readonly Entry[] = [];

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

function Payload({ payload }: { payload: Promise<RscPayload> }): ReactNode {
  return use(payload).root;
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
  const { fragments } = useNavigator();
  const fragment = fragments[id];

  if (!fragment) {
    return (
      <ContainerScope id={id}>
        <Host id={id} />
      </ContainerScope>
    );
  }

  return (
    <ScreenBoundary>
      <Suspense fallback={<Loading />}>
        <Payload payload={fragment} />
      </Suspense>
    </ScreenBoundary>
  );
}

type ScreenProps = {
  entry: ScreenEntry;
  depth: number;
  exiting: boolean;
  onExited: () => void;
};

function Screen({ entry, depth, exiting, onExited }: ScreenProps): ReactNode {
  const insets = useInsets();
  const progress = useRef(new Animated.Value(depth === 0 ? 0 : 1)).current;

  useEffect(() => {
    Animated.timing(progress, {
      toValue: 0,
      duration: 240,
      useNativeDriver: true,
    }).start();
  }, [progress]);

  useEffect(() => {
    if (!exiting) return;
    Animated.timing(progress, {
      toValue: 1,
      duration: 200,
      useNativeDriver: true,
    }).start(onExited);
  }, [exiting, onExited, progress]);

  const slide = Platform.OS === "ios" || entry.presentation === "modal";
  const transform = slide
    ? [
        {
          [entry.presentation === "modal" ? "translateY" : "translateX"]:
            progress.interpolate({
              inputRange: [0, 1],
              outputRange: [0, 600],
            }),
        },
      ]
    : [
        {
          scale: progress.interpolate({
            inputRange: [0, 1],
            outputRange: [1, 1.04],
          }),
        },
      ];

  return (
    <Animated.View
      pointerEvents={exiting ? "none" : "auto"}
      style={[
        depth === 0 ? styles.base : styles.overlay,
        insetPadding(insets, edgesOf(entry.safeArea)),
        {
          opacity: progress.interpolate({
            inputRange: [0, 1],
            outputRange: [1, 0],
          }),
        },
        { transform },
      ]}
    >
      <ScreenBoundary>
        <Suspense fallback={<Loading />}>
          <Payload payload={entry.payload} />
        </Suspense>
      </ScreenBoundary>
    </Animated.View>
  );
}

export function StackHost({ id }: { id: string }): ReactNode {
  const { tree } = useNavigator();
  const state = tree[id];
  const entries = state?.kind === "stack" ? state.entries : EMPTY;

  const [exiting, setExiting] = useState<Entry | null>(null);
  const previous = useRef(entries);

  useEffect(() => {
    const before = previous.current;
    previous.current = entries;
    if (entries.length < before.length) {
      const removed = before[before.length - 1];
      if (removed && removed.kind === "screen" && !entries.includes(removed)) {
        setExiting(removed);
      }
    }
  }, [entries]);

  const rendered =
    exiting && !entries.includes(exiting) ? [...entries, exiting] : entries;

  return (
    <View style={styles.stack}>
      {rendered.map((entry, depth) =>
        entry.kind === "screen" ? (
          <Screen
            depth={depth}
            entry={entry}
            exiting={entry === exiting}
            key={entry.key}
            onExited={() => setExiting(null)}
          />
        ) : (
          <View
            key={entry.key}
            style={depth === 0 ? styles.base : styles.overlay}
          >
            <Container id={entry.id} />
          </View>
        ),
      )}
    </View>
  );
}

export function BranchesHost({ id }: { id: string }): ReactNode {
  const { tree } = useNavigator();
  const state = tree[id];
  const branches = containerById(manifest, id)?.branches ?? [];
  const active = state?.kind === "branches" ? state.active : branches[0];

  return (
    <View style={styles.stack}>
      {branches
        .filter((branch) => tree[branch] !== undefined)
        .map((branch) => (
          <View
            key={branch}
            pointerEvents={branch === active ? "auto" : "none"}
            style={[styles.stack, branch === active ? null : styles.hidden]}
          >
            <Container id={branch} />
          </View>
        ))}
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    flex: 1,
  },
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
  overlay: {
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
