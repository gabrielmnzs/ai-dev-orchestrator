export const logger = {
  info: (message: string, meta?: Record<string, unknown>) => {
    if (meta) {
      console.log(`[info] ${message}`, meta);
      return;
    }
    console.log(`[info] ${message}`);
  },
  warn: (message: string, meta?: Record<string, unknown>) => {
    if (meta) {
      console.warn(`[warn] ${message}`, meta);
      return;
    }
    console.warn(`[warn] ${message}`);
  },
  error: (message: string, meta?: Record<string, unknown>) => {
    if (meta) {
      console.error(`[error] ${message}`, meta);
      return;
    }
    console.error(`[error] ${message}`);
  }
};
