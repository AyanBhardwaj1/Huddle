/*
 * Build workaround for macOS older than 13.3 (see scripts/solana-env.sh).
 *
 * The linker shipped in Solana platform-tools (rust-lld) is built against a newer libc++ and imports
 * one symbol that the system libc++ on macOS < 13.3 does not have:
 *
 *   std::__1::__libcpp_verbose_abort(char const*, ...)
 *
 * It is only the "assertion failed" handler. This file provides it so the linker can start.
 * It is injected with DYLD_INSERT_LIBRARIES only while building the program; nothing here ends up
 * in the on-chain program.
 */
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>

__attribute__((visibility("default"), noreturn)) void huddle_libcpp_verbose_abort(const char *format, ...)
    __asm__("__ZNSt3__122__libcpp_verbose_abortEPKcz");

void huddle_libcpp_verbose_abort(const char *format, ...) {
  va_list ap;
  va_start(ap, format);
  vfprintf(stderr, format, ap);
  va_end(ap);
  abort();
}
