export function clearTimer(entry, name) {
  const timer = entry.timers.get(name);
  if (timer) {
    clearTimeout(timer.handle);
    entry.timers.delete(name);
  }
}

export function setTimer(entry, name, turnNumber, durationMs, onFire) {
  clearTimer(entry, name);
  const handle = setTimeout(() => {
    entry.timers.delete(name);
    onFire();
  }, durationMs);
  entry.timers.set(name, { handle, turnNumber, deadline: Date.now() + durationMs });
}

export function clearAllTimers(entry) {
  for (const name of [...entry.timers.keys()]) {
    clearTimer(entry, name);
  }
}

export function clearGraceTimer(entry, playerId) {
  const grace = entry.graceTimers.get(playerId);
  if (grace) {
    clearTimeout(grace.handle);
    entry.graceTimers.delete(playerId);
  }
}

export function setGraceTimer(entry, playerId, durationMs, onFire) {
  clearGraceTimer(entry, playerId);
  const handle = setTimeout(() => {
    entry.graceTimers.delete(playerId);
    onFire();
  }, durationMs);
  entry.graceTimers.set(playerId, { handle, deadline: Date.now() + durationMs });
}
