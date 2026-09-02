import type { ReactNode } from "react";
import type { HostComponent } from "react-native";
import * as NativeComponentRegistry from "react-native/Libraries/NativeComponent/NativeComponentRegistry";

import type { Presentation, Transition } from "../../router/types.ts";

const STACK = "FlypathScreenStack";

const SCREEN = "FlypathScreen";

export type PoppedEvent = { nativeEvent: { keys?: readonly string[] } };

export type ScreenStackProps = {
  active?: boolean;
  onPopped?: (event: PoppedEvent) => void;
  style?: unknown;
  children?: ReactNode;
};

export type ScreenProps = {
  screenKey: string;
  presentation: Presentation;
  transition: Transition;
  gesture: boolean;
  accessibilityElementsHidden?: boolean;
  importantForAccessibility?: "auto" | "no-hide-descendants";
  style?: unknown;
  children?: ReactNode;
};

export const ScreenStackView: HostComponent<ScreenStackProps> =
  NativeComponentRegistry.get<ScreenStackProps>(STACK, () => ({
    uiViewClassName: STACK,
    directEventTypes: { topPopped: { registrationName: "onPopped" } },
    validAttributes: { active: true },
  }));

export const ScreenView: HostComponent<ScreenProps> =
  NativeComponentRegistry.get<ScreenProps>(SCREEN, () => ({
    uiViewClassName: SCREEN,
    validAttributes: {
      gesture: true,
      presentation: true,
      screenKey: true,
      transition: true,
    },
  }));
