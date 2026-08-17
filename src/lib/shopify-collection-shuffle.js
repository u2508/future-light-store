function hashSeed(value) {
  let hash = 2166136261;
  for (const character of String(value || "")) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function nextRandom(state) {
  let value = state.value || 1;
  value ^= value << 13;
  value ^= value >>> 17;
  value ^= value << 5;
  state.value = value >>> 0;
  return state.value / 0x100000000;
}

export function shuffleCollectionProductIds(productIds, seed) {
  const values = [...new Set((Array.isArray(productIds) ? productIds : []).map((value) => String(value || "")).filter(Boolean))];
  const state = { value: hashSeed(seed) || 1 };
  for (let index = values.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(nextRandom(state) * (index + 1));
    [values[index], values[swapIndex]] = [values[swapIndex], values[index]];
  }
  return values;
}

export function buildCollectionReorderMoves(currentIds, desiredIds, maxMoves = 250) {
  const current = [...currentIds];
  const desired = [...desiredIds];
  const moves = [];
  for (let index = 0; index < desired.length && moves.length < maxMoves; index += 1) {
    if (current[index] === desired[index]) continue;
    const sourceIndex = current.indexOf(desired[index], index + 1);
    if (sourceIndex < 0) continue;
    const [id] = current.splice(sourceIndex, 1);
    current.splice(index, 0, id);
    moves.push({ id, newPosition: index });
  }
  return moves;
}

export function applyCollectionReorderMoves(currentIds, moves) {
  const current = [...currentIds];
  for (const move of Array.isArray(moves) ? moves : []) {
    const sourceIndex = current.indexOf(String(move?.id || ""));
    if (sourceIndex < 0) continue;
    const [id] = current.splice(sourceIndex, 1);
    const targetIndex = Math.max(0, Math.min(Number(move.newPosition) || 0, current.length));
    current.splice(targetIndex, 0, id);
  }
  return current;
}
