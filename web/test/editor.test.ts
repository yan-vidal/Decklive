import { describe, expect, it } from 'vitest';
import { pickInDirection } from '../src/editor';

// Contornos do modo de edição numa TV 1920×1080 com o layout padrão e a data ligada
// (medidos no navegador), mais os botões da barra.
const box = (left: number, top: number, width: number, height: number) => ({ left, top, width, height });
const CLOCK = box(784, 442, 352, 161);
const DATE = box(774, 591, 372, 48);
const PLACE = box(37, 857, 768, 44);
const DESC = box(37, 895, 768, 148);
const NEW_AREA = box(676, 20, 134, 48);
const RESTORE = box(822, 20, 291, 48);
const DONE = box(1126, 20, 117, 48);
const ALL = [CLOCK, DATE, PLACE, DESC, NEW_AREA, RESTORE, DONE];
const name = (i: number) => ['clock', 'date', 'place', 'desc', 'new', 'restore', 'done'][i] || 'stay';

describe('pickInDirection', () => {
  // "Nova área" desabilitada (sem o gancho das áreas) fica fora da lista.
  const ENABLED = [CLOCK, DATE, PLACE, DESC, RESTORE, DONE];
  const label = (i: number) => (i < 0 ? 'stay' : ['clock', 'date', 'place', 'desc', 'restore', 'done'][i]);

  it('pela coluna e para o canto: relógio ↓ data ← local ↓ descrição, e de volta', () => {
    expect(label(pickInDirection(CLOCK, ENABLED, 'down'))).toBe('date');
    expect(label(pickInDirection(DATE, ENABLED, 'left'))).toBe('place');
    expect(label(pickInDirection(PLACE, ENABLED, 'down'))).toBe('desc');
    expect(label(pickInDirection(DESC, ENABLED, 'up'))).toBe('place');
    expect(label(pickInDirection(PLACE, ENABLED, 'right'))).toBe('date');
    expect(label(pickInDirection(DATE, ENABLED, 'up'))).toBe('clock');
  });

  it('relógio ↑ barra (o botão logo acima) e barra ↓ relógio', () => {
    expect(label(pickInDirection(CLOCK, ENABLED, 'up'))).toBe('restore');
    expect(label(pickInDirection(DONE, ENABLED, 'down'))).toBe('clock');
    expect(name(pickInDirection(CLOCK, ALL, 'up'))).toBe('restore');
  });

  it('na barra, esquerda e direita andam entre os botões; nas pontas o foco fica', () => {
    expect(label(pickInDirection(RESTORE, ENABLED, 'right'))).toBe('done');
    expect(label(pickInDirection(DONE, ENABLED, 'right'))).toBe('stay');
    expect(name(pickInDirection(RESTORE, ALL, 'left'))).toBe('new');
    // Sem "Nova área", à esquerda de "Restaurar" só há itens bem abaixo (fora do cone): não salta.
    expect(label(pickInDirection(RESTORE, ENABLED, 'left'))).toBe('stay');
  });

  it('item na diagonal fora do cone não é escolhido por outra seta', () => {
    // Da data, o local fica embaixo à esquerda, mais para a esquerda que para baixo: só a seta esquerda o alcança.
    expect(label(pickInDirection(DATE, ENABLED, 'down'))).toBe('stay');
    expect(label(pickInDirection(PLACE, ENABLED, 'up'))).toBe('restore');
  });
});
