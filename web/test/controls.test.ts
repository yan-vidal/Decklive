import { describe, expect, it } from 'vitest';
import { keyAction, moveInGrid } from '../src/controls';

describe('keyAction', () => {
  it('Voltar: Esc, Backspace, webOS (461) e Tizen (10009)', () => {
    expect(keyAction({ key: 'Escape', keyCode: 27 })).toBe('back');
    expect(keyAction({ key: 'Backspace', keyCode: 8 })).toBe('back');
    expect(keyAction({ key: 'Unidentified', keyCode: 461 })).toBe('back');
    expect(keyAction({ key: 'XF86Back', keyCode: 10009 })).toBe('back');
    expect(keyAction({ keyCode: 10009 })).toBe('back');
    expect(keyAction({ key: 'GoBack' })).toBe('back');
  });

  it('setas e OK pelo nome ou pelo keyCode', () => {
    expect(keyAction({ key: 'ArrowDown', keyCode: 40 })).toBe('down');
    expect(keyAction({ key: 'Up' })).toBe('up');
    expect(keyAction({ keyCode: 37 })).toBe('left');
    expect(keyAction({ key: 'Unidentified', keyCode: 39 })).toBe('right');
    expect(keyAction({ key: 'Enter', keyCode: 13 })).toBe('enter');
  });

  it('outras teclas não têm ação', () => {
    expect(keyAction({ key: 'a', keyCode: 65 })).toBeNull();
    expect(keyAction({ key: 'constructor' })).toBeNull();
    expect(keyAction({})).toBeNull();
  });
});

describe('moveInGrid', () => {
  // Fechar; relógio (2); formato (2); data (2); modo (3); outra orientação (2); tempo (4).
  const rows = [1, 2, 2, 2, 3, 2, 4];
  const none = () => -1;

  it('esquerda e direita ficam na linha, sem dar a volta', () => {
    expect(moveInGrid(rows, { row: 6, col: 0 }, 'left', none)).toEqual({ row: 6, col: 0 });
    expect(moveInGrid(rows, { row: 6, col: 2 }, 'right', none)).toEqual({ row: 6, col: 3 });
    expect(moveInGrid(rows, { row: 6, col: 3 }, 'right', none)).toEqual({ row: 6, col: 3 });
  });

  it('subir e descer vão para a opção escolhida da linha', () => {
    const pressed = (r: number) => (r === 4 ? 2 : -1);
    expect(moveInGrid(rows, { row: 3, col: 0 }, 'down', pressed)).toEqual({ row: 4, col: 2 });
  });

  it('sem opção escolhida, mantém a coluna até onde der', () => {
    expect(moveInGrid(rows, { row: 6, col: 3 }, 'up', none)).toEqual({ row: 5, col: 1 });
    expect(moveInGrid(rows, { row: 1, col: 1 }, 'up', none)).toEqual({ row: 0, col: 0 });
  });

  it('para nas pontas', () => {
    expect(moveInGrid(rows, { row: 0, col: 0 }, 'up', none)).toEqual({ row: 0, col: 0 });
    expect(moveInGrid(rows, { row: 6, col: 1 }, 'down', none)).toEqual({ row: 6, col: 1 });
  });
});
