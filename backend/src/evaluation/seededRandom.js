/**
 * seededRandom.js — mulberry32 PRNG. Deterministic: the same seed always
 * produces the same sequence, so the synthetic dataset is reproducible.
 */
function mulberry32(seed) {
  let a = seed;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeRng(seed = 42) {
  const rand = mulberry32(seed);
  return {
    next: () => rand(),
    int: (min, max) => Math.floor(rand() * (max - min + 1)) + min,
    pick: (arr) => arr[Math.floor(rand() * arr.length)],
    bool: (pTrue = 0.5) => rand() < pTrue
  };
}

module.exports = { makeRng };
