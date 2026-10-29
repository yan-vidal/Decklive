import { describe, expect, it } from 'vitest';
import { fieldKeeps, isTextField, keyAction, moveInGrid } from '../src/controls';

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

describe('fieldKeeps (campos de texto do painel e do formulário de área)', () => {
  const input = (value: string, start: number, end = start) => ({ tagName: 'INPUT', value, selectionStart: start, selectionEnd: end });
  const area = (value: string, start: number) => ({ tagName: 'TEXTAREA', value, selectionStart: start, selectionEnd: start });
  const BACKSPACE = { key: 'Backspace', keyCode: 8 };
  const ESC = { key: 'Escape', keyCode: 27 };
  const TIZEN_BACK = { key: 'XF86Back', keyCode: 10009 };
  const ARROW = {};

  it('só input e textarea são campos', () => {
    expect(isTextField(input('', 0))).toBe(true);
    expect(isTextField(area('', 0))).toBe(true);
    expect(isTextField({ tagName: 'BUTTON' })).toBe(false);
    expect(isTextField(null)).toBe(false);
  });

  it('Backspace apaga no campo; Esc e o Voltar da TV continuam sendo Voltar', () => {
    expect(fieldKeeps(input('AB', 2), 'back', BACKSPACE)).toBe(true);
    expect(fieldKeeps(input('AB', 2), 'back', ESC)).toBe(false);
    expect(fieldKeeps(area('AB', 2), 'back', TIZEN_BACK)).toBe(false);
  });

  it('esquerda e direita andam pelo texto e saem do campo quando o cursor já está na ponta', () => {
    expect(fieldKeeps(input('GB7', 1), 'left', ARROW)).toBe(true);
    expect(fieldKeeps(input('GB7', 0), 'left', ARROW)).toBe(false);
    expect(fieldKeeps(input('GB7', 1), 'right', ARROW)).toBe(true);
    expect(fieldKeeps(input('GB7', 3), 'right', ARROW)).toBe(false);
    // Com texto selecionado, a seta só desfaz a seleção.
    expect(fieldKeeps(input('GB7', 0, 3), 'right', ARROW)).toBe(true);
  });

  it('no input, cima e baixo e o Enter saem; no textarea, só com o cursor na ponta, e o Enter quebra a linha', () => {
    expect(fieldKeeps(input('x', 0), 'up', ARROW)).toBe(false);
    expect(fieldKeeps(input('x', 1), 'down', ARROW)).toBe(false);
    expect(fieldKeeps(input('x', 1), 'enter', ARROW)).toBe(false);
    expect(fieldKeeps(area('a\nb', 2), 'up', ARROW)).toBe(true);
    expect(fieldKeeps(area('a\nb', 0), 'up', ARROW)).toBe(false);
    expect(fieldKeeps(area('a\nb', 1), 'down', ARROW)).toBe(true);
    expect(fieldKeeps(area('a\nb', 3), 'down', ARROW)).toBe(false);
    expect(fieldKeeps(area('a', 1), 'enter', ARROW)).toBe(true);
  });

  it('campo sem cursor legível (tipo que não tem seleção) não prende as setas', () => {
    const weird = {
      tagName: 'INPUT',
      value: 'x',
      get selectionStart(): number | null {
        throw new Error('InvalidStateError');
      },
      selectionEnd: null,
    };
    expect(fieldKeeps(weird, 'left', ARROW)).toBe(false);
    expect(fieldKeeps({ tagName: 'INPUT', value: 'x', selectionStart: null, selectionEnd: null }, 'right', ARROW)).toBe(false);
  });
});
