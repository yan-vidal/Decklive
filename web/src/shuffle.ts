// Embaralhamento por voltas, sem repetir a última foto na virada.

export type Random = () => number;

// Fisher–Yates sobre uma cópia.
export function shuffle<T>(items: ReadonlyArray<T>, random: Random = Math.random): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    const t = out[i];
    out[i] = out[j];
    out[j] = t;
  }
  return out;
}

export class Deck<T> {
  private order: T[] = [];
  private pos = 0;
  private items: T[] = [];
  private last: string | null = null;

  constructor(
    private key: (item: T) => string,
    private random: Random = Math.random,
  ) {}

  // Nova lista: começa outra volta; `current` é a foto na tela, que não deve vir logo em seguida.
  reset(items: ReadonlyArray<T>, current: string | null = this.last): void {
    this.items = items.slice();
    this.last = current;
    this.order = [];
    this.pos = 0;
  }

  get size(): number {
    return this.items.length;
  }

  next(): T | undefined {
    if (this.items.length === 0) return undefined;
    if (this.pos >= this.order.length) this.newRound();
    const item = this.order[this.pos++];
    this.last = this.key(item);
    return item;
  }

  private newRound(): void {
    const order = shuffle(this.items, this.random);
    if (order.length > 1 && this.key(order[0]) === this.last) {
      // Troca a primeira com outra posição qualquer.
      const j = 1 + Math.floor(this.random() * (order.length - 1));
      const t = order[0];
      order[0] = order[j];
      order[j] = t;
    }
    this.order = order;
    this.pos = 0;
  }
}
