/**
 * Structured logger — dev: full logs, prod: errors only
 * All logs tagged with [HBC] prefix and timestamp for easy filtering
 */
import Constants from 'expo-constants';

const IS_DEV = __DEV__;
const APP_VERSION = Constants.expoConfig?.version || '1.0.0';

const LEVELS = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 };
const MIN_LEVEL = IS_DEV ? LEVELS.DEBUG : LEVELS.ERROR;

function timestamp() {
  return new Date().toISOString().split('T')[1].split('.')[0];
}

function format(level, tag, msg, data) {
  return `[HBC ${timestamp()}] [${level}] [${tag}] ${msg}`;
}

export const Logger = {
  debug: (tag, msg, data) => {
    if (LEVELS.DEBUG < MIN_LEVEL) return;
    console.log(format('DEBUG', tag, msg), data ?? '');
  },
  info: (tag, msg, data) => {
    if (LEVELS.INFO < MIN_LEVEL) return;
    console.info(format('INFO', tag, msg), data ?? '');
  },
  warn: (tag, msg, data) => {
    if (LEVELS.WARN < MIN_LEVEL) return;
    console.warn(format('WARN', tag, msg), data ?? '');
  },
  error: (tag, msg, error) => {
    if (LEVELS.ERROR < MIN_LEVEL) return;
    console.error(format('ERROR', tag, msg), error?.message ?? error ?? '');
    if (IS_DEV && error?.stack) console.error(error.stack);
  },
  group: (tag, label, fn) => {
    if (!IS_DEV) { fn(); return; }
    console.group(`[HBC] [${tag}] ${label}`);
    fn();
    console.groupEnd();
  },
  table: (tag, data) => {
    if (!IS_DEV) return;
    console.log(`[HBC] [${tag}] table:`);
    console.table(data);
  },
  perf: (tag, label) => {
    if (!IS_DEV) return () => {};
    const start = performance.now();
    return () => {
      const ms = (performance.now() - start).toFixed(1);
      console.log(format('PERF', tag, `${label} took ${ms}ms`));
    };
  }
};

export default Logger;
