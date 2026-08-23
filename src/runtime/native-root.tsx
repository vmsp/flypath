import { createFromFetch } from "@vitejs/plugin-rsc/react/browser";
import type { ReactNode } from "react";
import {
  Component,
  Suspense,
  use,
  useCallback,
  useEffect,
  useState,
} from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";

type Flypath = {
  platform: string;
  serverUrl: string;
  dev: boolean;
};

function config(): Flypath {
  return (globalThis as unknown as { __FLYPATH__: Flypath }).__FLYPATH__;
}

function fetchFlight(): Promise<ReactNode> {
  const { serverUrl, platform } = config();
  return createFromFetch<ReactNode>(
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

function Payload({ payload }: { payload: Promise<ReactNode> }): ReactNode {
  return use(payload);
}

export default function Root(): ReactNode {
  const [payload, setPayload] = useState(fetchFlight);

  const refresh = useCallback(() => {
    setPayload(fetchFlight());
  }, []);

  useEffect(() => {
    if (!config().dev) return;
    const socket = new WebSocket(
      `${config().serverUrl.replace(/^http/, "ws")}/flypath`,
    );
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
