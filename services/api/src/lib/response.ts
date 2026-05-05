export function json(body: unknown, statusCode = 200) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

export function error(message: string, statusCode = 400) {
  return json({ error: message }, statusCode);
}
