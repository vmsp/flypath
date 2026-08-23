import { AppRegistry } from "react-native";

import { installClientReferences } from "./client-references.ts";
import { installFlightPolyfills } from "./flight-native.ts";
import Root from "./native-root.tsx";

installFlightPolyfills();
installClientReferences();

AppRegistry.registerComponent("main", () => Root);
