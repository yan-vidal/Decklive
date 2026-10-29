// Textos em pt-BR e inglês, escolhidos por navigator.language.

export type Lang = 'pt' | 'en';

export function detectLang(language: string | undefined | null): Lang {
  return /^pt(-|_|$)/i.test(language || '') ? 'pt' : 'en';
}

export interface Strings {
  settings: string;
  fullscreen: string;
  close: string;
  clock: string;
  clockOptions: [string, string];
  hourFormat: string;
  date: string;
  dateOptions: [string, string];
  fit: string;
  fitOptions: [string, string, string];
  skipOther: string;
  skipOtherOptions: [string, string];
  interval: string;
  motion: string;
  motionOptions: [string, string];
  place: string;
  description: string;
  // Local e descrição: mostrar ou esconder.
  infoOptions: [string, string];
  offline: string;
  empty: string;
  weekdays: string[];
  months: string[];
}

export const STRINGS: Record<Lang, Strings> = {
  pt: {
    settings: 'Ajustes',
    fullscreen: 'Tela cheia',
    close: 'Fechar',
    clock: 'Relógio',
    clockOptions: ['Ligado', 'Desligado'],
    hourFormat: 'Formato da hora',
    date: 'Data',
    dateOptions: ['Ligada', 'Desligada'],
    fit: 'Enquadramento',
    fitOptions: ['Automático', 'Preencher', 'Inteira'],
    skipOther: 'Fotos da outra orientação',
    skipOtherOptions: ['Mostrar', 'Pular'],
    interval: 'Tempo por foto',
    motion: 'Movimento',
    motionOptions: ['Ligado', 'Desligado'],
    place: 'Local',
    description: 'Descrição',
    infoOptions: ['Mostrar', 'Esconder'],
    offline: 'Sem conexão com o servidor. Tentando de novo…',
    empty: 'Nenhuma foto disponível.',
    weekdays: ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'],
    months: ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'],
  },
  en: {
    settings: 'Settings',
    fullscreen: 'Full screen',
    close: 'Close',
    clock: 'Clock',
    clockOptions: ['On', 'Off'],
    hourFormat: 'Time format',
    date: 'Date',
    dateOptions: ['On', 'Off'],
    fit: 'Framing',
    fitOptions: ['Auto', 'Fill', 'Fit'],
    skipOther: 'Other-orientation photos',
    skipOtherOptions: ['Show', 'Skip'],
    interval: 'Time per photo',
    motion: 'Motion',
    motionOptions: ['On', 'Off'],
    place: 'Location',
    description: 'Description',
    infoOptions: ['Show', 'Hide'],
    offline: 'Can’t reach the server. Retrying…',
    empty: 'No photos available.',
    weekdays: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
    months: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
  },
};
