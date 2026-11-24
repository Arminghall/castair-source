/*
 * sentry_stub.c - no-op crash reporting. CastAir reports nothing off the
 * device, so upstream's rv_sentry_* calls in module.c and receiver.c land
 * here instead of in sentry-native (removed).
 *
 * Copyright (C) 2026 Arminghall
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
#include "sentry.h"

void rv_sentry_set_sink(rv_sentry_sink sink) { (void)sink; }

int rv_sentry_init(const char *dsn, const char *release, const char *dist, const char *environment,
                   const char *device_model) {
    (void)dsn;
    (void)release;
    (void)dist;
    (void)environment;
    (void)device_model;
    return -1; /* never running */
}

void rv_sentry_breadcrumb(const char *category, const char *message) {
    (void)category;
    (void)message;
}

void rv_sentry_set_tag(const char *key, const char *value) {
    (void)key;
    (void)value;
}

void rv_sentry_set_context(const char *name, const char *const *pairs, size_t n) {
    (void)name;
    (void)pairs;
    (void)n;
}
