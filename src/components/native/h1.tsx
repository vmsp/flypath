"use client";

import type { ReactNode } from "react";
import { StyleSheet, Text } from "react-native";

export default function H1({ children }: { children?: ReactNode }): ReactNode {
  return (
    <Text role="heading" style={styles.h1}>
      {children}
    </Text>
  );
}

const styles = StyleSheet.create({
  h1: {
    fontSize: 32,
    fontWeight: "700",
    marginBottom: 16,
    marginTop: 16,
  },
});
