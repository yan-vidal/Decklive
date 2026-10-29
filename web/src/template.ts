// Modelo do HTML das áreas de endpoint (design D6): um subconjunto de Mustache. Campos com caminho
// por ponto, {{.}}, seções (#) e seções invertidas (^). Todo valor sai escapado; não há saída crua
// ({{{x}}} e {{&x}} também escapam) nem parciais. O modelo em si não é tocado: o resultado vai para um
// iframe em sandbox, sem scripts.

type Node = string | { t: 'v'; n: string } | Section;

interface Section {
  t: '#' | '^';
  n: string;
  c: Node[];
}

const ESC: { [c: string]: string } = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ESC[c]);
}

// Só propriedades próprias de objetos: nada de `constructor`, `toString` ou `length` de texto.
function has(o: unknown, key: string): boolean {
  return o !== null && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, key);
}

// O primeiro nome do caminho é procurado do topo da pilha para a base; o resto desce só por ele.
function lookup(stack: unknown[], name: string): unknown {
  if (name === '.') return stack[stack.length - 1];
  const parts = name.split('.');
  let value: unknown;
  for (let i = stack.length - 1; i >= 0; i--) {
    if (has(stack[i], parts[0])) {
      value = (stack[i] as Record<string, unknown>)[parts[0]];
      break;
    }
  }
  for (let k = 1; k < parts.length; k++) {
    value = has(value, parts[k]) ? (value as Record<string, unknown>)[parts[k]] : undefined;
  }
  return value;
}

function text(v: unknown): string {
  if (v === null || v === undefined) return '';
  // Objeto ou lista num campo: o JSON ajuda a montar o modelo.
  return typeof v === 'object' ? JSON.stringify(v) : String(v);
}

function parse(tpl: string): Node[] {
  const root: Node[] = [];
  // Seções abertas; a base é o próprio modelo.
  const open: { n: string; c: Node[] }[] = [{ n: '', c: root }];
  // {{{x}}} primeiro, para a terceira chave não sobrar como texto.
  const tag = /\{\{\{\s*([^{}]*?)\s*\}\}\}|\{\{\s*([#^/!&>]?)\s*([^{}]*?)\s*\}\}/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = tag.exec(tpl))) {
    const nodes = open[open.length - 1].c;
    if (m.index > last) nodes.push(tpl.slice(last, m.index));
    last = tag.lastIndex;
    if (m[1] !== undefined) {
      nodes.push({ t: 'v', n: m[1] });
      continue;
    }
    const sigil = m[2];
    const name = m[3];
    if (sigil === '#' || sigil === '^') {
      const s: Section = { t: sigil, n: name, c: [] };
      nodes.push(s);
      open.push(s);
    } else if (sigil === '/') {
      // Fecha a seção aberta de mesmo nome (e as de dentro dela); fechamento sem abertura some.
      for (let i = open.length - 1; i > 0; i--) {
        if (open[i].n === name) {
          open.length = i;
          break;
        }
      }
    } else if (sigil === '' || sigil === '&') {
      nodes.push({ t: 'v', n: name });
    }
    // '!' (comentário) e '>' (parcial): nada.
  }
  // Seção sem fechamento vai até o fim.
  if (last < tpl.length) open[open.length - 1].c.push(tpl.slice(last));
  return root;
}

function render(nodes: Node[], stack: unknown[]): string {
  let out = '';
  for (const node of nodes) {
    if (typeof node === 'string') {
      out += node;
    } else if (node.t === 'v') {
      out += escapeHtml(text(lookup(stack, node.n)));
    } else {
      const v = lookup(stack, node.n);
      const list = Array.isArray(v);
      const on = list ? (v as unknown[]).length > 0 : !!v;
      if (node.t === '^') {
        if (!on) out += render(node.c, stack);
      } else if (list) {
        // Lista: o conteúdo se repete para cada item, com o item no topo da pilha.
        for (const item of v as unknown[]) out += render(node.c, stack.concat([item]));
      } else if (on) {
        // Valor verdadeiro que não é lista: uma vez, com ele no topo da pilha.
        out += render(node.c, stack.concat([v]));
      }
    }
  }
  return out;
}

export function renderTemplate(tpl: string, data: unknown): string {
  return render(parse(tpl), [data]);
}
