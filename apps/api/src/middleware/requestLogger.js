export function requestLogger(req, res, next) {
  const start = Date.now();
  res.on('finish', () => {
    if (process.env.NODE_ENV !== 'test') {
      const duration = Date.now() - start;
      console.info(`${req.method} ${req.originalUrl || req.url} ${res.statusCode} - ${duration}ms`);
    }
  });
  next();
}
