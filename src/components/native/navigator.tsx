"use client";

import type { ReactNode } from "react";
import { Component, Suspense, use, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import type { RscPayload } from "../../runtime/payload.ts";
import { edgesOf, insetPadding, useInsets } from "./insets.ts";
import { nativeRouter } from "./router-store.ts";
import type { ScreenState } from "./stack-context.ts";
import { useStacks } from "./stack-context.ts";

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

type ScreenProps = {
  entry: ScreenState;
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
        <Suspense
          fallback={
            <View style={styles.center}>
              <ActivityIndicator />
            </View>
          }
        >
          <Payload payload={entry.payload} />
        </Suspense>
      </ScreenBoundary>
    </Animated.View>
  );
}

function Stack({
  entries,
  visible,
}: {
  entries: readonly ScreenState[];
  visible: boolean;
}): ReactNode {
  const [exiting, setExiting] = useState<ScreenState | null>(null);
  const previous = useRef(entries);

  useEffect(() => {
    const before = previous.current;
    previous.current = entries;
    if (entries.length < before.length) {
      const removed = before[before.length - 1];
      if (removed && !entries.includes(removed)) setExiting(removed);
    }
  }, [entries]);

  const rendered =
    exiting && !entries.includes(exiting) ? [...entries, exiting] : entries;

  return (
    <View
      pointerEvents={visible ? "auto" : "none"}
      style={[styles.stack, visible ? null : styles.hidden]}
    >
      {rendered.map((entry, depth) => (
        <Screen
          depth={depth}
          entry={entry}
          exiting={entry === exiting}
          key={entry.key}
          onExited={() => setExiting(null)}
        />
      ))}
    </View>
  );
}

export function NativeNavigator({ boundary }: { boundary: string }): ReactNode {
  const { stacks, activeTab, tabs } = useStacks();
  const keys = tabs.length > 0 ? tabs.map((tab) => tab.key) : [boundary];

  return (
    <View style={styles.stack}>
      {keys.map((key) => (
        <Stack
          entries={stacks[key] ?? []}
          key={key}
          visible={key === activeTab}
        />
      ))}
    </View>
  );
}

export function NativeTabBar(): ReactNode {
  const { tabs, activeTab } = useStacks();
  const insets = useInsets();

  return (
    <View
      style={[styles.tabBar, { paddingBottom: insets.bottom }]}
      testID="flypath-tab-bar"
    >
      {tabs.map((tab) => (
        <Pressable
          key={tab.key}
          onPress={() => nativeRouter()?.switchTab(tab.key)}
          style={styles.tab}
        >
          <Text
            style={[
              styles.tabLabel,
              tab.key === activeTab ? styles.tabActive : null,
            ]}
          >
            {tab.title ?? tab.path}
          </Text>
        </Pressable>
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
  tab: {
    alignItems: "center",
    flex: 1,
    paddingVertical: 10,
  },
  tabActive: {
    color: "#0b5cff",
    fontWeight: "600",
  },
  tabBar: {
    backgroundColor: "#fafafa",
    borderTopColor: "#e2e2e2",
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
  },
  tabLabel: {
    color: "#555",
    fontSize: 13,
  },
});
