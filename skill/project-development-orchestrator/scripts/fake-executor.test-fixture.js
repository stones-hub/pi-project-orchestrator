#!/usr/bin/env node
"use strict";

const delay = Number(process.env.FAKE_EXECUTOR_DELAY_MS ?? 0);
const exitCode = Number(process.env.FAKE_EXECUTOR_EXIT_CODE ?? 0);
const timer = setTimeout(() => {
  const payload = {
    session_id: "fake-session",
    is_error: exitCode !== 0,
    result: exitCode === 0 ? "fake success" : "fake failure",
    usage: {},
  };
  process.stdout.write(JSON.stringify(payload) + "\n");
  process.exit(exitCode);
}, delay);
