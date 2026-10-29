import { describe, expect, it } from 'vitest';
import { escapeHtml, renderTemplate } from '../src/template';

describe('renderTemplate (subconjunto de Mustache, design D6)', () => {
  it('Senhas da sala de espera: campo, lista de objetos e campo de cada item', () => {
    const data = { atual: 'A12', proximas: [{ senha: 'A13' }, { senha: 'A14' }] };
    const tpl = '<h1>{{atual}}</h1><ul>{{#proximas}}<li>{{senha}}</li>{{/proximas}}</ul>';
    expect(renderTemplate(tpl, data)).toBe('<h1>A12</h1><ul><li>A13</li><li>A14</li></ul>');
  });

  it('campos com caminho por ponto, com espaços dentro das chaves', () => {
    const data = { fila: { atual: 'B7', sala: { nome: 'Sala 2' } } };
    expect(renderTemplate('{{fila.atual}} – {{ fila.sala.nome }}', data)).toBe('B7 – Sala 2');
  });

  it('{{.}} é o item atual: lista de textos e o próprio JSON na raiz', () => {
    expect(renderTemplate('{{#xs}}[{{.}}]{{/xs}}', { xs: ['a', 'b', 3] })).toBe('[a][b][3]');
    expect(renderTemplate('{{.}}', 'oi')).toBe('oi');
  });

  it('campo ausente, null ou caminho quebrado vira texto vazio', () => {
    expect(renderTemplate('[{{nada}}][{{a.b.c}}][{{n}}][{{s.length}}]', { a: { b: 1 }, n: null, s: 'abc' })).toBe(
      '[][][][]',
    );
    expect(renderTemplate('{{x}}', null)).toBe('');
  });

  it('números e booleanos viram texto; objetos e listas, JSON', () => {
    expect(renderTemplate('{{n}} {{z}} {{b}} {{o}} {{l}}', { n: 1.5, z: 0, b: false, o: { k: 'v' }, l: [1, 2] })).toBe(
      '1.5 0 false {&quot;k&quot;:&quot;v&quot;} [1,2]',
    );
  });

  it('seção sobre objeto: renderiza uma vez com ele no topo da pilha, e o de fora ainda é visível', () => {
    const data = { titulo: 'Fila', fila: { atual: 'C3' } };
    expect(renderTemplate('{{#fila}}{{titulo}}: {{atual}}{{/fila}}', data)).toBe('Fila: C3');
  });

  it('pilha de contexto: o item esconde o campo de mesmo nome de fora, que volta depois da seção', () => {
    const data = { nome: 'fora', itens: [{ nome: 'dentro' }, { outro: 1 }] };
    expect(renderTemplate('{{#itens}}{{nome}},{{/itens}}{{nome}}', data)).toBe('dentro,fora,fora');
  });

  it('seção sobre booleano, texto e número: verdadeiro renderiza uma vez, falso não renderiza', () => {
    const data = { sim: true, nao: false, texto: 'x', vazio: '', um: 1, zero: 0 };
    const tpl = '{{#sim}}S{{/sim}}{{#nao}}N{{/nao}}{{#texto}}[{{.}}]{{/texto}}{{#vazio}}V{{/vazio}}{{#um}}1{{/um}}{{#zero}}0{{/zero}}';
    expect(renderTemplate(tpl, data)).toBe('S[x]1');
  });

  it('seção sobre lista vazia ou campo ausente não renderiza', () => {
    expect(renderTemplate('a{{#xs}}X{{/xs}}b{{#nada}}Y{{/nada}}c', { xs: [] })).toBe('abc');
  });

  it('seções invertidas: renderizam com valor ausente, falso, vazio ou lista vazia', () => {
    const data = { xs: [], nao: false, sim: true, cheia: [1], vazio: '' };
    const tpl = '{{^xs}}1{{/xs}}{{^nada}}2{{/nada}}{{^nao}}3{{/nao}}{{^vazio}}4{{/vazio}}{{^sim}}N{{/sim}}{{^cheia}}N{{/cheia}}';
    expect(renderTemplate(tpl, data)).toBe('1234');
    // Caso típico: lista ou aviso de lista vazia.
    const tpl2 = '{{#proximas}}<li>{{senha}}</li>{{/proximas}}{{^proximas}}<p>Ninguém na fila</p>{{/proximas}}';
    expect(renderTemplate(tpl2, { proximas: [] })).toBe('<p>Ninguém na fila</p>');
  });

  it('seções aninhadas, inclusive com o mesmo nome, e caminho por ponto na seção', () => {
    const data = { salas: [{ nome: 'A', fila: [{ s: 1 }, { s: 2 }] }, { nome: 'B', fila: [] }], x: { ys: ['p', 'q'] } };
    const tpl = '{{#salas}}{{nome}}:{{#fila}}{{s}}{{/fila}}{{^fila}}-{{/fila}};{{/salas}}{{#x.ys}}{{.}}{{/x.ys}}';
    expect(renderTemplate(tpl, data)).toBe('A:12;B:-;pq');
    expect(renderTemplate('{{#a}}{{#a}}{{b}}{{/a}}{{/a}}', { a: { a: { b: 'fundo' } } })).toBe('fundo');
  });

  it('Valor com HTML: todo valor entra escapado (& < > " \')', () => {
    expect(renderTemplate('<h1>{{atual}}</h1>', { atual: '<b>A12</b>' })).toBe('<h1>&lt;b&gt;A12&lt;/b&gt;</h1>');
    expect(renderTemplate('<p title="{{t}}">{{t}}</p>', { t: `"x" & 'y'` })).toBe(
      '<p title="&quot;x&quot; &amp; &#39;y&#39;">&quot;x&quot; &amp; &#39;y&#39;</p>',
    );
    expect(escapeHtml('<script>&')).toBe('&lt;script&gt;&amp;');
  });

  it('sem saída crua: {{{x}}} e {{&x}} também escapam; sem parciais; comentário some', () => {
    const data = { x: '<i>oi</i>' };
    expect(renderTemplate('{{{x}}}|{{&x}}', data)).toBe('&lt;i&gt;oi&lt;/i&gt;|&lt;i&gt;oi&lt;/i&gt;');
    expect(renderTemplate('a{{>parcial}}b{{! nota }}c', data)).toBe('abc');
  });

  it('o modelo em si não é escapado: o HTML do usuário fica como está', () => {
    expect(renderTemplate('<style>h1{color:red}</style><script>alert(1)</script>', {})).toBe(
      '<style>h1{color:red}</style><script>alert(1)</script>',
    );
  });

  it('modelo malformado não lança: fechamento sobrando some, seção sem fechamento vai até o fim', () => {
    expect(renderTemplate('a{{/x}}b', {})).toBe('ab');
    expect(renderTemplate('{{#xs}}[{{.}}]', { xs: [1, 2] })).toBe('[1][2]');
    expect(renderTemplate('{{#a}}{{#b}}1{{/a}}2{{/b}}', { a: true, b: true })).toBe('12');
    expect(renderTemplate('{{ }}{{x', { x: 1 })).toBe('{{x');
  });

  it('não lê a cadeia de protótipos', () => {
    expect(renderTemplate('[{{constructor}}][{{toString}}][{{a.__proto__}}]', { a: {} })).toBe('[][][]');
  });
});
