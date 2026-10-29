import { describe, expect, it } from 'vitest';
import { Deck, shuffle } from '../src/shuffle';

// Gerador determinístico (mulberry32) para repetir os casos.
function seeded(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const id = (s: string) => s;

describe('shuffle', () => {
  it('é uma permutação', () => {
    const items = ['a', 'b', 'c', 'd', 'e', 'f'];
    const out = shuffle(items, seeded(1));
    expect(out.slice().sort()).toEqual(items);
    expect(items).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
  });
});

describe('Deck', () => {
  it('cada volta mostra todas as fotos uma vez', () => {
    const deck = new Deck(id, seeded(2));
    deck.reset(['a', 'b', 'c', 'd']);
    for (let round = 0; round < 5; round++) {
      const seen: string[] = [];
      for (let i = 0; i < 4; i++) seen.push(deck.next()!);
      expect(seen.slice().sort()).toEqual(['a', 'b', 'c', 'd']);
    }
  });

  it('Fim da volta: a primeira da nova volta é diferente da última mostrada', () => {
    for (let seed = 0; seed < 300; seed++) {
      const deck = new Deck(id, seeded(seed));
      deck.reset(['a', 'b', 'c']);
      let last = '';
      for (let round = 0; round < 6; round++) {
        const first = deck.next()!;
        if (round > 0) expect(first).not.toBe(last);
        last = deck.next()!;
        last = deck.next()!;
      }
    }
  });

  it('com duas fotos, alterna sem repetir', () => {
    const deck = new Deck(id, seeded(9));
    deck.reset(['a', 'b']);
    let prev = deck.next();
    for (let i = 0; i < 50; i++) {
      const cur = deck.next();
      expect(cur).not.toBe(prev);
      prev = cur;
    }
  });

  it('com uma foto, repete a mesma; sem fotos, nada', () => {
    const deck = new Deck(id, seeded(3));
    deck.reset(['a']);
    expect([deck.next(), deck.next()]).toEqual(['a', 'a']);
    deck.reset([]);
    expect(deck.next()).toBeUndefined();
  });

  it('nova lista não começa pela foto que está na tela', () => {
    for (let seed = 0; seed < 100; seed++) {
      const deck = new Deck(id, seeded(seed));
      deck.reset(['a', 'b', 'c'], 'b');
      expect(deck.next()).not.toBe('b');
    }
  });
});
