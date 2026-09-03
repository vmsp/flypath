#include "FlypathScreens.h"

namespace flypath {

namespace {

std::string stringAt(const folly::dynamic& values,
                     const char* key,
                     const std::string& fallback) {
  if (!values.isObject())
    return fallback;
  const folly::dynamic* found = values.get_ptr(key);
  if (found == nullptr || !found->isString())
    return fallback;
  return found->getString();
}

bool boolAt(const folly::dynamic& values, const char* key, bool fallback) {
  if (!values.isObject())
    return fallback;
  const folly::dynamic* found = values.get_ptr(key);
  if (found == nullptr || !found->isBool())
    return fallback;
  return found->getBool();
}

}  // namespace

const char kScreenStackName[] = "FlypathScreenStack";

const char kScreenName[] = "FlypathScreen";

ScreenStackProps::ScreenStackProps(
    const facebook::react::PropsParserContext& context,
    const ScreenStackProps& sourceProps,
    const facebook::react::RawProps& rawProps)
    : facebook::react::ViewProps(context, sourceProps, rawProps),
      active(boolAt(rawProps.toDynamic(), "active", sourceProps.active)) {}

ScreenProps::ScreenProps(const facebook::react::PropsParserContext& context,
                         const ScreenProps& sourceProps,
                         const facebook::react::RawProps& rawProps)
    : facebook::react::ViewProps(context, sourceProps, rawProps) {
  const folly::dynamic values = rawProps.toDynamic();
  screenKey = stringAt(values, "screenKey", sourceProps.screenKey);
  presentation = stringAt(values, "presentation", sourceProps.presentation);
  transition = stringAt(values, "transition", sourceProps.transition);
  gesture = boolAt(values, "gesture", sourceProps.gesture);
}

}  // namespace flypath
