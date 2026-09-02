#pragma once

#include <folly/dynamic.h>
#include <react/renderer/components/view/ConcreteViewShadowNode.h>
#include <react/renderer/components/view/ViewProps.h>
#include <react/renderer/core/ConcreteComponentDescriptor.h>
#include <react/renderer/core/PropsParserContext.h>

namespace flypath {

class ScreenStackProps final : public facebook::react::ViewProps {
 public:
  ScreenStackProps() = default;
  ScreenStackProps(const facebook::react::PropsParserContext& context,
                   const ScreenStackProps& sourceProps,
                   const facebook::react::RawProps& rawProps);

  bool active{true};
};

class ScreenProps final : public facebook::react::ViewProps {
 public:
  ScreenProps() = default;
  ScreenProps(const facebook::react::PropsParserContext& context,
              const ScreenProps& sourceProps,
              const facebook::react::RawProps& rawProps);

  std::string screenKey;
  std::string presentation{"push"};
  std::string transition{"platform"};
  bool gesture{true};
};

extern const char kScreenStackName[];
extern const char kScreenName[];

using ScreenStackShadowNode =
    facebook::react::ConcreteViewShadowNode<kScreenStackName, ScreenStackProps>;

using ScreenShadowNode =
    facebook::react::ConcreteViewShadowNode<kScreenName, ScreenProps>;

using ScreenStackComponentDescriptor =
    facebook::react::ConcreteComponentDescriptor<ScreenStackShadowNode>;

using ScreenComponentDescriptor =
    facebook::react::ConcreteComponentDescriptor<ScreenShadowNode>;

}  // namespace flypath
