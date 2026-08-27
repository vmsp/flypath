#include "hash.flypath.h"

namespace flypath::app_hash {

std::string fingerprint(const std::string& input) {
  uint32_t value = 0x811c9dc5u;
  for (unsigned char character : input) {
    value ^= character;
    value *= 0x01000193u;
  }

  static const char digits[] = "0123456789abcdef";
  std::string out(8, '0');
  for (int index = 7; index >= 0; index -= 1) {
    out[static_cast<size_t>(index)] = digits[value & 0xfu];
    value >>= 4;
  }
  return out;
}

}  // namespace flypath::app_hash
