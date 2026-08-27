import { AppRegistry } from "react-native";

import { installClientReferences } from "./client-references.ts";
import { installFlightPolyfills } from "./flight-native.ts";
import "./jsx-dev-runtime.native.ts";
import "./jsx-runtime.native.ts";
import { installServerCallback } from "./native-actions.ts";
import { installNativeBindings, reportNativeSkew } from "./native-bindings.ts";
import Root from "./native-root.tsx";

installNativeBindings();
installFlightPolyfills();
installClientReferences();
installServerCallback();
reportNativeSkew();

AppRegistry.registerComponent("main", () => Root);
