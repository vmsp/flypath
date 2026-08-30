import type { NativeManifest } from "./manifest.ts";
import { componentName, symbolFor, viewSymbolFor } from "./manifest.ts";

function quote(value: string): string {
  return JSON.stringify(value);
}

function registration(manifest: NativeManifest, views: boolean): string[] {
  return [
    `  flypath_register_hash(${quote(manifest.hash)});`,
    ...manifest.modules.flatMap((module) => [
      ...module.functions.map((entry) =>
        entry.async
          ? `  flypath_register_async(${quote(module.id)}, ${quote(
              entry.name,
            )}, ${entry.params.length}, &${symbolFor(module.slug, entry.name)});`
          : `  flypath_register_function(${quote(module.id)}, ${quote(
              entry.name,
            )}, ${entry.params.length}, &${symbolFor(module.slug, entry.name)});`,
      ),
    ]),
    ...manifest.modules.flatMap((module) =>
      module.components.map(
        (entry) =>
          `  flypath_register_view(${quote(
            componentName(module.slug, entry.name),
          )}, ${views ? `&${viewSymbolFor(module.slug, entry.name)}` : "nullptr"});`,
      ),
    ),
  ];
}

function declarations(manifest: NativeManifest): string[] {
  return [
    ...manifest.modules.flatMap((module) =>
      module.functions.map((entry) =>
        entry.async
          ? `void ${symbolFor(module.slug, entry.name)}(FlypathValueRef args, FlypathPromiseRef promise);`
          : `void ${symbolFor(module.slug, entry.name)}(FlypathValueRef args, FlypathOutRef result);`,
      ),
    ),
    ...manifest.modules.flatMap((module) =>
      module.components.map(
        (entry) =>
          `FlypathHostRef ${viewSymbolFor(module.slug, entry.name)}(FlypathValueRef props, FlypathViewRef view);`,
      ),
    ),
  ];
}

export function generateAppleComponents(manifest: NativeManifest): string {
  const views = manifest.modules.flatMap((module) =>
    module.components.map((entry) => ({
      name: componentName(module.slug, entry.name),
      className: `FlypathView_${module.slug}_${entry.name}`,
      symbol: `kFlypath_${module.slug}_${entry.name}`,
    })),
  );

  const classes = views.map((view) =>
    [
      `extern const char ${view.symbol}[] = ${quote(view.name)};`,
      "",
      `@interface ${view.className} : FlypathComponentView`,
      "@end",
      "",
      `@implementation ${view.className}`,
      "+ (facebook::react::ComponentDescriptorProvider)componentDescriptorProvider",
      "{",
      "  return facebook::react::concreteComponentDescriptorProvider<",
      `      flypath::FlypathComponentDescriptor<${view.symbol}>>();`,
      "}",
      "@end",
    ].join("\n"),
  );

  const entries = views.map(
    (view) => `    @${quote(view.name)} : [${view.className} class],`,
  );

  return `#import <Foundation/Foundation.h>
#import <React/RCTComponentViewProtocol.h>

#import "FlypathComponent.h"
#import "FlypathComponentView.h"

${classes.join("\n\n")}${classes.length === 0 ? "" : "\n"}
extern "C" NSDictionary* FlypathFabricComponents(void) {
  return @{
${entries.join("\n")}
  };
}
`;
}

export function generateAppleRegistry(manifest: NativeManifest): string {
  return `#include <FlypathAbi.h>

extern "C" {

${declarations(manifest).join("\n")}

void FlypathRegisterAll(void) {
${registration(manifest, true).join("\n")}
}

}
`;
}

function androidAdapters(manifest: NativeManifest): string[] {
  return manifest.modules
    .filter((module) => module.cpp === undefined)
    .flatMap((module) =>
      module.functions.map((entry) => {
        const symbol = symbolFor(module.slug, entry.name);
        const method = `${module.slug}_${entry.name}`;
        const second = entry.async
          ? "FlypathPromiseRef promise"
          : "FlypathOutRef result";
        const argument = entry.async ? "promise" : "result";
        return [
          `void ${symbol}(FlypathValueRef args, ${second}) {`,
          `  static const auto method = generated()->getStaticMethod<void(jlong, jlong)>(${quote(
            method,
          )});`,
          `  method(generated(), toHandle(args), toHandle(${argument}));`,
          "}",
        ].join("\n");
      }),
    );
}

export function generateAndroidRegistry(manifest: NativeManifest): string {
  const adapters = androidAdapters(manifest);
  const externals = manifest.modules
    .filter((module) => module.cpp !== undefined)
    .flatMap((module) =>
      module.functions.map((entry) =>
        entry.async
          ? `void ${symbolFor(module.slug, entry.name)}(FlypathValueRef args, FlypathPromiseRef promise);`
          : `void ${symbolFor(module.slug, entry.name)}(FlypathValueRef args, FlypathOutRef result);`,
      ),
    );

  return `#include <FlypathAbi.h>
#include <fbjni/fbjni.h>

extern "C" {
${externals.join("\n")}
}

namespace {

facebook::jni::alias_ref<facebook::jni::JClass> generated() {
  static const auto clazz = facebook::jni::findClassStatic("FlypathGenerated");
  return clazz;
}

template <typename T>
jlong toHandle(T pointer) {
  return static_cast<jlong>(reinterpret_cast<uintptr_t>(pointer));
}

}  // namespace

extern "C" {

${adapters.join("\n\n")}${adapters.length === 0 ? "" : "\n"}
void FlypathRegisterAll(void) {
  generated()
      ->getStaticMethod<void()>("registerViews")(generated());
${registration(manifest, false).join("\n")}
}

}
`;
}
