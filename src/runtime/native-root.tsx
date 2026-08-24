import { createFromFetch } from "@vitejs/plugin-rsc/react/browser";
import type { ReactNode } from "react";
import {
  Component,
  startTransition,
  Suspense,
  use,
  useCallback,
  useEffect,
  useState,
} from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";

import { nativeConfig } from "./native-config.ts";
import type { RscPayload } from "./payload.ts";

let update: ((payload: Promise<RscPayload>) => void) | null = null;

export function swapPayload(payload: Promise<RscPayload>): void {
  startTransition(() => update?.(payload));
}

function fetchFlight(): Promise<RscPayload> {
  const { serverUrl, platform } = nativeConfig();
  return createFromFetch<RscPayload>(
    fetch(`${serverUrl}/?platform=${platform}`, {
      headers: { "x-flypath-platform": platform },
    }),
  );
}

class ErrorBoundary extends Component<
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

export default function Root(): ReactNode {
  const [payload, setPayload] = useState(fetchFlight);

  useEffect(() => {
    update = setPayload;
    return () => {
      update = null;
    };
  }, []);

  const refresh = useCallback(() => {
    startTransition(() => {
      setPayload(fetchFlight());
    });
  }, []);

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

  return (
    <View style={styles.container}>
      <ErrorBoundary>
        <Suspense
          fallback={
            <View style={styles.center}>
              <ActivityIndicator />
            </View>
          }
        >
          <Payload payload={payload} />
        </Suspense>
      </ErrorBoundary>
    </View>
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
    paddingHorizontal: 16,
    paddingTop: 64,
  },
  error: {
    color: "#b00020",
    fontSize: 14,
  },
});
