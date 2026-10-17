try {
  const host = process.env.HOST === '::1' ? '[::1]' : '127.0.0.1';
  const response = await fetch(`http://${host}:${process.env.PORT || 3000}/health`, { signal: AbortSignal.timeout(3000) });
  const body = await response.json();
  if (!response.ok || body.app !== 'faynominaal-live' || body.ok !== true) process.exitCode = 1;
} catch { process.exitCode = 1; }
