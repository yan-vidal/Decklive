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
  // Modo de edição da tela.
  screen: string;
  editScreen: string;
  restoreLayout: string;
  newArea: string;
  done: string;
  editHint: string;
  moveHint: string;
  resizeHint: string;
  // Áreas próprias: nome, menu (Mover, Redimensionar, Conteúdo, Excluir) e formulário de conteúdo.
  area: string;
  areaMenu: [string, string, string, string];
  content: string;
  kind: string;
  kindOptions: [string, string, string];
  text: string;
  textSize: string;
  sizeOptions: [string, string, string];
  imageUrl: string;
  endpointUrl: string;
  authorization: string;
  frequency: string;
  template: string;
  save: string;
  cancel: string;
  urlInvalid: string;
  endpointError: string;
  // Envio de ajustes para outra tela.
  otherScreen: string;
  send: string;
  sending: string;
  code: string;
  expiresIn: string;
  codeExpired: string;
  sendError: string;
  tooLarge: string;
  receive: string;
  receiving: string;
  received: string;
  badCode: string;
  receiveError: string;
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
    screen: 'Tela',
    editScreen: 'Editar tela',
    restoreLayout: 'Restaurar posições padrão',
    newArea: 'Nova área',
    done: 'Concluir',
    editHint: 'Arraste os itens, ou escolha um com as setas e aperte OK para mover.',
    moveHint: 'As setas movem 1% da tela. OK ou Voltar soltam.',
    resizeHint: 'As setas mudam o tamanho em 1% da tela. OK ou Voltar soltam.',
    area: 'Área',
    areaMenu: ['Mover', 'Redimensionar', 'Conteúdo', 'Excluir'],
    content: 'Conteúdo',
    kind: 'Tipo',
    kindOptions: ['Texto', 'Imagem', 'Endpoint'],
    text: 'Texto',
    textSize: 'Tamanho',
    sizeOptions: ['Pequeno', 'Médio', 'Grande'],
    imageUrl: 'URL da imagem',
    endpointUrl: 'URL do endpoint (JSON)',
    authorization: 'Authorization (opcional)',
    frequency: 'Frequência',
    template: 'Modelo HTML',
    save: 'Salvar',
    cancel: 'Cancelar',
    urlInvalid: 'A URL precisa começar com https://',
    endpointError: 'Não foi possível ler o endpoint',
    otherScreen: 'Outra tela',
    send: 'Enviar para outra tela',
    sending: 'Enviando…',
    code: 'Código',
    expiresIn: 'vence em',
    codeExpired: 'Código vencido. Envie de novo.',
    sendError: 'Não foi possível enviar. Tente de novo.',
    tooLarge: 'Ajustes grandes demais para enviar.',
    receive: 'Receber ajustes',
    receiving: 'Recebendo…',
    received: 'Ajustes recebidos.',
    badCode: 'Código inválido ou vencido',
    receiveError: 'Não foi possível receber. Tente de novo.',
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
    screen: 'Screen',
    editScreen: 'Edit screen',
    restoreLayout: 'Restore default positions',
    newArea: 'New area',
    done: 'Done',
    editHint: 'Drag the items, or pick one with the arrows and press OK to move it.',
    moveHint: 'The arrows move it 1% of the screen. OK or Back drops it.',
    resizeHint: 'The arrows resize it by 1% of the screen. OK or Back drops it.',
    area: 'Area',
    areaMenu: ['Move', 'Resize', 'Content', 'Delete'],
    content: 'Content',
    kind: 'Type',
    kindOptions: ['Text', 'Image', 'Endpoint'],
    text: 'Text',
    textSize: 'Size',
    sizeOptions: ['Small', 'Medium', 'Large'],
    imageUrl: 'Image URL',
    endpointUrl: 'Endpoint URL (JSON)',
    authorization: 'Authorization (optional)',
    frequency: 'Refresh',
    template: 'HTML template',
    save: 'Save',
    cancel: 'Cancel',
    urlInvalid: 'The URL must start with https://',
    endpointError: 'Couldn’t read the endpoint',
    otherScreen: 'Another screen',
    send: 'Send to another screen',
    sending: 'Sending…',
    code: 'Code',
    expiresIn: 'expires in',
    codeExpired: 'Code expired. Send again.',
    sendError: 'Couldn’t send. Try again.',
    tooLarge: 'Settings too large to send.',
    receive: 'Receive settings',
    receiving: 'Receiving…',
    received: 'Settings received.',
    badCode: 'Invalid or expired code',
    receiveError: 'Couldn’t receive. Try again.',
    offline: 'Can’t reach the server. Retrying…',
    empty: 'No photos available.',
    weekdays: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
    months: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
  },
};
